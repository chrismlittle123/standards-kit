---
"@standards-kit/conform": minor
"@standards-kit/drift": patch
---

Add conform tests and standards compliance improvements

- Add 61 unit tests to conform package covering types, schema, and loader modules
- Move all drift tests from src/ to tests/unit/ folder structure
- Add standards.toml configuration file for self-enforcement
- Add ESLint v9 flat config for TypeScript linting
- Migrate from Zod v3 to v4 with updated API usage
- Update to Node 22 LTS requirement
- Split cli.ts into modular components (cli/ directory)
- Add ARCHITECTURE.md documentation
