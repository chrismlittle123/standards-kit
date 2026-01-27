# Contributing to Standards Kit

Thank you for your interest in contributing to Standards Kit.

## Development Setup

### Prerequisites

- Node.js >= 22
- pnpm >= 9.0.0

### Getting Started

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
```

### Project Structure

```
standards-kit/
├── packages/
│   ├── conform/     # In-repo enforcement CLI
│   └── drift/       # Org-wide drift detection CLI
├── docs/            # Documentation
└── .github/         # CI/CD workflows
```

## Development Workflow

### Running Commands

```bash
# Build all packages
pnpm build

# Run tests across all packages
pnpm test

# Run tests in watch mode (per package)
cd packages/conform && pnpm test:watch

# Lint all packages
pnpm lint

# Type check all packages
pnpm typecheck

# Check for unused code
pnpm knip
```

### Making Changes

1. Create a feature branch following the naming convention:
   ```
   (feature|fix|hotfix|docs)/vX.Y.Z/description
   ```
   Example: `feature/v1.0.0/add-new-checker`

2. Make your changes

3. Write or update tests as needed

4. Ensure all checks pass:
   ```bash
   pnpm build && pnpm typecheck && pnpm lint && pnpm test
   ```

5. Create a changeset for your changes:
   ```bash
   pnpm changeset
   ```

6. Commit using conventional commits:
   ```
   feat: add new feature
   fix: resolve bug in checker
   docs: update README
   refactor: improve code structure
   test: add unit tests
   chore: update dependencies
   ```

7. Open a pull request

## Code Standards

This project enforces its own standards via `standards.toml`. Key requirements:

- **TypeScript** - Strict mode enabled
- **ESLint** - All files must pass linting
- **Knip** - No unused exports or dependencies
- **Semantic Commits** - All commits must follow conventional commit format
- **Git Hooks** - Pre-push and commit-msg hooks are enforced via Husky

## Testing

Tests are organized by type:

```
tests/
├── unit/           # Pure unit tests
├── integration/    # Service integration tests
└── e2e/            # End-to-end CLI tests
```

Run tests with coverage:

```bash
cd packages/conform && pnpm test:coverage
```

## Pull Request Guidelines

- Keep PRs focused and reasonably sized (recommended: under 300 lines)
- Include a changeset for user-facing changes
- Ensure CI passes before requesting review
- Update documentation if needed

## Release Process

Releases are automated via GitHub Actions and Changesets:

1. Merge PRs with changesets to `main`
2. A "Version Packages" PR is automatically created
3. Merging the version PR triggers npm publish

## Questions?

Open an issue for questions or discussion.
