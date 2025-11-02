# Bloat

Bloat is a fully local CLI for indexing source repositories and searching them with both full-text (BM25 via SQLite FTS5) and semantic (vector similarity via LanceDB) ranking. Everything runs on your machine—no cloud services required.

## Features

- Clone or re-index git repositories into `~/.bloat/repos`
- SQLite FTS5 keyword search with contextual snippets
- LanceDB vector search backed by MiniLM-L6-v2 embeddings (powered by `@xenova/transformers`)
- Hybrid scoring that blends keyword and semantic results
- Repository metadata tracking via SQLite for quick listing

## Installation

```bash
git clone https://github.com/your-org/bloat.git
cd bloat
npm install
npm run build
npm i -g .
```

The global install exposes the `bloat` command, which points to the compiled `dist/cli.js` entry.

## Usage

```bash
# Add and index a repository in one go
bloat add https://github.com/sindresorhus/slugify

# Re-index an existing local clone
bloat index ~/.bloat/repos/slugify -r slugify

# Keyword search (default)
bloat search "auth token rotation"

# Semantic search
bloat search --semantic "generate URL slugs"

# Hybrid search
bloat search --hybrid "API rate limiting"

# List indexed repositories
bloat list
```

Index data is stored under `~/.bloat/.rsearch` and can be safely removed if you want to rebuild from scratch.

## Development

- `npm run dev` — run the CLI via `tsx` during development
- `npm run build` — compile TypeScript into `dist/`
- `npm run clean` — remove the build output

## License

MIT