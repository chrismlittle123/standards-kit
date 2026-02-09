# @standards-kit/conform

## 0.3.2

### Patch Changes

- Fix Symbol crash in validation error formatting when config has invalid ESLint rules

  - Fix `Cannot convert a Symbol value to a string` crash when Zod validation errors contain Symbol path elements from `.catchall()` schemas
  - Strip Symbol properties from TOML parser output for Zod 4.x compatibility
  - Remove all references to legacy package names
  - Add CI tooling and fix code quality violations

## 0.3.1

### Patch Changes

- Rename MCP server from "cm-standards" to "standards"

## 0.3.0

### Minor Changes

- c22a925: Add conform tests and standards compliance improvements

  - Add 61 unit tests to conform package covering types, schema, and loader modules
  - Move all drift tests from src/ to tests/unit/ folder structure
  - Add standards.toml configuration file for self-enforcement
  - Add ESLint v9 flat config for TypeScript linting
  - Migrate from Zod v3 to v4 with updated API usage
  - Update to Node 22 LTS requirement
  - Split cli.ts into modular components (cli/ directory)
  - Add ARCHITECTURE.md documentation

## 0.2.0

### Minor Changes

- c15639c: Centralize constants and eliminate code duplication

  - Add `constants.ts` with configurable timeouts, AWS defaults, GitHub API config
  - All hardcoded values now support environment variable overrides:
    - `GITHUB_API_URL` - Custom GitHub API endpoint (for GitHub Enterprise)
    - `STANDARDS_REPO_OWNER` / `STANDARDS_REPO_NAME` - Custom standards repo
    - `CM_STANDARDS_CACHE_DIR` - Custom cache directory
  - Create shared AWS client factory eliminating duplicated caching pattern
  - Align dependency versions (zod@4, commander@14)
  - Remove unused dependencies reducing install size

## 0.1.3

### Patch Changes

- fbefc47: Fix release workflow to use OIDC trusted publisher for npm authentication

## 0.1.2

### Patch Changes

- 3d3f370: Fix release workflow to use OIDC trusted publisher for npm authentication

## 0.1.1

### Patch Changes

- cc20f37: Initial public release of standards-kit packages

  - @standards-kit/conform: Infrastructure compliance validation and MCP server
  - @standards-kit/drift: Repository standards monitoring and drift detection CLI
