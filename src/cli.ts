#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { addRepository, indexRepository } from './indexer.js';
import { search, type SearchMode } from './search.js';
import { listRepoIndex } from './db.js';
import { ensureDataLayout, safeRepoNameFromPath } from './util.js';

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

program.parseAsync(process.argv);
