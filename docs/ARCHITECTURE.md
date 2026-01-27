# Standards-Kit Architecture

This document describes the high-level architecture of the standards-kit monorepo.

## Overview

Standards-kit is a unified suite of tools for enforcing coding standards, process compliance, and infrastructure configuration. It consists of two complementary packages:

- **@standards-kit/conform** - In-repository standards enforcement CLI
- **@standards-kit/drift** - Organization-wide drift detection CLI

## Monorepo Structure

```
standards-kit/
├── packages/
│   ├── conform/           # In-repo enforcement CLI
│   │   ├── src/
│   │   │   ├── cli.ts     # Main CLI entry point
│   │   │   ├── cli/       # CLI command modules
│   │   │   ├── core/      # Config loading, schemas, types
│   │   │   ├── code/      # Code quality checks (ESLint, TSC, etc.)
│   │   │   ├── process/   # Process compliance checks
│   │   │   ├── infra/     # Infrastructure validation (AWS/GCP)
│   │   │   ├── dependencies/  # Dependency tracking
│   │   │   ├── projects/  # Project detection
│   │   │   ├── validate/  # Config validation
│   │   │   ├── output/    # Formatting utilities
│   │   │   └── mcp/       # Model Context Protocol server
│   │   └── tests/
│   │       ├── unit/
│   │       ├── integration/
│   │       └── e2e/
│   │
│   └── drift/             # Org-wide drift detection
│       ├── src/
│       │   ├── cli.ts     # CLI entry point
│       │   ├── commands/  # Domain commands (code, process, infra)
│       │   ├── github/    # GitHub API integration
│       │   ├── repo/      # Repository analysis
│       │   ├── config/    # Configuration loading
│       │   └── utils/     # Utilities
│       └── tests/
│           ├── unit/
│           ├── integration/
│           └── e2e/
│
├── docs/                  # Documentation
├── turbo.json            # Turborepo configuration
├── pnpm-workspace.yaml   # pnpm workspace config
└── standards.toml        # Self-enforced standards config
```

## Package Dependencies

```
drift --> conform (workspace dependency)
```

The drift package reuses conform as a dependency, reducing code duplication. Drift orchestrates conform checks across multiple repositories.

## Key Design Patterns

### Plugin/Strategy Pattern - Tool Runners

Conform uses an extensible tool runner pattern for code quality checks:

```
BaseToolRunner (abstract)
├── ESLintRunner
├── TscRunner
├── KnipRunner
├── RuffRunner
├── GitleaksRunner
└── ... (13+ tool runners)
```

Each runner:
- Implements a standard interface
- Is configuration-driven
- Can be enabled/disabled via standards.toml
- Reports violations in a consistent format

### Builder Pattern - Result Construction

Results are constructed using builders for consistency:

```typescript
ViolationBuilder      // Individual violation
CheckResultBuilder    // Single check result
DomainResultBuilder   // Domain aggregate (code/process/infra)
```

### Configuration Management

Configuration flows through several layers:

1. **Local config** (`standards.toml`) - Project-specific settings
2. **Registry rulesets** - Shared organizational standards
3. **Extends chain** - Config inheritance via `extends` key
4. **Tier-based defaults** - Production/internal/prototype tiers

### Domain-Driven Organization

Three distinct domains:

1. **Code** - Linting, type checking, security scanning, coverage
2. **Process** - Git hooks, CI/CD, commit validation, branch protection
3. **Infra** - AWS/GCP resource validation against manifests

Each domain:
- Has independent check/audit implementations
- Produces typed results with violation counts
- Can be run individually or together

## Data Flow

### Conform Check Flow

```
standards.toml
    │
    ▼
Config Loader (with extends resolution)
    │
    ▼
Domain Checks (code/process/infra)
    │
    ▼
Tool Runners (parallel execution)
    │
    ▼
Result Aggregation
    │
    ▼
Output Formatting (text/JSON)
```

### Drift Scan Flow

```
GitHub API / Local Clone
    │
    ▼
Repository Discovery
    │
    ▼
Per-Repo Conform Execution
    │
    ▼
Drift Detection (changes, dependencies)
    │
    ▼
Issue Creation (optional)
    │
    ▼
Report Generation
```

## Error Handling

Custom error types provide clear boundaries:

- `ConfigError` - Invalid configuration (exit code 2)
- `ExecError` - Tool execution failures
- Runtime errors - Unexpected failures (exit code 3)

Exit codes:
- `0` - Success, no violations
- `1` - Violations found
- `2` - Configuration error
- `3` - Runtime error

## MCP Server Integration

Conform includes an MCP (Model Context Protocol) server for Claude Desktop integration:

```
conform mcp
```

This enables AI assistants to:
- Query coding standards
- Look up rulesets
- Validate configurations

## Build System

- **tsup** - Fast TypeScript bundling (conform)
- **tsc** - TypeScript compilation (drift)
- **Turborepo** - Monorepo task orchestration
- **pnpm** - Package management

## Testing Strategy

Tests are organized by type:

- `tests/unit/` - Pure unit tests, no external dependencies
- `tests/integration/` - Service integration tests
- `tests/e2e/` - End-to-end CLI tests

Test framework: Vitest

## Configuration Schema

The `standards.toml` schema is defined in Zod and can be exported as JSON Schema:

```bash
conform schema config
```

Key sections:
- `[metadata]` - Tier, status, project info
- `[code]` - Linting, typing, coverage rules
- `[process]` - Hooks, CI, branches config
- `[infra]` - Resource manifests, accounts
