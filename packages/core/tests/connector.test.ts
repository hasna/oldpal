import { describe, expect, test, beforeEach } from 'bun:test';
import { ConnectorBridge } from '../src/tools/connector';
import { ToolRegistry } from '../src/tools/registry';
import type { Connector, ConnectorCommand } from '@oldpal/shared';

describe('ConnectorBridge', () => {
  let bridge: ConnectorBridge;

  beforeEach(() => {
    bridge = new ConnectorBridge();
  });

  describe('parseHelpOutput', () => {
    // Access private method for testing via type assertion
    const parseHelp = (bridge: ConnectorBridge, helpText: string, name: string): ConnectorCommand[] => {
      return (bridge as any).parseHelpOutput(helpText, name);
    };

    test('should parse commands from standard help output', () => {
      const helpText = `
connect-notion v1.0.0

Usage: connect-notion [command] [options]

Commands:
  search      Search for pages and databases
  get         Get a page or database by ID
  create      Create a new page
  update      Update an existing page

Options:
  --help      Show help
  --version   Show version
`;

      const commands = parseHelp(bridge, helpText, 'notion');
      expect(commands.length).toBeGreaterThanOrEqual(4);
      expect(commands.map((c) => c.name)).toContain('search');
      expect(commands.map((c) => c.name)).toContain('get');
      expect(commands.map((c) => c.name)).toContain('create');
    });

    test('should skip help and version commands', () => {
      const helpText = `
Commands:
  search      Search for items
  help        Show help
  --help      Show help
  version     Show version
  -v          Show version
`;

      const commands = parseHelp(bridge, helpText, 'test');
      const names = commands.map((c) => c.name);
      expect(names).toContain('search');
      expect(names).not.toContain('help');
      expect(names).not.toContain('--help');
      expect(names).not.toContain('version');
      expect(names).not.toContain('-v');
    });

    test('should return default commands when none found', () => {
      const helpText = `
connect-example v1.0.0

This is a tool with no documented commands.
`;

      const commands = parseHelp(bridge, helpText, 'example');
      expect(commands.length).toBeGreaterThan(0);
      // Should have fallback commands
      const names = commands.map((c) => c.name);
      expect(names).toContain('auth status');
    });

    test('should handle multi-word command descriptions', () => {
      const helpText = `
Commands:
  list-pages    List all available pages in the workspace
  sync-all      Synchronize all data from remote
`;

      const commands = parseHelp(bridge, helpText, 'test');
      const listCmd = commands.find((c) => c.name === 'list-pages');
      expect(listCmd).toBeDefined();
      expect(listCmd?.description).toContain('pages');
    });
  });

  describe('createTool', () => {
    // Access private method for testing
    const createTool = (bridge: ConnectorBridge, connector: Connector) => {
      return (bridge as any).createTool(connector);
    };

    test('should create tool definition from connector', () => {
      const connector: Connector = {
        name: 'notion',
        cli: 'connect-notion',
        description: 'Notion integration',
        commands: [
          { name: 'search', description: 'Search pages', args: [], options: [] },
          { name: 'get', description: 'Get page', args: [], options: [] },
        ],
      };

      const tool = createTool(bridge, connector);
      expect(tool.name).toBe('notion');
      expect(tool.description).toContain('Notion integration');
      expect(tool.description).toContain('search');
      expect(tool.description).toContain('get');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.command).toBeDefined();
      expect(tool.parameters.required).toContain('command');
    });

    test('should include command descriptions in tool', () => {
      const connector: Connector = {
        name: 'gmail',
        cli: 'connect-gmail',
        description: 'Gmail integration',
        commands: [
          { name: 'list', description: 'List emails', args: [], options: [] },
          { name: 'send', description: 'Send an email', args: [], options: [] },
        ],
      };

      const tool = createTool(bridge, connector);
      expect(tool.parameters.properties.command.description).toContain('list (List emails)');
      expect(tool.parameters.properties.command.description).toContain('send (Send an email)');
    });
  });

  describe('getConnector and getConnectors', () => {
    test('should return undefined for non-existent connector', () => {
      expect(bridge.getConnector('non-existent')).toBeUndefined();
    });

    test('should return empty array when no connectors discovered', () => {
      expect(bridge.getConnectors()).toEqual([]);
    });
  });

  describe('registerAll', () => {
    test('should register tools to registry', async () => {
      const registry = new ToolRegistry();

      // Manually add a connector for testing
      const connector: Connector = {
        name: 'test',
        cli: 'connect-test',
        description: 'Test connector',
        commands: [{ name: 'run', description: 'Run command', args: [], options: [] }],
      };

      // Directly set the connector in the bridge
      (bridge as any).connectors.set('test', connector);

      bridge.registerAll(registry);

      expect(registry.hasTool('test')).toBe(true);
      const tool = registry.getTool('test');
      expect(tool?.name).toBe('test');
    });
  });
});
