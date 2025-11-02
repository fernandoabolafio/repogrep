# Cursor Rule: repogrep CLI Integration

## Overview

`repogrep` is a local code search tool that indexes repositories and provides both full-text (keyword) and semantic search capabilities. Use it to search across external codebases that have been indexed locally.

## When to Use repogrep

Use `repogrep` when you need to:
- Search code in repositories that are NOT in the current workspace
- Find examples of patterns across multiple indexed codebases
- Explore external libraries or frameworks that have been indexed
- Read files from indexed repositories without opening them
- Perform semantic searches across large codebases

**Do NOT use** `repogrep` for:
- Searching the current workspace (use `codebase_search` or `grep` tools instead)
- Files in the active project directory

## Available Commands

### 1. `repogrep list`
List all indexed repositories to see what's available for searching.

```bash
repogrep list
```

**Use this first** to understand which repositories you can search.

### 2. `repogrep search` - Semantic & Keyword Search
The primary search command with three modes:

**Keyword search (default)**: Fast full-text search using SQLite FTS
```bash
repogrep search "authentication middleware"
repogrep search "user login" --repo Effect-TS-effect
```

**Semantic search**: AI-powered meaning-based search
```bash
repogrep search "how to handle errors" --semantic
repogrep search "async state management" --semantic --limit 10
```

**Hybrid search**: Combines both approaches
```bash
repogrep search "database connection pooling" --hybrid
```

**Options:**
- `-r, --repo <name>` - Filter to specific repository
- `--semantic` - Use semantic/vector search
- `--hybrid` - Combine keyword + semantic search
- `-l, --limit <number>` - Max results (default: 20)

### 3. `repogrep grep` - Pattern Search
Search for regex patterns in file contents (like ripgrep).

```bash
# Find all function declarations
repogrep grep "function \w+\(" --type ts

# Case-insensitive search with context
repogrep grep "todo" -i -C 3 --repo myproject

# Count matches per file
repogrep grep "console\.log" --type js -c

# Just show filenames
repogrep grep "deprecated" -l
```

**Options:**
- `-r, --repo <name>` - Filter to repository
- `-i, --ignore-case` - Case insensitive
- `-A <num>` - Lines after match
- `-B <num>` - Lines before match  
- `-C <num>` - Lines before and after
- `-l, --files-with-matches` - Show only filenames
- `-c, --count` - Show match counts
- `--type <ext>` - Filter by extension (ts, js, py, etc.)
- `--limit <number>` - Limit output lines

### 4. `repogrep read` - Read File Contents
Display contents of indexed files.

```bash
# Read entire file
repogrep read Effect-TS-effect/packages/effect/src/Effect.ts

# Read specific line range
repogrep read myrepo/src/utils.ts --offset 50 --limit 30

# Without line numbers
repogrep read myrepo/README.md --no-line-numbers
```

**Format:** `repo/path/to/file`

**Options:**
- `--offset <line>` - Start from line number (default: 1)
- `--limit <lines>` - Number of lines to read
- `-n, --line-numbers` - Show line numbers (default: true)

### 5. `repogrep glob` - Find Files by Pattern
Search for files by name/path patterns.

```bash
# Find all TypeScript files
repogrep glob "*.ts"

# Find test files
repogrep glob "**/test/**/*.js"

# Find config files in specific repo
repogrep glob "**/*config*" --repo Effect-TS-effect --limit 20
```

**Options:**
- `-r, --repo <name>` - Filter to repository
- `--limit <number>` - Limit results

### 6. `repogrep ls` - List Directory Contents
Browse directory structure of indexed repositories.

```bash
# List all indexed repositories
repogrep ls

# List root of a repository
repogrep ls Effect-TS-effect

# List specific directory
repogrep ls Effect-TS-effect/packages/effect/src

# Ignore patterns
repogrep ls myrepo/src --ignore "*.test.js" --ignore "node_modules"
```

**Options:**
- `--ignore <pattern>` - Ignore patterns (repeatable)

## Workflow Examples

### Example 1: Exploring a New Library
```bash
# First, see what's indexed
repogrep list

# Explore directory structure
repogrep ls Effect-TS-effect
repogrep ls Effect-TS-effect/packages

# Find relevant files
repogrep glob "**/*Effect*.ts" --repo Effect-TS-effect

# Read a specific file
repogrep read Effect-TS-effect/packages/effect/src/Effect.ts --limit 100

# Search for concepts
repogrep search "error handling patterns" --semantic --repo Effect-TS-effect
```

### Example 2: Finding Implementation Examples
```bash
# Semantic search across all repos
repogrep search "implement retry logic with exponential backoff" --semantic

# Then grep for specific patterns in results
repogrep grep "retry.*backoff" --type ts -C 5

# Read the relevant files
repogrep read <repo>/<path>
```

### Example 3: Cross-Repository Pattern Analysis
```bash
# Find all uses of a pattern
repogrep grep "useEffect\(" --type tsx -c

# See which files use it
repogrep grep "useEffect\(" --type tsx -l

# Examine specific implementations with context
repogrep grep "useEffect\(" --type tsx -C 3 --limit 50
```

## Integration with Cursor Workflow

1. **Start with `repogrep list`** to see available repositories
2. **Use semantic search** (`repogrep search --semantic`) to find conceptually relevant code
3. **Narrow down with grep** (`repogrep grep`) for specific patterns
4. **Read files** (`repogrep read`) to examine implementations
5. **Apply learnings** to the current workspace

## Important Notes

- All searches are **local and offline** - no API calls required
- Search results reference indexed repositories stored in `~/.repogrep/`
- The tool combines SQLite FTS (fast keyword) + LanceDB (semantic vectors)
- Semantic search uses embeddings from a local transformer model
- Maximum indexed file size: 64KB per file
- Binary files are automatically skipped during indexing

## Adding New Repositories

While this rule focuses on searching, you can index new repositories:

```bash
# Index a remote repository
repogrep add https://github.com/owner/repo

# Index a local directory
repogrep index /path/to/local/repo --repo custom-name

# Re-index to update
repogrep index /path/to/repo --force
```

## Performance Tips

- Use `--repo` to limit searches to specific repositories (faster)
- Use `--limit` to cap results for large searches
- Keyword search is faster than semantic search
- Use `--type` to filter by file extension when grepping
- Use `-c` or `-l` flags with grep to reduce output when exploring

## Command Selection Guide

| Need to... | Use Command | Example |
|------------|-------------|---------|
| Find code by meaning | `search --semantic` | `repogrep search "validate user input" --semantic` |
| Find exact text/pattern | `grep` | `repogrep grep "function.*validate"` |
| Find files by name | `glob` | `repogrep glob "*.test.ts"` |
| Browse directories | `ls` | `repogrep ls Effect-TS-effect/src` |
| Read a file | `read` | `repogrep read repo/path/file.ts` |
| See what's available | `list` | `repogrep list` |
| Fast keyword search | `search` (no flags) | `repogrep search "authentication"` |
| Best of both worlds | `search --hybrid` | `repogrep search "error handling" --hybrid` |

