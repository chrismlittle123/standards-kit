# Migration Plan

Based on our conversation:

## Naming Changes

| Current | New |
|---------|-----|
| `check.toml` | `standards.toml` |
| `cm` (CLI) | `conform` |
| SDK/repo name | `standards-kit` |
| `drift` (CLI) | `drift` (no change) |

## Package Names

- `@yourco/standards-kit` → the repo/SDK name (maybe just for documentation, not a published package itself)
- `@yourco/conform` → the in-repo CLI
- `@yourco/drift` → the org-scanning CLI
- `@yourco/standards-core` → shared types/config parsing (if needed)
