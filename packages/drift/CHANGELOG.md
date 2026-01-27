# @standards-kit/drift

## 0.1.5

### Patch Changes

- c22a925: Add conform tests and standards compliance improvements

  - Add 61 unit tests to conform package covering types, schema, and loader modules
  - Move all drift tests from src/ to tests/unit/ folder structure
  - Add standards.toml configuration file for self-enforcement
  - Add ESLint v9 flat config for TypeScript linting
  - Migrate from Zod v3 to v4 with updated API usage
  - Update to Node 22 LTS requirement
  - Split cli.ts into modular components (cli/ directory)
  - Add ARCHITECTURE.md documentation

- Updated dependencies [c22a925]
  - @standards-kit/conform@0.3.0

## 0.1.4

### Patch Changes

- Updated dependencies [c15639c]
  - @standards-kit/conform@0.2.0

## 0.1.3

### Patch Changes

- fbefc47: Fix release workflow to use OIDC trusted publisher for npm authentication
- Updated dependencies [fbefc47]
  - @standards-kit/conform@0.1.3

## 0.1.2

### Patch Changes

- 3d3f370: Fix release workflow to use OIDC trusted publisher for npm authentication
- Updated dependencies [3d3f370]
  - @standards-kit/conform@0.1.2

## 0.1.1

### Patch Changes

- cc20f37: Initial public release of standards-kit packages

  - @standards-kit/conform: Infrastructure compliance validation and MCP server
  - @standards-kit/drift: Repository standards monitoring and drift detection CLI

- Updated dependencies [cc20f37]
  - @standards-kit/conform@0.1.1
