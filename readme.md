# RepoGrep

RepoGrep is a fully local CLI for indexing source repositories and searching them with both full-text (BM25 via SQLite FTS5) and semantic (vector similarity via LanceDB) ranking. Everything runs on your machine—no cloud services required.

## Features

- Clone or re-index git repositories into `~/.bloat/repos`
- SQLite FTS5 keyword search with contextual snippets
- LanceDB vector search backed by MiniLM-L6-v2 embeddings (powered by `@xenova/transformers`)
- Hybrid scoring that blends keyword and semantic results
- Repository metadata tracking via SQLite for quick listing

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

```bash
# Add and index a repository in one go
repogrep add https://github.com/sindresorhus/slugify

# Re-index an existing local clone
repogrep index ~/.bloat/repos/slugify -r slugify

# Keyword search (default)
repogrep search "auth token rotation"

# Semantic search
repogrep search --semantic "generate URL slugs"

# Hybrid search
repogrep search --hybrid "API rate limiting"

# Filter search to a specific repository
repogrep search -r my-repo-name "query string"
repogrep search --semantic -r my-repo-name "semantic query"
repogrep search --hybrid -r my-repo-name --limit 10 "hybrid query"

# List indexed repositories
repogrep list
```

Index data is stored under `~/.bloat/.rsearch` and can be safely removed if you want to rebuild from scratch.

## Development

- `npm run dev` — run the CLI via `tsx` during development
- `npm run build` — compile TypeScript into `dist/`
- `npm run clean` — remove the build output

## License

MIT