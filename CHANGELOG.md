# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open source release
- Multi-package monorepo structure (core, terminal, web, shared, runtime-bun, runtime-node)
- Terminal UI with Ink (React for CLI)
- Web UI with Next.js and React
- Claude API integration via Anthropic SDK
- SQLite database with Drizzle ORM
- Skill system for extensibility
- Hook system for customization
- Voice support (TTS/STT)
- Session management
- Agent management
- Message threading
- Tool registry
- Connector bridge for CLI tools

### Security
- JWT-based authentication
- OAuth 2.0 support (Google)
- Secure password hashing

## [0.6.54] - 2024

### Fixed
- Terminal initialization hang when cleanup races with async init
- Registry cleanup on effect re-run

## [0.6.53] - 2024

### Fixed
- Terminal initialization issues

---

## Version History

For detailed version history, see the [git log](https://github.com/hasna/assistants/commits/main).

## Release Process

1. Update version in `package.json`
2. Update this CHANGELOG
3. Create a git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
4. Push tags: `git push --tags`
5. Publish to npm: `pnpm publish`
