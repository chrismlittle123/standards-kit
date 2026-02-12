# Agent Instructions

## Project Overview

standards-kit is a monorepo providing tools for managing coding standards across projects. Built with TypeScript.

- **Tier:** internal
- **Package:** `standards-kit` (monorepo root)

## Quick Reference

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |

## Architecture

```
packages/
  conform/     # CLI tool (@standards-kit/conform) - lint, check, mcp server
  drift/       # Drift detection for config files
```

See `docs/` for detailed architecture documentation.

## Standards & Guidelines

This project eats its own dogfood — it is the standards system.

- **Config:** `standards.toml`
- **Guidelines:** https://chrismlittle123.github.io/standards/

Use the MCP tools to query standards at any time:

| Tool | Purpose |
|------|---------|
| `get_standards` | Get guidelines matching a context (e.g., `typescript fastapi`) |
| `list_guidelines` | List all available guidelines |
| `get_guideline` | Get a specific guideline by ID |
| `get_ruleset` | Get a tool configuration ruleset (e.g., `typescript-production`) |

## Workflow

- **Branch:** Create feature branches from `main`
- **CI:** GitHub Actions runs build, test, lint on PRs
- **Deploy:** npm publish via changesets (`pnpm changeset`, merge to main triggers release)
- **Commits:** Use conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## Project-Specific Notes

- Uses `turbo` for monorepo task orchestration
- TypeScript checking happens at package level, not root
- Changes to the conform CLI affect all downstream repos that use it
- The MCP server is started via `npx @standards-kit/conform mcp`
