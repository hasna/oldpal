import type { Tool } from '@oldpal/shared';
import type { ToolExecutor } from './registry';

/**
 * Bash tool - execute shell commands
 */
export class BashTool {
  static readonly tool: Tool = {
    name: 'bash',
    description: 'Execute a shell command. Use for system operations, running scripts, git commands, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
      },
      required: ['command'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const command = input.command as string;
    const cwd = (input.cwd as string) || process.cwd();
    const timeout = (input.timeout as number) || 120000;

    // Safety checks - block dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+[\/~]/i,
      /rm\s+-rf\s+\*/i,
      /mkfs/i,
      /dd\s+if=/i,
      />\s*\/dev\/sd/i,
      /chmod\s+-R\s+777\s+\//i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return `Error: This command appears dangerous and was blocked for safety.`;
      }
    }

    try {
      const proc = Bun.spawn(['bash', '-c', command], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        proc.kill();
      }, timeout);

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
