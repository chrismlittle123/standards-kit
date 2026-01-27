# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Standards Kit, please report it responsibly.

### How to Report

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting feature
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

### What to Expect

- Acknowledgment within 48 hours
- Regular updates on progress
- Credit in the security advisory (unless you prefer anonymity)

## Security Considerations

### Credentials and Secrets

Standards Kit tools interact with cloud providers and GitHub. Important security notes:

#### @standards-kit/conform

- **AWS Credentials**: The infra domain uses AWS SDK clients. Credentials are loaded via the standard AWS credential chain (environment variables, shared credentials file, IAM roles)
- **GCP Credentials**: Uses Google Cloud client libraries with Application Default Credentials
- **No credential storage**: Conform does not store or cache credentials

#### @standards-kit/drift

- **GitHub Token**: Requires `GITHUB_TOKEN` environment variable for API access
- **Token scope**: Requires `repo` scope for private repositories, `public_repo` for public only
- **No token storage**: Drift reads tokens from environment variables only

### Best Practices

1. **Never commit credentials** - Use environment variables or secret managers
2. **Use minimal token scopes** - Only grant necessary permissions
3. **Rotate credentials regularly** - Especially for CI/CD tokens
4. **Audit access** - Review who has access to tokens used with drift

### Dependencies

- Dependencies are regularly updated
- Security advisories are monitored via GitHub Dependabot
- Run `npm audit` to check for known vulnerabilities

## Security Features

Standards Kit can help improve your security posture:

- **Gitleaks integration** - Scans for accidentally committed secrets
- **Security scanning** - Identifies common security issues in code
- **CI/CD validation** - Ensures security checks are part of your pipeline

## Scope

This security policy applies to:

- `@standards-kit/conform`
- `@standards-kit/drift`
- This GitHub repository

Third-party dependencies have their own security policies.
