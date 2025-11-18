import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DATA_DIR = path.join(os.homedir(), '.repogrep');
export const RSEARCH_DIR = path.join(DATA_DIR, '.rsearch');
export const SQLITE_DB_PATH = path.join(RSEARCH_DIR, 'search.sqlite');
export const VECTORS_DIR = path.join(RSEARCH_DIR, 'vectors');
export const REPOS_DIR = path.join(DATA_DIR, 'repos');

export const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/.parcel-cache/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/.eggs/**',
  '**/.tox/**',
  '**/tmp/**',
  '**/temp/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/.vs/**',
  '**/.DS_Store',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.png',
  '**/*.gif',
  '**/*.bmp',
  '**/*.svg',
  '**/*.webp',
  '**/*.ico',
  '**/*.tiff',
  '**/*.tif',
  '**/*.psd',
  '**/*.ai',
  '**/*.eps',
  '**/*.indd',
  '**/*.raw',
  '**/*.cr2',
  '**/*.nef',
  '**/*.orf',
  '**/*.sr2',
  '**/*.mp4',
  '**/*.avi',
  '**/*.mov',
  '**/*.mkv',
  '**/*.webm',
  '**/*.flv',
  '**/*.wmv',
  '**/*.m4v',
  '**/*.ogv',
  '**/*.3gp',
  '**/*.mp3',
  '**/*.wav',
  '**/*.flac',
  '**/*.aac',
  '**/*.ogg',
  '**/*.wma',
  '**/*.m4a',
  '**/*.opus',
  '**/*.zip',
  '**/*.tar',
  '**/*.gz',
  '**/*.bz2',
  '**/*.xz',
  '**/*.7z',
  '**/*.rar',
  '**/*.jar',
  '**/*.war',
  '**/*.ear',
  '**/*.iso',
  '**/*.deb',
  '**/*.rpm',
  '**/*.apk',
  '**/*.dmg',
  '**/*.pkg',
  '**/*.msi',
  '**/*.exe',
  '**/*.dll',
  '**/*.so',
  '**/*.dylib',
  '**/*.bin',
  '**/*.app',
  '**/*.a',
  '**/*.lib',
  '**/*.wasm',
  '**/*.db',
  '**/*.sqlite',
  '**/*.sqlite3',
  '**/*.mdb',
  '**/*.accdb',
  '**/*.ttf',
  '**/*.otf',
  '**/*.woff',
  '**/*.woff2',
  '**/*.eot',
  '**/*.o',
  '**/*.obj',
  '**/*.class',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.log',
  '**/*.parquet',
  '**/*.avro',
  '**/*.orc',
  '**/*.h5',
  '**/*.hdf5',
  '**/*.pkl',
  '**/*.pickle',
  '**/*.npy',
  '**/*.npz',
  '**/*.ckpt',
  '**/*.pth',
  '**/*.pt',
  '**/*.safetensors',
  '**/*.onnx',
  '**/*.pdf',
  '**/*.docx',
  '**/*.xlsx',
  '**/*.pptx',
  '**/*.doc',
  '**/*.xls',
  '**/*.ppt'
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

export function parseRepoPath(input: string): { repo: string; path: string } {
  const firstSlash = input.indexOf('/');
  if (firstSlash === -1) {
    return { repo: input, path: '' };
  }
  return {
    repo: input.slice(0, firstSlash),
    path: input.slice(firstSlash + 1)
  };
}

export function globToSqlPattern(glob: string): string {
  // Convert glob patterns to SQL LIKE patterns
  // ** -> %, * -> %, ? -> _
  let pattern = glob;
  
  // Handle leading **/ (match any directory depth)
  pattern = pattern.replace(/^\*\*\//, '%/');
  
  // Handle /**/ (match any directory in the middle)
  pattern = pattern.replace(/\/\*\*\//g, '/%/');
  
  // Handle trailing /**
  pattern = pattern.replace(/\/\*\*$/, '/%');
  
  // Handle remaining ** (any characters including /)
  pattern = pattern.replace(/\*\*/g, '%');
  
  // Handle single * (any characters except /)
  pattern = pattern.replace(/\*/g, '%');
  
  // Handle ? (single character)
  pattern = pattern.replace(/\?/g, '_');
  
  return pattern;
}

export function formatLineNumber(line: number, width: number = 6): string {
  return line.toString().padStart(width, ' ');
}

export async function loadGitignorePatterns(repoPath: string): Promise<string[]> {
  const gitignorePath = path.join(repoPath, '.gitignore');
  
  if (!(await fileExists(gitignorePath))) {
    return [];
  }
  
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    const lines = content.split('\n');
    const patterns: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      let pattern = trimmed.replace(/\\/g, '/');
      
      const isNegation = pattern.startsWith('!');
      if (isNegation) {
        pattern = pattern.slice(1);
      }
      
      const isRootRelative = pattern.startsWith('/');
      if (isRootRelative) {
        pattern = pattern.slice(1);
      }
      
      const isDirectory = pattern.endsWith('/');
      if (isDirectory) {
        pattern = pattern.slice(0, -1);
        pattern = `${pattern}/**`;
      }
      
      if (!isRootRelative) {
        pattern = `**/${pattern}`;
      }
      
      if (pattern) {
        if (isNegation) {
          pattern = `!${pattern}`;
        }
        patterns.push(pattern);
      }
    }
    
    return patterns;
  } catch {
    return [];
  }
}
