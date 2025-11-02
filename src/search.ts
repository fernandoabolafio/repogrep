import { getLanceTable, getSqliteDb } from './db.js';
import { embedText } from './embed.js';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchOptions {
  repo?: string;
  limit?: number;
  semanticWeight?: number;
  keywordWeight?: number;
}

export interface SearchResult {
  repo: string;
  path: string;
  filename: string;
  snippet: string | null;
  keywordScore?: number;
  semanticScore?: number;
  score: number;
  mode: SearchMode;
}

interface KeywordRow {
  repo: string;
  path: string;
  filename: string;
  snippet: string | null;
  bm25: number;
}

interface SemanticRow {
  repo: string;
  path: string;
  filename: string;
  mtime_ms: number;
  size_bytes: number;
  hash: string;
  _distance?: number;
  score?: number;
}

function normalizeKeywordScore(bm25: number): number {
  if (!Number.isFinite(bm25)) {
    return 0;
  }
  return 1 / (1 + Math.max(bm25, 0));
}

function normalizeSemanticScore(distance: number | undefined): number {
  if (distance === undefined) {
    return 0;
  }
  return 1 / (1 + Math.max(distance, 0));
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export async function keywordSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const db = await getSqliteDb();
  const limit = options.limit ?? 20;

  const baseSql = `
    SELECT m.repo AS repo,
           m.path AS path,
           m.filename AS filename,
           snippet(file_fts, 3, '[', ']', ' … ', 24) AS snippet,
           bm25(file_fts) AS bm25
    FROM file_fts
    JOIN file_meta m ON m.id = file_fts.rowid
    WHERE file_fts MATCH ?
  `;

  const filters: string[] = [];
  const params: Array<string | number> = [query];

  if (options.repo) {
    filters.push('m.repo = ?');
    params.push(options.repo);
  }

  const sql = `${baseSql}${filters.length ? ` AND ${filters.join(' AND ')}` : ''} ORDER BY bm25 LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as KeywordRow[];

  return rows.map((row) => {
    const keywordScore = normalizeKeywordScore(row.bm25);
    return {
      repo: row.repo,
      path: row.path,
      filename: row.filename,
      snippet: row.snippet,
      keywordScore,
      score: keywordScore,
      mode: 'keyword'
    } satisfies SearchResult;
  });
}

export async function semanticSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const [table, db] = await Promise.all([getLanceTable(), getSqliteDb()]);
  const queryEmbedding = await embedText(query);

  let searchBuilder = table
    .vectorSearch(Array.from(queryEmbedding))
    .column('vector')
    .select(['id', 'repo', 'path', 'filename', 'mtime_ms', 'size_bytes', 'hash']);

  if (options.repo) {
    const filter = `repo = '${escapeFilterValue(options.repo)}'`;
    searchBuilder = searchBuilder.where(filter);
  }

  const results = (await searchBuilder.limit(limit).toArray()) as SemanticRow[];
  const snippetStmt = db.prepare(`
    SELECT snippet(file_fts, 3, '[', ']', ' … ', 24) AS snippet
    FROM file_fts
    WHERE repo = ? AND path = ? AND file_fts MATCH ?
    LIMIT 1
  `);

  return results.map((row) => {
    const distance = row._distance ?? row.score;
    const semanticScore = normalizeSemanticScore(distance);
    const snippetRow = snippetStmt.get(row.repo, row.path, query) as { snippet: string | null } | undefined;
    return {
      repo: row.repo,
      path: row.path,
      filename: row.filename,
      snippet: snippetRow?.snippet ?? null,
      semanticScore,
      score: semanticScore,
      mode: 'semantic'
    } satisfies SearchResult;
  });
}

export async function hybridSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const semanticWeight = options.semanticWeight ?? 0.6;
  const keywordWeight = options.keywordWeight ?? 0.4;

  const [keywordResults, semanticResults] = await Promise.all([
    keywordSearch(query, options),
    semanticSearch(query, options)
  ]);

  const combined = new Map<string, SearchResult>();

  for (const result of keywordResults) {
    const key = `${result.repo}:${result.path}`;
    combined.set(key, {
      ...result,
      score: (result.keywordScore ?? 0) * keywordWeight,
      mode: 'hybrid'
    });
  }

  for (const result of semanticResults) {
    const key = `${result.repo}:${result.path}`;
    const existing = combined.get(key);
    const semanticContribution = (result.semanticScore ?? 0) * semanticWeight;

    if (existing) {
      existing.semanticScore = result.semanticScore;
      existing.score += semanticContribution;
    } else {
      combined.set(key, {
        ...result,
        keywordScore: 0,
        score: semanticContribution,
        mode: 'hybrid'
      });
    }
  }

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 20);
}

export async function search(query: string, mode: SearchMode, options: SearchOptions = {}): Promise<SearchResult[]> {
  switch (mode) {
    case 'keyword':
      return keywordSearch(query, options);
    case 'semantic':
      return semanticSearch(query, options);
    case 'hybrid':
      return hybridSearch(query, options);
    default:
      throw new Error(`Unsupported search mode: ${mode}`);
  }
}
