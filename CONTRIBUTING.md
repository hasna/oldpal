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
4. Set up environment:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```
5. Run the terminal app:
   ```bash
   cd packages/terminal
   bun run dev
   ```

## Development Workflow

### Project Structure

```
packages/
├── core/           # Platform-agnostic agent runtime
│   ├── agent/      # Agent loop and context
│   ├── tools/      # Built-in tools (Bash, Read, Write, etc.)
│   ├── skills/     # Skill loading and execution
│   ├── hooks/      # Hook system
│   └── ...
├── terminal/       # Ink-based terminal UI
│   ├── src/
│   │   ├── components/  # React/Ink components
│   │   ├── cli/         # CLI argument parsing
│   │   └── ...
│   └── examples/   # Usage examples
├── shared/         # Shared types and utilities
├── web/            # Web UI (React/Next.js)
└── runtime-bun/    # Bun runtime implementation
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/core
bun test

# Watch mode
bun test --watch

# Run a specific test file
bun test src/tools/registry.test.ts
```

### Type Checking

```bash
pnpm typecheck
```

### Building

```bash
# Build all packages
pnpm build

# Build terminal package only
cd packages/terminal
bun run build
```

## Code Style

### TypeScript

- Use TypeScript for all code
- Enable strict mode
- Prefer explicit return types for public functions
- Use `type` for simple type aliases, `interface` for extendable objects

### Formatting

- 2 spaces for indentation
- Single quotes for strings
- Max line length: 100 characters
- No trailing semicolons (match existing code)

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `tool-registry.ts` |
| Classes | PascalCase | `ToolRegistry` |
| Functions | camelCase | `registerTool` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES` |
| Types/Interfaces | PascalCase | `ToolConfig` |

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
- `feat(package): add new feature`
- `fix(core): resolve bug in X`
- `docs: update README`
- `refactor(terminal): simplify Y logic`
- `test(core): add tests for Z`
- `chore: update dependencies`

### Pull Request Process

1. Create a new branch from `main`
2. Make your changes
3. Write/update tests as needed
4. Ensure all tests pass (`pnpm test`)
5. Ensure type checking passes (`pnpm typecheck`)
6. Push your branch and create a pull request
7. Fill out the PR template with relevant details
8. Wait for review and address any feedback

### Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Update documentation as needed
- Ensure CI passes before requesting review

## Adding Features

### New Tools

1. Create tool file in `packages/core/src/tools/`
2. Define tool schema and executor
3. Export from `packages/core/src/tools/index.ts`
4. Add tests
5. Update documentation

```typescript
// packages/core/src/tools/my-tool.ts
import type { Tool, ToolExecutor } from '../registry';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' },
    },
    required: ['input'],
  },
};

export const myToolExecutor: ToolExecutor = async (params) => {
  // Implementation
  return { result: 'success' };
};
```

### New Slash Commands

1. Add command to `packages/core/src/commands/builtin.ts`
2. Implement the handler function
3. Add tests
4. Update README

### New Skills

Create a `SKILL.md` file in `~/.assistants/skills/my-skill/`:

```markdown
---
name: my-skill
description: What this skill does
argument-hint: <file>
allowed-tools: Read, Write
---

## Instructions

Your prompt instructions here.
Use $ARGUMENTS for user input.
```

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

## Security Issues

**Do not create public issues for security vulnerabilities.**

Please report security concerns privately.

## Questions?

If you have questions, feel free to:
- Open a [Discussion](https://github.com/hasna/assistants/discussions)
- Check existing [Issues](https://github.com/hasna/assistants/issues)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
