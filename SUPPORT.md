# Support

Thank you for using Assistants! This document explains how to get help and support.

## Getting Help

### Documentation

Before seeking support, please check:

1. **README.md** - Overview and getting started guide
2. **CLAUDE.md** - Development guide and architecture
3. **CONTRIBUTING.md** - Contribution guidelines

### Community Support

For questions, discussions, and community support:

- **GitHub Discussions** - Ask questions, share ideas, and connect with other users
  - [Start a discussion](https://github.com/hasna/assistants/discussions)

- **GitHub Issues** - Report bugs or request features
  - [View existing issues](https://github.com/hasna/assistants/issues)
  - [Create a new issue](https://github.com/hasna/assistants/issues/new/choose)

### Response Expectations

This is an open source project maintained by volunteers. Please be patient:

- **Bug Reports** - We aim to triage within a week
- **Feature Requests** - Reviewed based on community demand and project roadmap
- **Pull Requests** - Reviewed as maintainer time permits
- **Questions** - Community members may respond faster than maintainers

## Reporting Bugs

When reporting a bug, please include:

1. Clear description of the issue
2. Steps to reproduce
3. Expected vs actual behavior
4. Environment details (OS, Bun version, etc.)
5. Relevant logs or error messages

Use the [bug report template](https://github.com/hasna/assistants/issues/new?template=bug_report.yml).

## Security Issues

**Do not report security vulnerabilities through public GitHub issues.**

Please report security issues privately:
- See [SECURITY.md](./SECURITY.md) for our security policy
- Use GitHub's [private vulnerability reporting](https://github.com/hasna/assistants/security/advisories/new)

## Feature Requests

We welcome feature requests! Please:

1. Search existing issues to avoid duplicates
2. Describe the use case and motivation
3. Explain how it would benefit users

Use the [feature request template](https://github.com/hasna/assistants/issues/new?template=feature_request.yml).

## Commercial Support

For commercial support inquiries, please contact the maintainers directly.

## Self-Help Resources

### Common Issues

**Installation Problems**
- Ensure Bun >= 1.0.0 is installed
- Try `pnpm install --force` to reinstall dependencies

**Build Errors**
- Run `pnpm clean` then `pnpm install`
- Check TypeScript errors with `pnpm typecheck`

**Runtime Errors**
- Check environment variables are set correctly
- Review logs for detailed error messages

### Debugging

Enable debug logging:
```bash
DEBUG=* pnpm dev
```

## Contributing

If you'd like to help improve Assistants:

1. Read [CONTRIBUTING.md](./CONTRIBUTING.md)
2. Check [good first issues](https://github.com/hasna/assistants/labels/good%20first%20issue)
3. Join the community discussion

Your contributions help make Assistants better for everyone!
