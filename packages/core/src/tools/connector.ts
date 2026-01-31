import type { Tool, Connector, ConnectorCommand } from '@oldpal/shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { homedir } from 'os';
import { join, basename } from 'path';
import { readdirSync, statSync, readlinkSync } from 'fs';

/**
 * Connector bridge - wraps connect-* CLIs as tools
 */
export class ConnectorBridge {
  private connectors: Map<string, Connector> = new Map();
  private static cache: Map<string, Connector | null> = new Map();

  /**
   * Auto-discover all connect-* CLIs in PATH
   */
  private autoDiscoverConnectorNames(): string[] {
    const connectorNames = new Set<string>();
    const pathDirs = (process.env.PATH || '').split(':');

    // Also check common bun/npm global bin locations
    const extraDirs = [
      join(homedir(), '.bun', 'bin'),
      join(homedir(), '.npm-global', 'bin'),
      '/usr/local/bin',
    ];

    const allDirs = [...new Set([...pathDirs, ...extraDirs])];

    for (const dir of allDirs) {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (file.startsWith('connect-')) {
            const name = file.replace('connect-', '');
            // Skip if it's a common non-connector (like connect.js or similar)
            if (name && !name.includes('.') && name.length > 1) {
              connectorNames.add(name);
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read, skip
      }
    }

    return Array.from(connectorNames);
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
    const uncached = names.filter(n => !ConnectorBridge.cache.has(n));

    if (uncached.length > 0) {
      // Discover uncached connectors in parallel (with timeout)
      const results = await Promise.all(
        uncached.map(async (name) => {
          const cli = `connect-${name}`;

          try {
            // Quick existence check with timeout
            const result = await Promise.race([
              Bun.$`which ${cli}`.quiet().nothrow(),
              new Promise<{ exitCode: number }>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 500)
              )
            ]);

            if (result.exitCode !== 0) {
              ConnectorBridge.cache.set(name, null);
              return null;
            }

            // Lazy: don't run --help, just create minimal connector
            const connector = this.createMinimalConnector(name, cli);
            ConnectorBridge.cache.set(name, connector);
            return connector;
          } catch {
            ConnectorBridge.cache.set(name, null);
            return null;
          }
        })
      );
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
      const manifestPath = join(homedir(), `.connect-${name}`, 'manifest.json');
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
    // Create a single tool per connector with command as a parameter
    return {
      name: connector.name,
      description: `${connector.description}. Available commands: ${connector.commands.map((c) => c.name).join(', ')}`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `The command to run. Available: ${connector.commands.map((c) => `${c.name} (${c.description})`).join('; ')}`,
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

      // Build the command
      const cmdParts = [connector.cli, ...command.split(' '), ...args];

      // Add options
      for (const [key, value] of Object.entries(options)) {
        if (value === true) {
          cmdParts.push(`--${key}`);
        } else if (value !== false && value !== undefined) {
          cmdParts.push(`--${key}`, String(value));
        }
      }

      // Always output as JSON for easier parsing
      if (!cmdParts.includes('--format') && !cmdParts.includes('-f')) {
        cmdParts.push('--format', 'json');
      }

      try {
        const result = await Bun.$`${cmdParts}`.quiet();

        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString().trim();
          return `Error (exit ${result.exitCode}): ${stderr || 'Command failed'}`;
        }

        return result.stdout.toString().trim() || 'Command completed successfully';
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
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
