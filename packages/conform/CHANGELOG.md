# @standards-kit/conform

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
