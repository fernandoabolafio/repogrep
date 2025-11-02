import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = path.join(os.homedir(), '.bloat');
export const RSEARCH_DIR = path.join(DATA_DIR, '.rsearch');
export const SQLITE_DB_PATH = path.join(RSEARCH_DIR, 'search.sqlite');
export const VECTORS_DIR = path.join(RSEARCH_DIR, 'vectors');
export const REPOS_DIR = path.join(DATA_DIR, 'repos');

export const DEFAULT_GLOB_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.java',
  '**/*.go',
  '**/*.rs',
  '**/*.c',
  '**/*.cpp',
  '**/*.h',
  '**/*.hpp',
  '**/*.md'
];

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.venv/**',
  '**/__pycache__/**'
];

export const MAX_INDEXED_BYTES = 64 * 1024; // 64KB per file

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureDataLayout(): Promise<void> {
  await Promise.all([
    ensureDir(DATA_DIR),
    ensureDir(RSEARCH_DIR),
    ensureDir(VECTORS_DIR),
    ensureDir(REPOS_DIR)
  ]);
}

export function resolveRepoPath(repoName: string): string {
  return path.join(REPOS_DIR, repoName);
}

export function hashBuffer(buffer: Buffer | Uint8Array | string): string {
  const data = typeof buffer === 'string' ? Buffer.from(buffer) : Buffer.from(buffer);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function hashFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return hashBuffer(buf);
}

export function normalizeRepoName(input: string): string {
  const source = input.trim();
  if (!source) {
    throw new Error('Repository identifier cannot be empty');
  }

  let cleaned = source
    .replace(/^git@[^:]+:/, '')
    .replace(/^ssh:\/\/[^/]+\//i, '')
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^git:\/\/[^/]+\//i, '')
    .replace(/^file:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[\\]+/g, '/');

  const parts = cleaned.split('/').filter(Boolean);
  const base = parts.length ? parts.join('-') : cleaned;
  const normalized = base
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'repo';
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    return false;
  }
}

export async function readFileSlice(filePath: string, limit: number = MAX_INDEXED_BYTES): Promise<string> {
  const buf = await fs.readFile(filePath);
  return buf.toString('utf8').slice(0, limit);
}

export function relativePath(fromDir: string, absolutePath: string): string {
  return path.relative(fromDir, absolutePath);
}

export function getFilename(relativeFilePath: string): string {
  return path.basename(relativeFilePath);
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  if (!buffer.length) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0) {
      return true;
    }
    if (byte < 7 || (byte > 13 && byte < 32) || byte === 255) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.3;
}

export function safeRepoNameFromPath(repoPath: string): string {
  return normalizeRepoName(path.basename(path.resolve(repoPath)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
