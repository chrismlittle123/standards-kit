# @standards-kit/drift

Org-wide drift detection CLI. Scans repositories across your organization to detect configuration drift from standards.

## Installation

```bash
npm install -g @standards-kit/drift
```

## Quick Start

```bash
# Scan organization for code drift
drift code scan --org myorg

# Scan for process drift
drift process scan --org myorg

# Scan for infrastructure drift
drift infra scan --org myorg
```

## Authentication

Drift requires GitHub authentication to scan repositories:

```bash
# Set GitHub token
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# Or use GitHub CLI authentication
gh auth login
```

## Commands

### Code Drift

Detect repositories with code standards drift:

```bash
# Scan all repos in organization
drift code scan --org myorg

# Filter by topic
drift code scan --org myorg --topic typescript

# Check specific repos
drift code scan --repos repo1,repo2,repo3
```

Detects:
- Missing or outdated `standards.toml`
- Dependency version drift
- TypeScript configuration drift
- ESLint/Prettier configuration drift

### Process Drift

Detect repositories with process standards drift:

```bash
drift process scan --org myorg
```

Detects:
- Missing branch protection rules
- Outdated GitHub Actions workflows
- Missing required files (README, LICENSE, etc.)
- CI/CD configuration drift

### Infra Drift

Detect repositories with infrastructure configuration drift:

```bash
drift infra scan --org myorg
```

Detects:
- Infrastructure manifest drift
- Resource configuration drift
- Missing or misconfigured resources

## Output Formats

```bash
# Table output (default)
drift code scan --org myorg

# JSON output
drift code scan --org myorg --format json

# Create GitHub issues for drift
drift code scan --org myorg --create-issues
```

## Configuration

Drift can be configured via environment variables:

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub API token |
| `DRIFT_ORG` | Default organization to scan |
| `DRIFT_CONCURRENCY` | Number of concurrent repo scans (default: 5) |

## Scheduled Scanning

For continuous drift detection, run drift on a schedule:

```yaml
# .github/workflows/drift-scan.yml
name: Drift Scan
on:
  schedule:
    - cron: '0 9 * * 1'  # Weekly on Monday
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @standards-kit/drift
      - run: drift code scan --org ${{ github.repository_owner }} --create-issues
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## License

MIT
