# Publishing CodeComb to npm

This guide walks you through publishing the `codecomb` package to npm so users can install it with `npm install -g codecomb`.

## Prerequisites

1. **npm account**: Create one at https://www.npmjs.com/signup if you don't have one
2. **npm CLI logged in**: Run `npm login` and enter your credentials
3. **Unique package name**: The name `codecomb` is available on npm

## Pre-publication Checklist

### 1. Verify the name is available

The package name `codecomb` has been verified as available on npm.

### 2. Update package.json if needed

If the name is taken, update the name field:

```json
{
  "name": "@fernandoabolafio/repogrep",  // scoped package
  // or
  "name": "repogrep-cli"  // alternative name
}
```

For scoped packages, users would install with: `npm install -g @fernandoabolafio/repogrep`

### 3. Verify the build works

```bash
# Clean and rebuild
npm run clean
npm run build

# Test the package locally
npm pack

# This creates a .tgz file - you can test install it:
npm install -g repogrep-0.1.0.tgz

# Test the command works
repogrep --help
repogrep list

# Uninstall after testing
npm uninstall -g repogrep
```

### 4. Review what will be published

```bash
npm pack --dry-run
```

This shows exactly what files will be included in the package. You should see:
- `dist/` directory (compiled JavaScript)
- `readme.md`
- `package.json`

## Publishing Steps

### First-time publish (version 0.1.0)

```bash
# 1. Make sure you're logged in
npm whoami

# 2. Build the latest code
npm run build

# 3. Publish to npm
npm publish
```

For a scoped package, add the `--access public` flag:

```bash
npm publish --access public
```

### Subsequent releases

```bash
# 1. Update the version (choose one):
npm version patch  # 0.1.0 → 0.1.1 (bug fixes)
npm version minor  # 0.1.0 → 0.2.0 (new features)
npm version major  # 0.1.0 → 1.0.0 (breaking changes)

# 2. This will:
#    - Update package.json version
#    - Create a git tag
#    - Run the "prepare" script (builds automatically)

# 3. Publish to npm
npm publish

# 4. Push tags to GitHub
git push && git push --tags
```

## After Publishing

### Test the published package

```bash
# Install globally from npm
npm install -g repogrep

# Or for scoped package:
npm install -g @fernandoabolafio/repogrep

# Test it works
repogrep --help
repogrep add https://github.com/sindresorhus/slugify
repogrep search "slugify"
```

### View on npm

Your package will be available at:
- https://www.npmjs.com/package/repogrep
- Or https://www.npmjs.com/package/@fernandoabolafio/repogrep (for scoped)

### Update GitHub repository

Make sure your GitHub repo at `github.com/fernandoabolafio/repogrep` is public and matches the repository URL in package.json.

## Troubleshooting

### "You do not have permission to publish"

The package name might be taken or you need to be logged in:

```bash
npm login
```

### "Package name too similar to existing package"

Choose a different name or use a scoped package.

### Build files not included

Make sure:
1. The `files` field in package.json includes `"dist"`
2. The `prepare` script runs `npm run build`
3. Run `npm pack --dry-run` to verify

### Better-sqlite3 native module issues

Users on different platforms might face binary compatibility issues. The package includes better-sqlite3 which has native bindings. Users will need:
- Node.js >=18.0.0
- Build tools on their system (node-gyp will rebuild if needed)

For most users, this happens automatically during install.

## Version Strategy

Recommended versioning:
- **0.1.x** - Initial releases, gather feedback
- **0.2.x** - Add features, refine based on usage
- **1.0.0** - First stable release once the API is solid

## Unpublishing (if needed)

You can unpublish within 72 hours of publishing:

```bash
npm unpublish repogrep@0.1.0
```

After 72 hours, you can only deprecate:

```bash
npm deprecate repogrep@0.1.0 "Please upgrade to 0.2.0"
```

## Quick Reference

```bash
# Check package name availability
npm view <package-name>

# Login to npm
npm login

# Dry-run to see what will be published
npm pack --dry-run

# Publish
npm publish                    # public package
npm publish --access public    # scoped package

# Update version and publish
npm version patch && npm publish && git push --tags
```

