# Standards Kit

A unified suite of tools for enforcing coding standards, process compliance, and infrastructure validation across your organization.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@standards-kit/conform](./packages/conform) | In-repo standards enforcement CLI | [![npm](https://img.shields.io/npm/v/@standards-kit/conform)](https://www.npmjs.com/package/@standards-kit/conform) |
| [@standards-kit/drift](./packages/drift) | Org-wide drift detection CLI | [![npm](https://img.shields.io/npm/v/@standards-kit/drift)](https://www.npmjs.com/package/@standards-kit/drift) |

## Overview

Standards Kit solves the problem of maintaining consistent standards across repositories:

- **Conform** - Enforces standards within a single repository
- **Drift** - Detects configuration drift across an entire organization

### Three Domains

Both tools validate across three domains:

| Domain | What it checks |
|--------|----------------|
| **Code** | TypeScript, ESLint, Prettier, security scanning, test coverage |
| **Process** | Git hooks, CI/CD, commit conventions, branch protection |
| **Infra** | AWS/GCP resource configuration against manifests |

## Quick Start

### Conform (Single Repo)

```bash
# Install
npm install -D @standards-kit/conform

# Initialize configuration
npx conform init

# Run all checks
npx conform check

# Run specific domain
npx conform check --domain code
```

### Drift (Organization-wide)

```bash
# Install globally
npm install -g @standards-kit/drift

# Set GitHub token
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Scan organization
drift code scan --org myorg
```

## Configuration

Create a `standards.toml` in your repository root:

```toml
[metadata]
tier = "standard"  # minimal, standard, or strict

[code.linting.eslint]
enabled = true

[code.types.tsc]
enabled = true

[process.hooks]
enabled = true
require_husky = true
require_hooks = ["pre-push", "commit-msg"]

[process.ci]
enabled = true
require_workflows = ["ci.yml"]

[process.commits]
enabled = true
types = ["feat", "fix", "chore", "docs", "refactor", "test"]
```

## Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Migration Guide](./docs/migration.md)
- [Conform README](./packages/conform/README.md)
- [Drift README](./packages/drift/README.md)

## Requirements

- Node.js >= 22
- pnpm >= 9.0.0 (for development)

## Development

```bash
# Clone the repository
git clone https://github.com/chrismlittle123/standards-kit.git
cd standards-kit

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint

# Type check
pnpm typecheck
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed development guidelines.

## License

MIT
