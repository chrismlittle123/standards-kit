# standards-kit

A monorepo for standards enforcement tooling.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@standards-kit/conform](./packages/conform) | In-repo standards enforcement CLI | [![npm](https://img.shields.io/npm/v/@standards-kit/conform)](https://www.npmjs.com/package/@standards-kit/conform) |
| [@standards-kit/drift](./packages/drift) | Org-wide drift detection CLI | [![npm](https://img.shields.io/npm/v/@standards-kit/drift)](https://www.npmjs.com/package/@standards-kit/drift) |

## Quick Start

### Conform (In-repo enforcement)

```bash
# Install
npm install -D @standards-kit/conform

# Initialize config
npx conform init

# Run checks
npx conform check
```

### Drift (Org-wide scanning)

```bash
# Install globally
npm install -g @standards-kit/drift

# Scan organization
drift code scan --org myorg
```

## Configuration

Both tools use `standards.toml` for configuration:

```toml
# standards.toml
[metadata]
tier = "standard"

[code]
typescript = true
eslint = true
prettier = true

[process]
pre_commit_hooks = true
branch_protection = true
```

## Migration from Previous Tools

If you're migrating from `check-my-toolkit` or `drift-toolkit`, see the [Migration Guide](./docs/migration.md).

## Development

This is a pnpm monorepo using Turborepo.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
