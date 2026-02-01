import type { Tool } from '@oldpal/shared';
import type { ToolExecutor } from './registry';

/**
 * Bash tool - execute shell commands (restricted to safe, read-only operations)
 */
function killProcess(proc: { kill: () => void }): void {
  proc.kill();
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
    // Git read-only
    'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote', 'git tag',
    // Connectors
    'connect-',
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
    const timeout = (input.timeout as number) || 30000; // Reduced default timeout

    const commandForChecks = command.replace(/\s*2>&1\s*/g, ' ');

    // Check against blocked patterns
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(commandForChecks)) {
        return `Error: This command is not allowed. Only read-only commands are permitted (ls, cat, grep, find, git status/log/diff, etc.)`;
      }
    }

    // Check if command starts with an allowed prefix
    const commandTrimmed = commandForChecks.trim().toLowerCase();
    let isAllowed = false;
    for (const allowed of this.ALLOWED_COMMANDS) {
      if (commandTrimmed.startsWith(allowed.toLowerCase())) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      return `Error: Command not in allowed list. Permitted commands: cat, head, tail, ls, find, grep, wc, file, stat, pwd, which, echo, git status/log/diff/branch/show, connect-*`;
    }

    try {
      const proc = Bun.spawn(['bash', '-c', command], {
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
        return `Exit code ${exitCode}\n${stderr || stdout}`.trim();
      }

      return stdout.trim() || 'Command completed successfully (no output)';
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

export const __test__ = {
  killProcess,
};
