# Contributing to Assistants

Thank you for your interest in contributing to Assistants! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0.0
- [pnpm](https://pnpm.io/) >= 9.15.0
- Node.js >= 18 (for some tooling)

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/assistants.git
   cd assistants
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Run the development server:
   ```bash
   pnpm dev
   ```

## Development Workflow

### Project Structure

```
packages/
├── core/           # Platform-agnostic agent runtime
├── terminal/       # Ink-based terminal UI
├── shared/         # Shared types and utilities
├── web/            # Web UI (React/Next.js)
├── runtime-bun/    # Bun runtime implementation
└── runtime-node/   # Node.js runtime implementation
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests for a specific package
pnpm --filter @assistants/core test
```

### Type Checking

```bash
pnpm typecheck
```

### Building

```bash
pnpm build
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feat/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/what-changed` - Documentation changes
- `refactor/what-changed` - Code refactoring
- `test/what-tested` - Test additions/changes

### Commit Messages

Follow conventional commit format:
- `feat: add new feature`
- `fix: resolve bug in X`
- `docs: update README`
- `refactor: simplify Y logic`
- `test: add tests for Z`
- `chore: update dependencies`

### Pull Request Process

1. Create a new branch from `main`
2. Make your changes
3. Ensure all tests pass (`pnpm test`)
4. Ensure type checking passes (`pnpm typecheck`)
5. Push your branch and create a pull request
6. Fill out the PR template with relevant details
7. Wait for review and address any feedback

### Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Update documentation as needed
- Ensure CI passes before requesting review

## Reporting Issues

When reporting issues, please include:

1. A clear, descriptive title
2. Steps to reproduce the issue
3. Expected behavior
4. Actual behavior
5. Environment details (OS, Bun version, etc.)
6. Relevant logs or error messages

## Feature Requests

Feature requests are welcome! Please:

1. Check existing issues to avoid duplicates
2. Describe the use case and motivation
3. Explain the proposed solution
4. Consider implementation complexity

## Questions?

If you have questions, feel free to:
- Open a discussion on GitHub
- Check existing issues and discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
