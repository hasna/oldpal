import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ErrorCodes, ToolExecutionError } from '../errors';
import { getSecurityLogger } from '../security/logger';
import { validateBashCommand } from '../security/bash-validator';
import { loadConfig } from '../config';

/**
 * Bash tool - execute shell commands (restricted to safe, read-only operations)
 */
function killProcess(proc: { kill: () => void }): void {
  proc.kill();
}

function stripQuotedSegments(input: string): string {
  let result = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quote) {
      if (quote === '"' && !escaped && char === '\\') {
        escaped = true;
        continue;
      }
      if (!escaped && char === quote) {
        quote = null;
        result += char;
        continue;
      }
      escaped = false;
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
}

function normalizeNewlinesOutsideQuotes(input: string): string {
  let result = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quote) {
      result += char;
      if (quote === '"' && !escaped && char === '\\') {
        escaped = true;
        continue;
      }
      if (!escaped && char === quote) {
        quote = null;
      }
      escaped = false;
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      result += char;
      continue;
    }

    if (char === '\r' || char === '\n') {
      result += ' ';
      continue;
    }

    result += char;
  }

  return result;
}

export class BashTool {
  static readonly tool: Tool = {
    name: 'bash',
    description: 'Execute a shell command. RESTRICTED to read-only operations: ls, cat, grep, find, git status/log/diff, pwd, which, echo. Cannot modify files, install packages, or run destructive commands.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (read-only commands only)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  };

  // Allowed command prefixes (read-only operations)
  private static readonly ALLOWED_COMMANDS = [
    // File reading
    'cat', 'head', 'tail', 'less', 'more',
    // Directory listing
    'ls', 'tree', 'find', 'locate',
    // Search
    'grep', 'rg', 'ag', 'ack',
    // File info
    'wc', 'file', 'stat', 'du', 'df',
    // System info
    'pwd', 'whoami', 'date', 'which', 'where', 'type', 'env', 'printenv',
    // Echo for simple output
    'echo',
    // HTTP requests
    'curl',
    // Git read-only
    'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote', 'git tag',
    // Connectors
    'connect-',
    'connect_',
    // Node/bun info
    'node --version', 'bun --version', 'npm --version', 'pnpm --version',
  ];

  // Explicitly blocked commands
  private static readonly BLOCKED_PATTERNS = [
    // Deletion
    /\brm\b/, /\brmdir\b/, /\bunlink\b/,
    // Modification
    /\bmv\b/, /\bcp\b/,
    // Permission changes
    /\bchmod\b/, /\bchown\b/, /\bchgrp\b/,
    // Privilege escalation
    /\bsudo\b/, /\bsu\b/, /\bdoas\b/,
    // Package installation
    /\bnpm\s+(install|i|add|ci)\b/, /\bpnpm\s+(install|i|add)\b/,
    /\byarn\s+(install|add)\b/, /\bbun\s+(install|add|i)\b/,
    /\bpip\s+install\b/, /\bpip3\s+install\b/,
    /\bbrew\s+install\b/, /\bapt\s+install\b/, /\bapt-get\s+install\b/,
    // Git writes
    /\bgit\s+(push|commit|checkout|reset|rebase|merge|pull|stash|cherry-pick|revert)\b/,
    /\bgit\s+add\b/,
    /\bgit\s+remote\s+(add|set-url|remove|rm|rename)\b/,
    /\bgit\s+tag\s+(-d|--delete|-f)\b/,
    /\bgit\s+branch\s+(-d|-D|-m|--delete|--move)\b/,
    // Dangerous pipes
    /\|\s*(bash|sh|zsh|fish)\b/,
    /curl.*\|\s*(bash|sh)/, /wget.*\|\s*(bash|sh)/,
    // Shell chaining/operators (enforce single command)
    /[;&]/, /[|]/, /[\r\n]/,
    // File writing via redirection
    />\s*[^|]/, />>/,
    // Process control
    /\bkill\b/, /\bpkill\b/, /\bkillall\b/,
    // System modification
    /\bmkfs\b/, /\bdd\b/, /\bfdisk\b/, /\bparted\b/,
    // Network dangerous
    /\bnc\s+-l/, /\bnetcat\s+-l/,
    // Editors (would hang)
    /\bvim?\b/, /\bnano\b/, /\bemacs\b/,
    // Make/build (can modify)
    /\bmake\b/, /\bcmake\b/,
    // Docker (can be dangerous)
    /\bdocker\s+(run|exec|build|push)\b/,
  ];

  static readonly executor: ToolExecutor = async (input) => {
    const command = input.command as string;
    const cwd = (input.cwd as string) || process.cwd();
    const timeoutInput = Number(input.timeout);
    const timeout = Number.isFinite(timeoutInput) && timeoutInput > 0 ? timeoutInput : 30000; // Reduced default timeout

    let allowEnv = true;
    try {
      const config = await loadConfig(cwd);
      allowEnv = config.validation?.perTool?.bash?.allowEnv ?? true;
    } catch {
      allowEnv = true;
    }

    const baseCommand = command.replace(/\s*2>&1\s*/g, ' ').trim();
    const baseTrimmed = baseCommand.toLowerCase();
    const allowConnectorNewlines = baseTrimmed.startsWith('connect-') || baseTrimmed.startsWith('connect_');
    const commandForExec = allowConnectorNewlines
      ? normalizeNewlinesOutsideQuotes(baseCommand).trim()
      : baseCommand;
    const commandForChecks = commandForExec;
    const commandSansQuotes = stripQuotedSegments(commandForChecks);

    const securityCheck = validateBashCommand(commandForChecks);
    if (!securityCheck.valid) {
      getSecurityLogger().log({
        eventType: 'blocked_command',
        severity: securityCheck.severity || 'high',
        details: {
          tool: 'bash',
          command,
          reason: securityCheck.reason || 'Blocked command',
        },
        sessionId: (input.sessionId as string) || 'unknown',
      });
      throw new ToolExecutionError(securityCheck.reason || 'Blocked command', {
        toolName: 'bash',
        toolInput: input,
        code: ErrorCodes.TOOL_PERMISSION_DENIED,
        recoverable: false,
        retryable: false,
        suggestion: 'Use read-only commands only.',
      });
    }

    // Check against blocked patterns
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(commandSansQuotes)) {
        getSecurityLogger().log({
          eventType: 'blocked_command',
          severity: 'high',
          details: {
            tool: 'bash',
            command,
            reason: 'Blocked command pattern detected',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(
          'This command is not allowed. Only read-only commands are permitted (ls, cat, grep, find, git status/log/diff, etc.)',
          {
            toolName: 'bash',
            toolInput: input,
            code: ErrorCodes.TOOL_PERMISSION_DENIED,
            recoverable: false,
            retryable: false,
            suggestion: 'Use a read-only command from the allowed list.',
          }
        );
      }
    }

    const commandTrimmed = commandForChecks.trim().toLowerCase();
    const isEnvCommand = /^(env|printenv)(\s|$)/.test(commandTrimmed);
    if (!allowEnv && isEnvCommand) {
      getSecurityLogger().log({
        eventType: 'blocked_command',
        severity: 'medium',
        details: {
          tool: 'bash',
          command,
          reason: 'env/printenv disabled by config',
        },
        sessionId: (input.sessionId as string) || 'unknown',
      });
      throw new ToolExecutionError(
        'Command not allowed: env/printenv disabled by config.',
        {
          toolName: 'bash',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
          suggestion: 'Enable validation.perTool.bash.allowEnv to allow env/printenv.',
        }
      );
    }

    // Check if command starts with an allowed prefix
    let isAllowed = false;
    const allowlist = allowEnv
      ? this.ALLOWED_COMMANDS
      : this.ALLOWED_COMMANDS.filter((allowed) => allowed !== 'env' && allowed !== 'printenv');
    for (const allowed of allowlist) {
      if (commandTrimmed.startsWith(allowed.toLowerCase())) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      getSecurityLogger().log({
        eventType: 'blocked_command',
        severity: 'medium',
        details: {
          tool: 'bash',
          command,
          reason: 'Command not in allowlist',
        },
        sessionId: (input.sessionId as string) || 'unknown',
      });
      throw new ToolExecutionError(
        'Command not in allowed list. Permitted commands: cat, head, tail, ls, find, grep, wc, file, stat, pwd, which, echo, curl, git status/log/diff/branch/show, connect-*',
        {
          toolName: 'bash',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
          suggestion: 'Use a permitted read-only command.',
        }
      );
    }

    try {
      const proc = Bun.spawn(['bash', '-c', commandForExec], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      const timeoutId = setTimeout(killProcess, timeout, proc);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      clearTimeout(timeoutId);

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new ToolExecutionError(`Exit code ${exitCode}\n${stderr || stdout}`.trim(), {
          toolName: 'bash',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }

      return stdout.trim() || 'Command completed successfully (no output)';
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'bash',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

export const __test__ = {
  killProcess,
};
