#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { addRepository, indexRepository } from './indexer.js';
import { search, type SearchMode } from './search.js';
import { listRepoIndex, getSqliteDb } from './db.js';
import { 
  ensureDataLayout, 
  safeRepoNameFromPath, 
  parseRepoPath,
  globToSqlPattern,
  formatLineNumber,
  REPOS_DIR
} from './util.js';

const program = new Command();

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining.toFixed(0)}s`;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return 'never';
  }
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function wrapAction(fn: (...args: any[]) => Promise<void>) {
  return (...args: any[]) => {
    fn(...args).catch(async (error) => {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exitCode = 1;
    });
  };
}

program
  .name('repogrep')
  .description('Local code search combining SQLite FTS and LanceDB semantic search')
  .version('0.1.0');

program
  .command('add')
  .argument('<repo>', 'Git repository URL to clone')
  .option('-n, --name <name>', 'Override repository name')
  .description('Clone a remote repository into the local cache and index it')
  .action(
    wrapAction(async (repo: string, options: { name?: string }) => {
      await ensureDataLayout();
      const summary = await addRepository(repo, { repoName: options.name });

      console.log(`Indexed ${summary.repo} (${summary.filesIndexed} file(s) updated, ${summary.filesDeleted} deleted, ${summary.filesSkippedUnchanged} unchanged, ${summary.filesSkippedBinary} binary skipped) in ${formatDuration(summary.durationMs)}.`);
    })
  );

program
  .command('index')
  .argument('<path>', 'Local repository path to index')
  .option('-r, --repo <name>', 'Repository name override')
  .option('--force', 'Force re-index even if files appear unchanged', false)
  .description('Index a local repository directory')
  .action(
    wrapAction(async (repoPath: string, options: { repo?: string; force?: boolean }) => {
      await ensureDataLayout();
      const absolutePath = path.resolve(repoPath);
      await fs.access(absolutePath);
      const repoName = options.repo ?? safeRepoNameFromPath(absolutePath);

      const summary = await indexRepository(absolutePath, {
        repo: repoName,
        force: options.force ?? false,
        source: null
      });

      console.log(`Indexed ${summary.repo} (${summary.filesIndexed} file(s) updated, ${summary.filesDeleted} deleted, ${summary.filesSkippedUnchanged} unchanged, ${summary.filesSkippedBinary} binary skipped) in ${formatDuration(summary.durationMs)}.`);
    })
  );

program
  .command('search')
  .argument('<query...>', 'Search query string')
  .option('-r, --repo <name>', 'Filter results to a single repository')
  .option('-l, --limit <number>', 'Maximum number of results (default 20)', '20')
  .option('--semantic', 'Use semantic search mode', false)
  .option('--hybrid', 'Use hybrid search mode', false)
  .description('Search indexed repositories using keyword, semantic, or hybrid mode')
  .action(
    wrapAction(
      async (
        queryParts: string[],
        options: {
          repo?: string;
          limit?: string;
          semantic?: boolean;
          hybrid?: boolean;
        }
      ) => {
        await ensureDataLayout();
        const query = queryParts.join(' ').trim();
        if (!query) {
          console.error('Query string cannot be empty.');
          process.exitCode = 1;
          return;
        }

        let mode: SearchMode = 'keyword';
        if (options.hybrid) {
          mode = 'hybrid';
        } else if (options.semantic) {
          mode = 'semantic';
        }

        const limit = Number.parseInt(options.limit ?? '20', 10) || 20;
        const results = await search(query, mode, {
          repo: options.repo,
          limit
        });

        if (!results.length) {
          console.log('No results found.');
          return;
        }

        for (const result of results) {
          const title = `${result.repo}/${result.path}`;
          const score = result.score.toFixed(3);
          console.log(`${title}  (score ${score})`);
          if (result.snippet) {
            const snippet = result.snippet.replace(/\n/g, '\n  ');
            console.log(`  ${snippet}`);
          }
          console.log('');
        }
      }
    )
  );

program
  .command('list')
  .description('List indexed repositories')
  .action(
    wrapAction(async () => {
      await ensureDataLayout();
      const repos = await listRepoIndex();

      if (!repos.length) {
        console.log('No repositories indexed yet.');
        return;
      }

      for (const repo of repos) {
        const status = repo.last_error ? `⚠️ ${repo.last_error}` : `${repo.file_count} files`;
        console.log(`${repo.repo}  (${status})  last indexed: ${formatTimestamp(repo.last_indexed_ms)}`);
        if (repo.source) {
          console.log(`  source: ${repo.source}`);
        }
      }
    })
  );

program
  .command('ls')
  .argument('[path]', 'Directory path in format: repo or repo/path')
  .option('--ignore <pattern>', 'Ignore glob patterns (can be repeated)', (value, previous: string[] = []) => {
    return [...previous, value];
  }, [] as string[])
  .description('List files and directories in a repository path')
  .action(
    wrapAction(
      async (
        pathArg: string | undefined,
        options: {
          ignore?: string[];
        }
      ) => {
        await ensureDataLayout();
        const db = await getSqliteDb();

        if (!pathArg) {
          // List all repositories
          const repos = await listRepoIndex();
          
          if (!repos.length) {
            console.log('No repositories indexed yet.');
            return;
          }

          for (const repo of repos) {
            console.log(`${repo.repo}/`);
          }
          return;
        }

        const { repo, path: dirPath } = parseRepoPath(pathArg);
        
        if (!repo) {
          console.error('Invalid path format. Use: repo or repo/path');
          process.exitCode = 1;
          return;
        }

        // Get all files in this repo that start with the directory path
        const searchPath = dirPath ? `${dirPath}/` : '';
        const sql = 'SELECT path FROM file_meta WHERE repo = ? AND path LIKE ? ORDER BY path';
        const pattern = `${searchPath}%`;
        
        const files = db.prepare(sql).all(repo, pattern) as Array<{ path: string }>;

        if (files.length === 0) {
          console.log('No files found in this directory.');
          return;
        }

        // Group by immediate subdirectory or file
        const entries = new Set<string>();
        const ignorePatterns = options.ignore || [];

        for (const file of files) {
          let relativePath = file.path;
          
          // Remove the directory prefix
          if (dirPath) {
            if (file.path.startsWith(searchPath)) {
              relativePath = file.path.slice(searchPath.length);
            } else {
              continue;
            }
          }

          // Check if matches ignore patterns
          let shouldIgnore = false;
          for (const ignorePattern of ignorePatterns) {
            const sqlIgnorePattern = globToSqlPattern(ignorePattern);
            // Simple glob matching (could be improved)
            if (relativePath.includes(ignorePattern.replace(/\*/g, ''))) {
              shouldIgnore = true;
              break;
            }
          }

          if (shouldIgnore) {
            continue;
          }

          // Get the immediate entry (directory or file)
          const slashIndex = relativePath.indexOf('/');
          if (slashIndex === -1) {
            // It's a file in this directory
            entries.add(relativePath);
          } else {
            // It's in a subdirectory
            const subdir = relativePath.slice(0, slashIndex);
            entries.add(`${subdir}/`);
          }
        }

        const sortedEntries = Array.from(entries).sort();
        
        for (const entry of sortedEntries) {
          console.log(entry);
        }
      }
    )
  );

program
  .command('glob')
  .argument('<pattern>', 'Glob pattern to match files')
  .option('-r, --repo <name>', 'Filter to specific repository')
  .option('--limit <number>', 'Limit number of results')
  .description('Find files matching a glob pattern')
  .action(
    wrapAction(
      async (
        pattern: string,
        options: {
          repo?: string;
          limit?: string;
        }
      ) => {
        await ensureDataLayout();
        const db = await getSqliteDb();

        const sqlPattern = globToSqlPattern(pattern);
        
        const filters: string[] = [];
        const params: string[] = [];
        
        let sql = 'SELECT repo, path FROM file_meta WHERE (path LIKE ? OR filename LIKE ?)';
        params.push(sqlPattern, sqlPattern);
        
        if (options.repo) {
          filters.push('repo = ?');
          params.push(options.repo);
        }

        if (filters.length > 0) {
          sql += ' AND ' + filters.join(' AND ');
        }

        sql += ' ORDER BY mtime_ms DESC';

        if (options.limit) {
          sql += ' LIMIT ?';
          params.push(options.limit);
        }

        const files = db.prepare(sql).all(...params) as Array<{ repo: string; path: string }>;

        if (files.length === 0) {
          console.log('No files found matching pattern.');
          return;
        }

        for (const file of files) {
          console.log(`${file.repo}/${file.path}`);
        }
      }
    )
  );

program
  .command('read')
  .argument('<file>', 'File to read in format: repo/path')
  .option('--offset <line>', 'Start reading from line number', '1')
  .option('--limit <lines>', 'Number of lines to read')
  .option('-n, --line-numbers', 'Show line numbers', true)
  .description('Read contents of an indexed file')
  .action(
    wrapAction(
      async (
        fileArg: string,
        options: {
          offset?: string;
          limit?: string;
          lineNumbers?: boolean;
        }
      ) => {
        await ensureDataLayout();
        const db = await getSqliteDb();

        const { repo, path: filePath } = parseRepoPath(fileArg);
        
        if (!repo || !filePath) {
          console.error('Invalid file format. Use: repo/path');
          process.exitCode = 1;
          return;
        }

        // Verify file exists in index
        const fileRecord = db
          .prepare('SELECT repo, path FROM file_meta WHERE repo = ? AND path = ?')
          .get(repo, filePath) as { repo: string; path: string } | undefined;

        if (!fileRecord) {
          console.error(`File not found in index: ${fileArg}`);
          process.exitCode = 1;
          return;
        }

        const absolutePath = path.join(REPOS_DIR, repo, filePath);
        
        let content: string;
        try {
          content = await fs.readFile(absolutePath, 'utf-8');
        } catch (err) {
          console.error(`Error reading file: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }

        const lines = content.split('\n');
        const offset = Math.max(1, Number.parseInt(options.offset ?? '1', 10));
        const limit = options.limit ? Number.parseInt(options.limit, 10) : lines.length;
        
        const startLine = offset - 1; // Convert to 0-based
        const endLine = Math.min(lines.length, startLine + limit);

        if (startLine >= lines.length) {
          console.error(`Offset ${offset} is beyond file length (${lines.length} lines)`);
          process.exitCode = 1;
          return;
        }

        for (let i = startLine; i < endLine; i++) {
          if (options.lineNumbers) {
            const lineNum = formatLineNumber(i + 1);
            console.log(`${lineNum}|${lines[i]}`);
          } else {
            console.log(lines[i]);
          }
        }
      }
    )
  );

program
  .command('grep')
  .argument('<pattern>', 'Regular expression pattern to search for')
  .option('-r, --repo <name>', 'Filter to specific repository')
  .option('-i, --ignore-case', 'Case insensitive search', false)
  .option('-A <number>', 'Lines of context after match', '0')
  .option('-B <number>', 'Lines of context before match', '0')
  .option('-C <number>', 'Lines of context before and after match')
  .option('-l, --files-with-matches', 'Show only filenames', false)
  .option('-c, --count', 'Show match counts per file', false)
  .option('--type <ext>', 'Filter by file extension')
  .option('--limit <number>', 'Limit output lines/results')
  .description('Search for pattern in indexed files using regex')
  .action(
    wrapAction(
      async (
        pattern: string,
        options: {
          repo?: string;
          ignoreCase?: boolean;
          A?: string;
          B?: string;
          C?: string;
          filesWithMatches?: boolean;
          count?: boolean;
          type?: string;
          limit?: string;
        }
      ) => {
        await ensureDataLayout();
        const db = await getSqliteDb();

        // Build regex
        const flags = options.ignoreCase ? 'gi' : 'g';
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, flags);
        } catch (err) {
          console.error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }

        // Calculate context lines
        let contextBefore = Number.parseInt(options.B ?? '0', 10);
        let contextAfter = Number.parseInt(options.A ?? '0', 10);
        if (options.C) {
          const contextBoth = Number.parseInt(options.C, 10);
          contextBefore = contextBoth;
          contextAfter = contextBoth;
        }

        // Query indexed files
        const filters: string[] = [];
        const params: string[] = [];
        
        let sql = 'SELECT repo, path, filename FROM file_meta WHERE 1=1';
        
        if (options.repo) {
          filters.push('repo = ?');
          params.push(options.repo);
        }
        
        if (options.type) {
          filters.push("filename LIKE ?");
          params.push(`%.${options.type}`);
        }

        if (filters.length > 0) {
          sql += ' AND ' + filters.join(' AND ');
        }

        sql += ' ORDER BY repo, path';

        const files = db.prepare(sql).all(...params) as Array<{ repo: string; path: string; filename: string }>;

        let totalOutputLines = 0;
        const outputLimit = options.limit ? Number.parseInt(options.limit, 10) : Number.MAX_SAFE_INTEGER;
        const fileCounts = new Map<string, number>();

        for (const file of files) {
          if (totalOutputLines >= outputLimit) {
            break;
          }

          const filePath = path.join(REPOS_DIR, file.repo, file.path);
          let content: string;
          
          try {
            content = await fs.readFile(filePath, 'utf-8');
          } catch (err) {
            // File not found on disk, skip
            continue;
          }

          const lines = content.split('\n');
          const matchingLines: Array<{ lineNum: number; isMatch: boolean; content: string }> = [];
          const matchedLineNums = new Set<number>();

          // Find all matching lines
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matchedLineNums.add(i);
            }
          }

          if (matchedLineNums.size === 0) {
            continue;
          }

          const fileKey = `${file.repo}/${file.path}`;
          fileCounts.set(fileKey, matchedLineNums.size);

          // If count mode, skip to next file
          if (options.count) {
            continue;
          }

          // If files-with-matches mode, just print filename
          if (options.filesWithMatches) {
            console.log(fileKey);
            totalOutputLines += 1;
            continue;
          }

          // Build output with context
          const linesToShow = new Set<number>();
          for (const matchLine of matchedLineNums) {
            for (let i = Math.max(0, matchLine - contextBefore); i <= Math.min(lines.length - 1, matchLine + contextAfter); i++) {
              linesToShow.add(i);
            }
          }

          const sortedLines = Array.from(linesToShow).sort((a, b) => a - b);
          
          if (sortedLines.length > 0) {
            console.log(`${fileKey}`);
            totalOutputLines += 1;
          }

          for (const lineNum of sortedLines) {
            if (totalOutputLines >= outputLimit) {
              break;
            }
            
            const isMatch = matchedLineNums.has(lineNum);
            const separator = isMatch ? ':' : '-';
            const formattedLineNum = formatLineNumber(lineNum + 1);
            console.log(`${formattedLineNum}${separator}${lines[lineNum]}`);
            totalOutputLines += 1;
          }

          if (sortedLines.length > 0 && totalOutputLines < outputLimit) {
            console.log('');
            totalOutputLines += 1;
          }
        }

        // Print counts if in count mode
        if (options.count) {
          for (const [fileKey, count] of fileCounts.entries()) {
            console.log(`${fileKey}:${count}`);
          }
        }

        if (fileCounts.size === 0) {
          console.log('No matches found.');
        }
      }
    )
  );

program.parseAsync(process.argv);
