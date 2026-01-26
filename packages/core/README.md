# @standards-kit/core

Shared types and configuration parsing for standards-kit packages.

> **Note:** This is an internal package. It is not published to npm and is used by `@standards-kit/conform` and `@standards-kit/drift`.

## Contents

- **types.ts** - Shared TypeScript types (`Violation`, `CheckResult`, `DomainResult`, etc.)
- **schema.ts** - Zod schemas for `standards.toml` validation
- **loader.ts** - Configuration file discovery and parsing
- **registry.ts** - Registry resolution for `extends` configuration

## Usage

```typescript
import {
  loadConfig,
  ViolationBuilder,
  CheckResultBuilder,
  DomainResultBuilder,
  type Config,
  type Violation,
} from '@standards-kit/core';

// Load configuration
const { config, configPath } = loadConfig();

// Create violations
const violation = ViolationBuilder.error({
  rule: 'typescript-strict',
  tool: 'typescript',
  message: 'Strict mode is not enabled',
});

// Create check results
const result = CheckResultBuilder.fail('typescript', 'typescript-strict', [violation]);

// Create domain results
const domain = DomainResultBuilder.fromChecks('code', [result]);
```

## Types

### Violation

```typescript
interface Violation {
  rule: string;
  tool: string;
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}
```

### CheckResult

```typescript
interface CheckResult {
  name: string;
  rule: string;
  passed: boolean;
  skipped: boolean;
  violations: Violation[];
  duration?: number;
}
```

### DomainResult

```typescript
interface DomainResult {
  domain: string;
  status: 'pass' | 'fail' | 'skip';
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}
```
