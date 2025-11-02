# RepoGrep

RepoGrep is a fully local CLI for indexing source repositories and searching them with both full-text (BM25 via SQLite FTS5) and semantic (vector similarity via LanceDB) ranking. Everything runs on your machine—no cloud services required.

## Features

- Clone or re-index git repositories into `~/.repogrep/repos`
- SQLite FTS5 keyword search with contextual snippets
- LanceDB vector search backed by MiniLM-L6-v2 embeddings (powered by `@xenova/transformers`)
- Hybrid scoring that blends keyword and semantic results
- Repository metadata tracking via SQLite for quick listing
- Pattern search with regex (grep)
- File reading with line ranges
- File finding by glob patterns
- Directory browsing

## Installation

Install globally via npm:

```bash
npm install -g repogrep
```

Or install from source:

```bash
git clone https://github.com/fernandoabolafio/repogrep.git
cd repogrep
npm install
npm run build
npm i -g .
```

The global install exposes the `repogrep` command.

## Usage

### Indexing Repositories

```bash
# Add and index a remote repository in one go
repogrep add https://github.com/sindresorhus/slugify

# Index a local directory
repogrep index /path/to/local/repo --repo custom-name

# Re-index an existing repository (force update)
repogrep index ~/.repogrep/repos/slugify --force

# List indexed repositories
repogrep list
```

### Searching

```bash
# Keyword search (default, fast)
repogrep search "auth token rotation"

# Semantic search (AI-powered, meaning-based)
repogrep search --semantic "generate URL slugs"

# Hybrid search (combines keyword + semantic)
repogrep search --hybrid "API rate limiting"

# Filter search to a specific repository
repogrep search -r my-repo-name "query string"
repogrep search --semantic -r my-repo-name --limit 10 "semantic query"
```

### Pattern Matching (Grep)

```bash
# Search for regex patterns in files
repogrep grep "function \w+\(" --type ts

# Case-insensitive search with context lines
repogrep grep "todo" -i -C 3

# Count matches per file
repogrep grep "console\.log" --type js -c

# Show only filenames with matches
repogrep grep "deprecated" -l
```

### File Operations

```bash
# Read a file with line numbers
repogrep read Effect-TS-effect/packages/effect/src/Effect.ts

# Read specific line range
repogrep read myrepo/src/utils.ts --offset 50 --limit 30

# Find files by glob pattern
repogrep glob "*.ts"
repogrep glob "**/test/**/*.js" --repo Effect-TS-effect

# List directory contents
repogrep ls
repogrep ls Effect-TS-effect
repogrep ls Effect-TS-effect/packages/effect/src
```

Index data is stored under `~/.repogrep/.rsearch` and can be safely removed if you want to rebuild from scratch.

## Usage in Cursor

To teach Cursor how to use repogrep, create a `.cursor/rules/repogrep.mdc` file in your project and copy the contents of `cursor-rule.md` into it.

Once configured, Cursor will automatically know how to use repogrep commands to search and explore your indexed repositories, making it easy to reference code from external libraries and frameworks while coding.

## Development

- `npm run dev` — run the CLI via `tsx` during development
- `npm run build` — compile TypeScript into `dist/`
- `npm run clean` — remove the build output

## License

MIT