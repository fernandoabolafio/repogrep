import fs from 'node:fs/promises';
import path from 'node:path';

import cliProgress from 'cli-progress';
import fg from 'fast-glob';
import { simpleGit } from 'simple-git';

import { getLanceTable, getSqliteDb, upsertRepoIndex, type FileMetaRow } from './db.js';
import { embedText } from './embed.js';
import {
  DEFAULT_GLOB_PATTERNS,
  DEFAULT_IGNORE_PATTERNS,
  MAX_INDEXED_BYTES,
  REPOS_DIR,
  ensureDataLayout,
  fileExists,
  getFilename,
  hashBuffer,
  isBinaryBuffer,
  normalizeRepoName,
  resolveRepoPath,
  safeRepoNameFromPath
} from './util.js';

export interface CloneResult {
  repo: string;
  repoPath: string;
}

export interface IndexSummary {
  repo: string;
  repoPath: string;
  filesScanned: number;
  filesIndexed: number;
  filesDeleted: number;
  filesSkippedBinary: number;
  filesSkippedUnchanged: number;
  durationMs: number;
}

export interface IndexOptions {
  repo?: string;
  source?: string | null;
  patterns?: string[];
  ignore?: string[];
  force?: boolean;
}

const VECTOR_ID_SEPARATOR = ':';

function toVectorId(repo: string, filePath: string): string {
  return `${repo}${VECTOR_ID_SEPARATOR}${filePath}`;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export async function cloneOrUpdateRepo(repoUrl: string, repoName?: string): Promise<CloneResult> {
  await ensureDataLayout();
  const name = repoName ?? normalizeRepoName(repoUrl);
  const targetPath = resolveRepoPath(name);
  const exists = await fileExists(targetPath);

  const gitClient = simpleGit();

  if (!exists) {
    await gitClient.clone(repoUrl, targetPath);
  } else {
    const repoGit = simpleGit(targetPath);
    await repoGit.fetch();
    try {
      await repoGit.pull();
    } catch (error) {
      // Attempt fast-forward pull first; if it fails, reset hard to origin/main
      await repoGit.raw(['reset', '--hard', 'HEAD']);
      await repoGit.pull();
    }
  }

  return { repo: name, repoPath: targetPath };
}

export async function indexRepository(repoPath: string, options: IndexOptions = {}): Promise<IndexSummary> {
  const startTime = Date.now();
  await ensureDataLayout();

  const repoName = options.repo ?? safeRepoNameFromPath(repoPath);
  const patterns = options.patterns ?? DEFAULT_GLOB_PATTERNS;
  const ignore = options.ignore ?? DEFAULT_IGNORE_PATTERNS;
  const force = options.force ?? false;

  const entries = await fg(patterns, {
    cwd: repoPath,
    ignore,
    dot: true,
    onlyFiles: true,
    unique: true
  });

  const db = await getSqliteDb();
  const table = await getLanceTable();

  const existingRecords = db
    .prepare('SELECT id, path, hash FROM file_meta WHERE repo = ?')
    .all(repoName) as Array<{ id: number; path: string; hash: string }>;

  const existingByPath = new Map(existingRecords.map((row) => [row.path, row]));
  const seenPaths = new Set<string>();
  const pendingUpdates: Array<{
    meta: FileMetaRow;
    contents: string;
    embedding: Float32Array;
  }> = [];
  const removedRecords: Array<{ id: number; path: string }> = [];
  let binarySkipped = 0;
  let unchangedSkipped = 0;

  // Initialize progress bar
  let progressBar: cliProgress.SingleBar | null = null;
  if (entries.length > 0) {
    progressBar = new cliProgress.SingleBar({
      format: '[{bar}] {percentage}% | {value}/{total} files | Current: {filename} | Indexed: {indexed} Skipped: {skipped} Binary: {binary}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false
    }, cliProgress.Presets.shades_classic);
    progressBar.start(entries.length, 0, {
      filename: 'Starting...',
      indexed: 0,
      skipped: 0,
      binary: 0
    });
  }

  let processedCount = 0;
  let indexedCount = 0;

  for (const relativePath of entries) {
    const absolutePath = path.join(repoPath, relativePath);
    const buffer = await fs.readFile(absolutePath);

    if (isBinaryBuffer(buffer)) {
      binarySkipped += 1;
      processedCount += 1;
      if (progressBar) {
        progressBar.update(processedCount, {
          filename: relativePath.length > 40 ? '...' + relativePath.slice(-37) : relativePath,
          indexed: indexedCount,
          skipped: unchangedSkipped,
          binary: binarySkipped
        });
      }
      continue;
    }

    const stats = await fs.stat(absolutePath);
    const contents = buffer.toString('utf8', 0, MAX_INDEXED_BYTES);
    const hash = hashBuffer(buffer);
    const filename = getFilename(relativePath);

    seenPaths.add(relativePath);

    const existing = existingByPath.get(relativePath);
    if (existing && existing.hash === hash && !force) {
      unchangedSkipped += 1;
      processedCount += 1;
      if (progressBar) {
        progressBar.update(processedCount, {
          filename: relativePath.length > 40 ? '...' + relativePath.slice(-37) : relativePath,
          indexed: indexedCount,
          skipped: unchangedSkipped,
          binary: binarySkipped
        });
      }
      continue;
    }

    const embedding = await embedText(contents);

    const meta: FileMetaRow = {
      repo: repoName,
      path: relativePath,
      filename,
      mtime_ms: Math.trunc(stats.mtimeMs ?? stats.mtime.getTime()),
      size_bytes: stats.size,
      hash
    };

    pendingUpdates.push({
      meta,
      contents,
      embedding
    });

    indexedCount += 1;
    processedCount += 1;
    if (progressBar) {
      progressBar.update(processedCount, {
        filename: relativePath.length > 40 ? '...' + relativePath.slice(-37) : relativePath,
        indexed: indexedCount,
        skipped: unchangedSkipped,
        binary: binarySkipped
      });
    }
  }

  if (progressBar) {
    progressBar.stop();
    progressBar = null;
  }

  for (const record of existingRecords) {
    if (!seenPaths.has(record.path)) {
      removedRecords.push({ id: record.id, path: record.path });
    }
  }

  const upsertMeta = db.prepare(`
    INSERT INTO file_meta (repo, path, filename, mtime_ms, size_bytes, hash)
    VALUES (@repo, @path, @filename, @mtime_ms, @size_bytes, @hash)
    ON CONFLICT(repo, path) DO UPDATE SET
      filename = excluded.filename,
      mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes,
      hash = excluded.hash
    RETURNING id
  `);
  const deleteFtsByRowId = db.prepare('DELETE FROM file_fts WHERE rowid = ?');
  const insertFts = db.prepare(`
    INSERT INTO file_fts(rowid, repo, path, filename, contents)
    VALUES (@id, @repo, @path, @filename, @contents)
  `);
  const deleteMetaById = db.prepare('DELETE FROM file_meta WHERE id = ?');

  const transaction = db.transaction((updates: typeof pendingUpdates, deletions: typeof removedRecords) => {
    for (const record of updates) {
      const { meta, contents } = record;
      const inserted = upsertMeta.get(meta) as { id: number };
      deleteFtsByRowId.run(inserted.id);
      insertFts.run({
        id: inserted.id,
        repo: meta.repo,
        path: meta.path,
        filename: meta.filename,
        contents
      });
      record.meta.id = inserted.id;
    }

    for (const removal of deletions) {
      deleteFtsByRowId.run(removal.id);
      deleteMetaById.run(removal.id);
    }
  });

  transaction(pendingUpdates, removedRecords);

  for (const removal of removedRecords) {
    const filter = `id = '${escapeFilterValue(toVectorId(repoName, removal.path))}'`;
    await table.delete(filter);
  }

  if (pendingUpdates.length > 0) {
    const filters = new Set<string>();
    for (const record of pendingUpdates) {
      filters.add(`id = '${escapeFilterValue(toVectorId(repoName, record.meta.path))}'`);
    }
    for (const filter of filters) {
      await table.delete(filter);
    }

    await table.add(
      pendingUpdates.map((record) => ({
        id: toVectorId(repoName, record.meta.path),
        repo: repoName,
        path: record.meta.path,
        filename: record.meta.filename,
        mtime_ms: record.meta.mtime_ms,
        size_bytes: record.meta.size_bytes,
        hash: record.meta.hash,
        vector: Array.from(record.embedding)
      }))
    );
  }

  await upsertRepoIndex(repoName, options.source ?? null, Date.now(), null);

  const durationMs = Date.now() - startTime;

  return {
    repo: repoName,
    repoPath,
    filesScanned: entries.length,
    filesIndexed: pendingUpdates.length,
    filesDeleted: removedRecords.length,
    filesSkippedBinary: binarySkipped,
    filesSkippedUnchanged: unchangedSkipped,
    durationMs
  };
}

export async function addRepository(repoUrl: string, options: { repoName?: string } = {}): Promise<IndexSummary> {
  const cloneResult = await cloneOrUpdateRepo(repoUrl, options.repoName);
  return indexRepository(cloneResult.repoPath, {
    repo: cloneResult.repo,
    source: repoUrl
  });
}
