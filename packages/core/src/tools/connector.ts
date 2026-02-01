import type { Tool, Connector, ConnectorCommand } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { homedir } from 'os';
import { join, delimiter } from 'path';
import { readdirSync, statSync } from 'fs';
import { ConnectorError, ErrorCodes } from '../errors';

type TimeoutResolve = (value: { exitCode: number }) => void;

function resolveTimeout(resolve: TimeoutResolve): void {
  resolve({ exitCode: 1 });
}

/**
 * Connector bridge - wraps connect-* CLIs as tools
 */
export class ConnectorBridge {
  private connectors: Map<string, Connector> = new Map();
  private static cache: Map<string, Connector | null> = new Map();

  private getHomeDir(): string {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    return envHome && envHome.trim().length > 0 ? envHome : homedir();
  }

  /**
   * Auto-discover all connect-* CLIs in PATH
   */
  private autoDiscoverConnectorNames(): string[] {
    const connectorNames = new Set<string>();
    const pathDirs = (process.env.PATH || '').split(delimiter);

    // Also check common bun/npm global bin locations
    const homeDir = this.getHomeDir();
    const extraDirs = [
      join(homeDir, '.bun', 'bin'),
      join(homeDir, '.npm-global', 'bin'),
      '/usr/local/bin',
    ];

    const allDirs = [...new Set([...pathDirs, ...extraDirs])];

    for (const dir of allDirs) {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (!file.startsWith('connect-')) {
            continue;
          }

          const fullPath = join(dir, file);
          let stats;
          try {
            stats = statSync(fullPath);
          } catch {
            continue;
          }

          if (!stats.isFile()) {
            continue;
          }

          const name = file.replace('connect-', '');
          // Skip if it's a common non-connector (like connect.js or similar)
          if (name && !name.includes('.') && name.length > 1) {
            connectorNames.add(name);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read, skip
      }
    }

    return Array.from(connectorNames);
  }

  /**
   * Fast discovery: scan PATH once and register minimal connectors immediately.
   * This avoids slower per-connector checks and allows tools to be available right away.
   */
  fastDiscover(connectorNames?: string[]): Connector[] {
    const discoveredNames = this.autoDiscoverConnectorNames();
    const allowList = connectorNames && connectorNames.length > 0
      ? new Set(connectorNames)
      : null;
    const names = allowList
      ? discoveredNames.filter((name) => allowList.has(name))
      : discoveredNames;

    if (names.length === 0) {
      return [];
    }

    const connectors: Connector[] = [];
    for (const name of names) {
      const cached = ConnectorBridge.cache.get(name);
      if (cached) {
        this.connectors.set(cached.name, cached);
        connectors.push(cached);
        continue;
      }
      if (cached === null) {
        continue;
      }
      const connector = this.createMinimalConnector(name, `connect-${name}`);
      ConnectorBridge.cache.set(name, connector);
      this.connectors.set(connector.name, connector);
      connectors.push(connector);
    }

    return connectors;
  }

  /**
   * Discover available connectors (auto-discovers if no names provided)
   */
  async discover(connectorNames?: string[]): Promise<Connector[]> {
    // Auto-discover if no names provided, or use provided list
    const names = connectorNames && connectorNames.length > 0
      ? connectorNames
      : this.autoDiscoverConnectorNames();

    if (names.length === 0) {
      // No connectors found
      return [];
    }

    // Check cache first
    const uncached: string[] = [];
    for (const name of names) {
      if (!ConnectorBridge.cache.has(name)) {
        uncached.push(name);
      }
    }

    if (uncached.length > 0) {
      // Discover uncached connectors in parallel (with timeout)
      const tasks: Array<Promise<void>> = [];
      for (const name of uncached) {
        tasks.push(this.populateCache(name));
      }
      await Promise.all(tasks);
    }

    // Return all cached connectors
    const discovered: Connector[] = [];
    for (const name of names) {
      const connector = ConnectorBridge.cache.get(name);
      if (connector) {
        discovered.push(connector);
        this.connectors.set(connector.name, connector);
      }
    }

    return discovered;
  }

  /**
   * Create minimal connector without running --help (lazy discovery)
   */
  private createMinimalConnector(name: string, cli: string): Connector {
    return {
      name,
      cli,
      description: `${name} connector`,
      commands: [
        { name: 'help', description: 'Show available commands', args: [], options: [] },
      ],
      auth: {
        type: 'oauth2',
        statusCommand: `${cli} auth status`,
      },
    };
  }

  private async populateCache(name: string): Promise<void> {
    const cli = `connect-${name}`;

    try {
      // Quick existence check with timeout
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ exitCode: number }>((resolve) => {
        timeoutId = setTimeout(resolveTimeout, 500, resolve);
      });

      const result = await Promise.race([
        Bun.$`which ${cli}`.quiet().nothrow(),
        timeoutPromise,
      ]);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (result.exitCode !== 0) {
        ConnectorBridge.cache.set(name, null);
        return;
      }

      // Lazy: don't run --help, just create minimal connector
      const connector = this.createMinimalConnector(name, cli);
      ConnectorBridge.cache.set(name, connector);
    } catch {
      ConnectorBridge.cache.set(name, null);
    }
  }

  /**
   * Discover a single connector's commands from its CLI help
   */
  private async discoverConnector(name: string, cli: string): Promise<Connector | null> {
    try {
      // Get help output
      const helpResult = await Bun.$`${cli} --help`.quiet();
      const helpText = helpResult.stdout.toString();

      // Parse commands from help output
      const commands = this.parseHelpOutput(helpText, name);

      // Try to load manifest if available
      const manifestPath = join(this.getHomeDir(), `.connect-${name}`, 'manifest.json');
      let description = `${name} connector`;

      try {
        const manifest = await Bun.file(manifestPath).json();
        if (manifest.description) {
          description = manifest.description;
        }
      } catch {
        // No manifest, use default description
      }

      return {
        name,
        cli,
        description,
        commands,
        auth: {
          type: 'oauth2',
          statusCommand: `${cli} auth status`,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse help output to discover commands
   * This is a simplified parser - connectors should ideally provide manifests
   */
  private parseHelpOutput(helpText: string, name: string): ConnectorCommand[] {
    const commands: ConnectorCommand[] = [];
    const lines = helpText.split('\n');

    // Look for command patterns in help output
    // Common pattern: "  command-name    Description"
    let inCommands = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('commands:')) {
        inCommands = true;
        continue;
      }

      if (inCommands && line.trim()) {
        const match = line.match(/^\s{2,}(\S+)\s{2,}(.+)$/);
        if (match) {
          const [, cmdName, description] = match;
          // Skip help and version commands
          if (['help', 'version', '-h', '--help', '-v', '--version'].includes(cmdName)) {
            continue;
          }
          commands.push({
            name: cmdName,
            description: description.trim(),
            args: [],
            options: [],
          });
        }
      }

      // Stop if we hit another section
      if (inCommands && line.match(/^\S/) && !line.match(/^\s/)) {
        inCommands = false;
      }
    }

    // If no commands found, add generic ones based on common patterns
    if (commands.length === 0) {
      commands.push(
        { name: 'auth status', description: 'Check authentication status', args: [], options: [] },
        { name: 'help', description: 'Show help', args: [], options: [] }
      );
    }

    return commands;
  }

  /**
   * Register all discovered connectors as tools
   */
  registerAll(registry: ToolRegistry): void {
    for (const [name, connector] of this.connectors) {
      const tool = this.createTool(connector);
      const executor = this.createExecutor(connector);
      registry.register(tool, executor);
    }
  }

  /**
   * Create a tool definition from a connector
   */
  private createTool(connector: Connector): Tool {
    const commandNames: string[] = [];
    for (const cmd of connector.commands) {
      commandNames.push(cmd.name);
    }

    const commandDescriptions: string[] = [];
    for (const cmd of connector.commands) {
      commandDescriptions.push(`${cmd.name} (${cmd.description})`);
    }

    // Create a single tool per connector with command as a parameter
    return {
      name: connector.name,
      description: `${connector.description}. Available commands: ${commandNames.join(', ')}`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `The command to run. Available: ${commandDescriptions.join('; ')}`,
          },
          args: {
            type: 'array',
            description: 'Arguments to pass to the command',
            items: { type: 'string', description: 'Argument value' },
          },
          options: {
            type: 'object',
            description: 'Options to pass to the command (key-value pairs)',
          },
        },
        required: ['command'],
      },
    };
  }

  /**
   * Create an executor function for a connector
   */
  private createExecutor(connector: Connector): ToolExecutor {
    return async (input: Record<string, unknown>): Promise<string> => {
      const command = input.command as string;
      const args = (input.args as string[]) || [];
      const options = (input.options as Record<string, unknown>) || {};
      const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
      const timeoutMs = Number(options.timeoutMs || options.timeout || 15000);

      // Build the command
      const cmdParts = [connector.cli, ...command.split(' '), ...args];

      // Add options
      for (const [key, value] of Object.entries(options)) {
        if (key === 'timeoutMs' || key === 'timeout') continue;
        if (value === true) {
          cmdParts.push(`--${key}`);
        } else if (value !== false && value !== undefined) {
          cmdParts.push(`--${key}`, String(value));
        }
      }

      const lowerCommand = command.toLowerCase();
      const lowerArgs = args.map((arg) => arg.toLowerCase());
      const combined = [lowerCommand, ...lowerArgs].join(' ');
      const isAuthLogin =
        /\bauth\b/.test(combined) &&
        /(login|authorize|authorization|oauth|signin|sign-in|connect)/.test(combined);
      const runInBackground = options.background === true;

      if (isAuthLogin || runInBackground) {
        try {
          const proc = Bun.spawn(cmdParts, {
            cwd,
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'pipe',
          });
          proc.unref?.();
        } catch {
          // ignore spawn errors; fall through to error message below
        }
        return isAuthLogin
          ? 'Auth login started in the background. Complete it in your browser, then run auth status to confirm.'
          : 'Command started in the background.';
      }

      try {
        const proc = Bun.spawn(cmdParts, {
          cwd,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(timer);

        if (timedOut) {
          throw new ConnectorError(
            `Command timed out after ${Math.round((Number.isFinite(timeoutMs) ? timeoutMs : 15000) / 1000)}s.`,
            {
              connectorName: connector.name,
              command,
              code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
              recoverable: true,
              retryable: true,
              suggestion: 'Try again or increase the timeout.',
            }
          );
        }

        if (exitCode !== 0) {
          const stderrText = stderr.toString().trim();
          const stdoutText = stdout.toString().trim();
          throw new ConnectorError(`Exit ${exitCode}: ${stderrText || stdoutText || 'Command failed'}`, {
            connectorName: connector.name,
            command,
            code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
            recoverable: true,
            retryable: false,
          });
        }

        return stdout.toString().trim() || 'Command completed successfully';
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        throw new ConnectorError(error instanceof Error ? error.message : String(error), {
          connectorName: connector.name,
          command,
          code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
          recoverable: true,
          retryable: false,
        });
      }
    };
  }

  /**
   * Get a connector by name
   */
  getConnector(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  /**
   * Get all connectors
   */
  getConnectors(): Connector[] {
    return Array.from(this.connectors.values());
  }
}

export const __test__ = {
  resolveTimeout,
};
