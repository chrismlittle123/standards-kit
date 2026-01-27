# @standards-kit/conform

In-repo standards enforcement CLI. Validates your repository against configured standards for code quality, process compliance, and infrastructure configuration.

## Installation

```bash
npm install -D @standards-kit/conform
```

## Quick Start

```bash
# Initialize configuration
npx conform init

# Run all checks
npx conform check

# Run specific domain
npx conform check --domain code
npx conform check --domain process
npx conform check --domain infra
```

## Configuration

Create a `standards.toml` file in your repository root:

```toml
[metadata]
tier = "standard"  # minimal, standard, or strict

[code]
typescript = true
eslint = true
prettier = true
unused_code = true
security = true

[process]
pre_commit_hooks = true
branch_protection = true
semantic_commits = true
changelog = true

[infra]
manifest = "infra/manifest.toml"
```

### Extending Configurations

```toml
extends = "standards-community:typescript-production"

[metadata]
tier = "strict"

# Override specific settings
[code]
coverage_threshold = 90
```

## Domains

### Code Domain

Validates code quality standards:
- TypeScript configuration
- ESLint rules
- Prettier formatting
- Unused code detection
- Security scanning
- Test coverage

### Process Domain

Validates development process standards:
- Pre-commit hooks
- Branch protection rules
- Commit message format
- Changelog requirements
- PR templates
- CI/CD configuration

### Infra Domain

Validates infrastructure configuration:
- Resource existence checks
- Configuration validation
- Manifest compliance

## CLI Commands

```bash
# Run all checks
conform check

# Run specific domain
conform check --domain code

# Output as JSON
conform check --format json

# Initialize new config
conform init

# Validate config file
conform validate

# Show version
conform --version
```

## MCP Server

Conform includes an MCP (Model Context Protocol) server for integration with AI assistants:

```bash
conform mcp
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | One or more checks failed |
| 2 | Configuration error |
| 3 | Runtime error |

## License

MIT
