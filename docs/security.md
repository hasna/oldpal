# Security Model

Assistants enforces layered security controls to reduce risk when running tools and reading/writing files.

## Threat Model

- Command injection through tool inputs
- Path traversal / symlink attacks on file tools
- Information disclosure via unintended file reads
- Unsafe shell commands

## Mitigations

- **Tool input validation** via JSON schema checks (Ajv) with strict defaults.
- **Bash hardening** with allowlist + dangerous pattern detection.
- **Path hardening** with traversal checks, symlink resolution, and protected paths.
- **Size limits** for user messages and tool output to prevent overload.
- **Security event logging** to `~/.assistants/security.log` for auditing.

## Behavior Summary

- Bash commands are restricted to read-only operations and blocked if dangerous patterns are detected.
- File writes are limited to `.assistants/scripts/{session}` and validated against symlink escapes.
- Protected paths cannot be modified (e.g., `~/.ssh`, `/etc/sudoers`).
- Secrets files are protected from reads/writes (e.g., `~/.secrets`).
- Security violations are logged with severity and reason.

## Configuration

You can configure validation limits in `.assistants/config.json`:

```json
{
  "validation": {
    "mode": "strict",
    "maxUserMessageLength": 100000,
    "maxToolOutputLength": 50000,
    "maxFileReadSize": 10485760,
    "perTool": {
      "bash": { "mode": "strict", "allowEnv": true }
    }
  }
}
```

## Security Log

Use `/security-log` to view recent security events (optionally filter):

- `/security-log 50`
- `/security-log high`
- `/security-log blocked_command`
