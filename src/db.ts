import BetterSqlite3 from 'better-sqlite3';
import { connect, type Connection, type Table } from '@lancedb/lancedb';
import {
  SQLITE_DB_PATH,
  VECTORS_DIR,
  ensureDataLayout
} from './util.js';
import { getEmbeddingDimension } from './embed.js';

export interface FileMetaRow {
  id?: number;
  repo: string;
  path: string;
  filename: string;
  mtime_ms: number;
  size_bytes: number;
  hash: string;
}

export interface FileEmbeddingRow {
  id: string;
  repo: string;
  path: string;
  filename: string;
  mtime_ms: number;
  size_bytes: number;
  hash: string;
  vector: Float32Array | number[];
}

export interface RepoIndexRow {
  repo: string;
  source: string | null;
  last_indexed_ms: number | null;
  last_error: string | null;
  file_count: number;
}

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

let sqliteDb: SqliteDatabase | null = null;
let lanceConnectionPromise: Promise<Connection> | null = null;
let lanceTablePromise: Promise<Table> | null = null;

const LANCE_TABLE_NAME = 'files';

function createSchema(db: SqliteDatabase): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_meta (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      hash TEXT NOT NULL,
      UNIQUE(repo, path)
    )
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
      repo, path, filename, contents, tokenize = 'porter'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS repo_index (
      repo TEXT PRIMARY KEY,
      source TEXT,
      last_indexed_ms INTEGER,
      last_error TEXT
    )
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_file_meta_repo ON file_meta(repo)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_file_meta_repo_path ON file_meta(repo, path)');
}

export async function getSqliteDb(): Promise<SqliteDatabase> {
  if (sqliteDb) {
    return sqliteDb;
  }

  await ensureDataLayout();

  sqliteDb = new BetterSqlite3(SQLITE_DB_PATH);
  createSchema(sqliteDb);
  return sqliteDb;
}

async function getLanceConnection(): Promise<Connection> {
  if (!lanceConnectionPromise) {
    lanceConnectionPromise = (async () => {
      await ensureDataLayout();
      return connect(VECTORS_DIR);
    })();
  }
  return lanceConnectionPromise;
}

async function initializeLanceTable(): Promise<Table> {
  const connection = await getLanceConnection();
  const existingTables = await connection.tableNames();

  if (existingTables.includes(LANCE_TABLE_NAME)) {
    const table = await connection.openTable(LANCE_TABLE_NAME);
    const schema = await table.schema();
    const vectorField = schema.fields.find((field) => field.name === 'vector');
    if (vectorField) {
      return table;
    }

    await table.close();
    await connection.dropTable(LANCE_TABLE_NAME);
  }

  const dimension = getEmbeddingDimension();
  const zeroVector = Array.from({ length: dimension }, () => 0);
  const table = await connection.createTable(
    LANCE_TABLE_NAME,
    [
      {
        id: '__template__',
        repo: '',
        path: '',
        filename: '',
        mtime_ms: 0,
        size_bytes: 0,
        hash: '',
        vector: zeroVector
      }
    ],
    { mode: 'create', existOk: true }
  );

  await table.delete("id = '__template__'");
  return table;
}

export async function getLanceTable(): Promise<Table> {
  if (!lanceTablePromise) {
    lanceTablePromise = initializeLanceTable();
  }
  return lanceTablePromise;
}

/**
 * Refresh the LanceDB table to get the latest version.
 * This helps avoid commit conflicts when multiple operations happen.
 */
export async function refreshLanceTable(): Promise<Table> {
  const connection = await getLanceConnection();
  const existingTables = await connection.tableNames();
  
  if (existingTables.includes(LANCE_TABLE_NAME)) {
    const table = await connection.openTable(LANCE_TABLE_NAME);
    lanceTablePromise = Promise.resolve(table);
    return table;
  }
  
  return getLanceTable();
}

/**
 * Retry a LanceDB operation with exponential backoff on commit conflicts.
 */
async function retryLanceOperation<T>(
  operation: (table: Table) => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const table = await refreshLanceTable();
      return await operation(table);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Commit conflict') && attempt < maxRetries - 1) {
        // Exponential backoff: 10ms, 20ms, 40ms
        const delay = Math.pow(2, attempt) * 10;
        await new Promise(resolve => setTimeout(resolve, delay));
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error('Operation failed after retries');
}

/**
 * Delete rows from LanceDB table with retry logic for commit conflicts.
 */
export async function deleteFromLanceTable(filter: string): Promise<void> {
  await retryLanceOperation(async (table) => {
    await table.delete(filter);
  });
}

/**
 * Add rows to LanceDB table with retry logic for commit conflicts.
 */
export async function addToLanceTable(rows: Record<string, unknown>[]): Promise<void> {
  await retryLanceOperation(async (table) => {
    await table.add(rows);
  });
}

export async function resetRepoData(repo: string): Promise<void> {
  const db = await getSqliteDb();
  const deleteMeta = db.prepare('DELETE FROM file_meta WHERE repo = ?');
  const deleteFts = db.prepare('DELETE FROM file_fts WHERE repo = ?');
  const deleteRepo = db.prepare('DELETE FROM repo_index WHERE repo = ?');

  const transaction = db.transaction((repoName: string) => {
    deleteMeta.run(repoName);
    deleteFts.run(repoName);
    deleteRepo.run(repoName);
  });

  transaction(repo);

  if (lanceTablePromise) {
    const escapedRepo = repo.replace(/'/g, "''");
    await deleteFromLanceTable(`repo = '${escapedRepo}'`);
  }
}

export async function upsertRepoIndex(repo: string, source: string | null, timestamp: number, error: string | null = null): Promise<void> {
  const db = await getSqliteDb();
  const stmt = db.prepare(`
    INSERT INTO repo_index (repo, source, last_indexed_ms, last_error)
    VALUES (@repo, @source, @timestamp, @error)
    ON CONFLICT(repo) DO UPDATE SET
      source = excluded.source,
      last_indexed_ms = excluded.last_indexed_ms,
      last_error = excluded.last_error
  `);

  stmt.run({ repo, source, timestamp, error });
}

export async function listRepoIndex(): Promise<RepoIndexRow[]> {
  const db = await getSqliteDb();
  const stmt = db.prepare(`
    SELECT repo,
           source,
           last_indexed_ms,
           last_error,
           (
             SELECT COUNT(*) FROM file_meta fm WHERE fm.repo = repo_index.repo
           ) AS file_count
    FROM repo_index
    ORDER BY repo ASC
  `);

  return stmt.all() as RepoIndexRow[];
}