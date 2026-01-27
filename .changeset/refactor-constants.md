---
"@standards-kit/conform": minor
---

Centralize constants and eliminate code duplication

- Add `constants.ts` with configurable timeouts, AWS defaults, GitHub API config
- All hardcoded values now support environment variable overrides:
  - `GITHUB_API_URL` - Custom GitHub API endpoint (for GitHub Enterprise)
  - `STANDARDS_REPO_OWNER` / `STANDARDS_REPO_NAME` - Custom standards repo
  - `CM_STANDARDS_CACHE_DIR` - Custom cache directory
- Create shared AWS client factory eliminating duplicated caching pattern
- Align dependency versions (zod@4, commander@14)
- Remove unused dependencies reducing install size
