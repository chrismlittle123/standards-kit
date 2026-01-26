# Migration Guide

This guide covers migrating from the legacy packages to the new `@standards-kit` packages.

## Package Mapping

| Legacy Package | New Package |
|----------------|-------------|
| `check-my-toolkit` | `@standards-kit/conform` |
| `drift-toolkit` | `@standards-kit/drift` |

## Migrating from check-my-toolkit

### 1. Update Package

```bash
# Remove old package
npm uninstall check-my-toolkit

# Install new package
npm install -D @standards-kit/conform
```

### 2. Rename Configuration File

```bash
mv check.toml standards.toml
```

### 3. Update CLI Commands

| Old Command | New Command |
|-------------|-------------|
| `cm check` | `conform check` |
| `cm init` | `conform init` |
| `cm validate` | `conform validate` |
| `cm mcp` | `conform mcp` |

### 4. Update CI/CD Scripts

```yaml
# Before
- run: npx cm check

# After
- run: npx conform check
```

### 5. Update package.json Scripts

```json
{
  "scripts": {
    "lint:standards": "conform check"
  }
}
```

## Migrating from drift-toolkit

### 1. Update Package

```bash
# Remove old package
npm uninstall -g drift-toolkit

# Install new package
npm install -g @standards-kit/drift
```

### 2. Update Commands

The CLI command remains `drift`, so most commands work unchanged:

```bash
drift code scan --org myorg
drift process scan --org myorg
drift infra scan --org myorg
```

### 3. Configuration References

Drift now looks for `standards.toml` instead of `check.toml` when scanning repositories.

## Registry Changes

If you use registry extensions, update your references:

| Old Registry | New Registry |
|--------------|--------------|
| `check-my-toolkit-registry-community` | `standards-community` |
| `check-my-toolkit-registry-private` | `standards-private` |

Update your `standards.toml`:

```toml
# Before
extends = "check-my-toolkit-registry-community:typescript-production"

# After
extends = "standards-community:typescript-production"
```

## Configuration File Changes

The configuration format remains the same. Only the filename changes:

- `check.toml` -> `standards.toml`

All configuration options, domains, and settings work identically.

## Breaking Changes

### @standards-kit/conform

- Configuration file renamed from `check.toml` to `standards.toml`
- CLI command renamed from `cm` to `conform`
- Package name changed (update all imports if using programmatically)

### @standards-kit/drift

- Package name changed
- Now expects `standards.toml` in scanned repositories

## Compatibility Period

The legacy packages (`check-my-toolkit` and `drift-toolkit`) will continue to work but are deprecated. We recommend migrating to the new packages when convenient.

Future versions of the legacy packages will display deprecation warnings pointing to `@standards-kit/*`.

## Getting Help

If you encounter issues during migration:

1. Check this guide for common scenarios
2. Open an issue at [github.com/chrismlittle123/standards-kit/issues](https://github.com/chrismlittle123/standards-kit/issues)
