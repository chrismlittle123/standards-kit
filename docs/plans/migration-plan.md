# Migration Plan

## Overview

Migrate `check-my-toolkit` and `drift-toolkit` into a unified `standards-kit` monorepo, published under the `@standards-kit` npm scope.

---

## Source Repositories

| Source Repo | Description | Lines of Code |
|-------------|-------------|---------------|
| `chrismlittle123/check-my-toolkit` | In-repo standards enforcement CLI | ~20k TS |
| `chrismlittle123/drift-toolkit` | Org-wide drift detection CLI | ~5k TS |

Both repos merge into `chrismlittle123/standards-kit`.

---

## Naming Changes

| Current | New |
|---------|-----|
| `check.toml` | `standards.toml` |
| `cm` (CLI command) | `conform` |
| `drift` (CLI command) | `drift` (no change) |
| `check-my-toolkit` (npm) | `@standards-kit/conform` |
| `drift-toolkit` (npm) | `@standards-kit/drift` |
| `check-my-toolkit-registry-community` | `standards-community` |
| `check-my-toolkit-registry-private` | `standards-private` |

---

## Package Structure

```
standards-kit/                    # Monorepo root
├── packages/
│   ├── core/                     # @standards-kit/core (internal, not published)
│   │   └── src/
│   │       ├── types.ts          # Shared types (Guideline, Ruleset, Config, etc.)
│   │       ├── schema.ts         # Zod schemas for standards.toml
│   │       ├── loader.ts         # TOML parsing and config loading
│   │       ├── registry.ts       # Registry resolution (extends)
│   │       └── index.ts
│   │
│   ├── conform/                  # @standards-kit/conform (published)
│   │   └── src/
│   │       ├── cli.ts            # Entry point (bin: conform)
│   │       ├── code/             # CODE domain (14 tools)
│   │       ├── process/          # PROCESS domain (13 checks)
│   │       ├── infra/            # INFRA domain (resource validation)
│   │       ├── mcp/              # MCP server for Claude
│   │       ├── projects/         # Monorepo detection
│   │       └── ...
│   │
│   └── drift/                    # @standards-kit/drift (published)
│       └── src/
│           ├── cli.ts            # Entry point (bin: drift)
│           ├── commands/
│           │   ├── code/         # Org-wide code drift scanning
│           │   ├── process/      # Org-wide process drift scanning
│           │   └── infra/        # Org-wide infra drift scanning
│           ├── github/           # GitHub API integration
│           └── ...
│
├── .github/workflows/
│   └── ci-release.yml            # Unified CI + release workflow
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## Package Details

### @standards-kit/core (internal)

Shared code used by both conform and drift. **Not published to npm.**

Contains:
- TypeScript types (`Guideline`, `Ruleset`, `Config`, `CheckResult`, etc.)
- Zod schemas for `standards.toml` validation
- TOML parsing utilities
- Registry resolution logic (handling `extends`)
- Common constants

### @standards-kit/conform (published)

In-repo standards enforcement. Replaces `check-my-toolkit`.

- **Binary:** `conform`
- **Config file:** `standards.toml`
- **Domains:**
  - CODE: Linting, types, security, unused code, naming, coverage
  - PROCESS: Hooks, CI, branches, commits, changesets, PRs, docs
  - INFRA: Resource existence validation against manifests
- **Features:** MCP server, monorepo detection, tier validation

### @standards-kit/drift (published)

Org-wide drift detection. Replaces `drift-toolkit`.

- **Binary:** `drift`
- **Domains:**
  - CODE: Detect standards.toml changes, dependency drift, missing projects
  - PROCESS: Branch protection drift, missing files, workflow changes
  - INFRA: Detect repos with infra drift from standards
- **Features:** GitHub org scanning, issue creation, scheduled scans

---

## Infra Domain Strategy

Both packages have infra functionality with different purposes:

| Package | Command | Purpose |
|---------|---------|---------|
| conform | `conform infra scan` | Repo-level: "Do resources in manifest exist? Are they configured correctly?" |
| drift | `drift infra scan` | Org-level: "Which repos have infra that drifted from standards?" |

---

## GitHub Workflow Consolidation

Merge CI and release workflows into a single unified workflow:

```yaml
# .github/workflows/ci-release.yml
name: CI & Release

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # Detect which packages changed
  changes:
    runs-on: ubuntu-latest
    outputs:
      conform: ${{ steps.filter.outputs.conform }}
      drift: ${{ steps.filter.outputs.drift }}
      core: ${{ steps.filter.outputs.core }}
    steps:
      - uses: dorny/paths-filter@v2
        id: filter
        with:
          filters: |
            conform:
              - 'packages/conform/**'
            drift:
              - 'packages/drift/**'
            core:
              - 'packages/core/**'

  # Build & test affected packages
  test:
    needs: changes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm turbo build test --filter=...[origin/main]

  # Release (on main only)
  release:
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Version Strategy

- **Fresh start:** All packages begin at `0.1.0`
- **Independent versioning:** Each package versions independently
- **Changesets:** Use changesets for version management
- **No deprecation yet:** Leave `check-my-toolkit` and `drift-toolkit` packages untouched for now

---

## Migration Phases

### Phase 1: Monorepo Setup
- [ ] Set up standards-kit monorepo structure
- [ ] Configure pnpm workspaces
- [ ] Configure Turbo for build orchestration
- [ ] Set up base tsconfig.json
- [ ] Create package scaffolds (core, conform, drift)

### Phase 2: Extract Core
- [ ] Identify shared types from check-my-toolkit
- [ ] Extract Zod schemas to core
- [ ] Extract TOML loader to core
- [ ] Extract registry resolution to core
- [ ] Write unit tests for core

### Phase 3: Migrate Conform
- [ ] Copy check-my-toolkit src to packages/conform
- [ ] Update imports to use @standards-kit/core
- [ ] Rename check.toml references to standards.toml
- [ ] Rename CLI from `cm` to `conform`
- [ ] Update all internal references
- [ ] Migrate unit tests
- [ ] Migrate e2e tests

### Phase 4: Migrate Drift
- [ ] Copy drift-toolkit src to packages/drift
- [ ] Update imports to use @standards-kit/core
- [ ] Update references to check.toml → standards.toml
- [ ] Update dependency on check-my-toolkit → @standards-kit/conform
- [ ] Migrate unit tests

### Phase 5: GitHub Workflows
- [ ] Create unified ci-release.yml workflow
- [ ] Configure path-based filtering for selective builds
- [ ] Set up OIDC-based npm publishing
- [ ] Configure changeset automation
- [ ] Remove redundant workflow files

### Phase 6: Documentation
- [ ] Update all README files
- [ ] Create migration guide for existing users
- [ ] Update registry references in docs
- [ ] Document new package structure

### Phase 7: Registry Updates
- [ ] Rename check-my-toolkit-registry-community → standards-community
- [ ] Rename check-my-toolkit-registry-private → standards-private
- [ ] Update all registry references in rulesets

### Phase 8: Testing & Validation
- [ ] Run full test suite
- [ ] Test conform CLI end-to-end
- [ ] Test drift CLI end-to-end
- [ ] Validate MCP server functionality
- [ ] Test monorepo detection

### Phase 9: Initial Release
- [ ] Publish @standards-kit/conform@0.1.0
- [ ] Publish @standards-kit/drift@0.1.0
- [ ] Verify npm packages work correctly
- [ ] Create GitHub release

### Phase 10: Post-Release (Future)
- [ ] Deprecate check-my-toolkit npm package
- [ ] Deprecate drift-toolkit npm package
- [ ] Add deprecation notices pointing to @standards-kit/*
- [ ] Migrate community users

---

## File Rename Checklist

All occurrences of these must be updated:

| Search | Replace |
|--------|---------|
| `check.toml` | `standards.toml` |
| `check-my-toolkit` | `@standards-kit/conform` |
| `drift-toolkit` | `@standards-kit/drift` |
| `cm ` (CLI invocations) | `conform ` |
| `check-my-toolkit-registry-community` | `standards-community` |
| `check-my-toolkit-registry-private` | `standards-private` |

---

## Decisions

1. **Config format:** `standards.toml` only (no YAML alternative). Schema defined in Zod/TypeScript types.
2. **CLI packages:** Keep `conform` and `drift` as separate CLI tools. No meta-package.
3. **MCP server:** Stays integrated with `@standards-kit/conform`.
