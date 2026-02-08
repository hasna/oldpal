import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { CommandLoader } from '../src/commands/loader';
import { CommandExecutor } from '../src/commands/executor';
import { BuiltinCommands } from '../src/commands/builtin';
import { listProjects, readProject } from '../src/projects/store';
import type { CommandContext, CommandResult } from '../src/commands/types';
import { IdentityManager } from '../src/identity/identity-manager';
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listSchedules, saveSchedule, computeNextRun } from '../src/scheduler/store';
import { generateId } from '@hasna/assistants-shared';
import { getRuntime } from '../src/runtime';
import { SessionStorage } from '../src/logger';

describe('CommandLoader', () => {
  let loader: CommandLoader;
  let testDir: string;
  let commandsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `assistants-test-${Date.now()}`);
    commandsDir = join(testDir, '.assistants', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    loader = new CommandLoader(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadAll', () => {
    test('should load commands from directory', async () => {
      // Create a test command file
      writeFileSync(join(commandsDir, 'test.md'), `---
name: test
description: A test command
---

Test content here.
`);

      await loader.loadAll();
      const commands = loader.getCommands();
      expect(commands.length).toBeGreaterThan(0);

      const testCmd = loader.getCommand('test');
      expect(testCmd).toBeDefined();
      expect(testCmd?.description).toBe('A test command');
      expect(testCmd?.content).toBe('Test content here.');
    });

    test('should load global commands from HOME', async () => {
      const originalHome = process.env.HOME;
      const homeDir = join(testDir, 'home');
      const globalDir = join(homeDir, '.assistants', 'commands');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'global.md'), `---
name: global
description: Global command
---
Global content`);

      process.env.HOME = homeDir;
      const homeLoader = new CommandLoader(testDir);
      await homeLoader.loadAll();

      expect(homeLoader.hasCommand('global')).toBe(true);

      process.env.HOME = originalHome;
    });

    test('should handle missing directory', async () => {
      const emptyLoader = new CommandLoader('/nonexistent/path');
      await emptyLoader.loadAll();
      expect(emptyLoader.getCommands()).toEqual([]);
    });

    test('should derive name from filename if not in frontmatter', async () => {
      writeFileSync(join(commandsDir, 'mycommand.md'), `---
description: Command without name
---

Content.
`);

      await loader.loadAll();
      expect(loader.hasCommand('mycommand')).toBe(true);
    });

    test('should parse tags from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'tagged.md'), `---
name: tagged
description: A tagged command
tags: [git, automation]
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('tagged');
      expect(cmd?.tags).toEqual(['git', 'automation']);
    });

    test('should parse frontmatter with CRLF newlines', async () => {
      writeFileSync(join(commandsDir, 'crlf.md'), `---\r\nname: crlf\r\ndescription: CRLF\r\n---\r\n\r\nContent.`);

      await loader.loadAll();
      const cmd = loader.getCommand('crlf');
      expect(cmd?.description).toBe('CRLF');
      expect(cmd?.content).toBe('Content.');
    });

    test('should parse allowed-tools from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'restricted.md'), `---
name: restricted
description: Restricted tools
allowed-tools: bash, read
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('restricted');
      expect(cmd?.allowedTools).toEqual(['bash', 'read']);
    });

    test('should parse allowed-tools array from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'restricted-array.md'), `---
name: restricted-array
description: Restricted tools array
allowed-tools: [bash, read]
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('restricted-array');
      expect(cmd?.allowedTools).toEqual(['bash', 'read']);
    });

    test('should handle nested directories with namespacing', async () => {
      const gitDir = join(commandsDir, 'git');
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(gitDir, 'commit.md'), `---
description: Git commit command
---

Commit changes.
`);

      await loader.loadAll();
      expect(loader.hasCommand('git:commit')).toBe(true);
    });

    test('should handle file without frontmatter', async () => {
      writeFileSync(join(commandsDir, 'plain.md'), 'Just plain content.');

      await loader.loadAll();
      const cmd = loader.getCommand('plain');
      expect(cmd).toBeDefined();
      expect(cmd?.content).toBe('Just plain content.');
    });
  });

  describe('register', () => {
    test('should register a command programmatically', () => {
      loader.register({
        name: 'programmatic',
        description: 'A programmatic command',
        content: 'Content here',
        builtin: true,
      });

      expect(loader.hasCommand('programmatic')).toBe(true);
      const cmd = loader.getCommand('programmatic');
      expect(cmd?.builtin).toBe(true);
    });
  });

  describe('getCommand', () => {
    test('should return undefined for non-existent command', () => {
      expect(loader.getCommand('nonexistent')).toBeUndefined();
    });
  });

  describe('findMatching', () => {
    test('should find commands by partial name', async () => {
      loader.register({ name: 'commit', description: 'Commit changes', content: '' });
      loader.register({ name: 'config', description: 'Configuration', content: '' });
      loader.register({ name: 'help', description: 'Show help', content: '' });

      const matches = loader.findMatching('co');
      expect(matches.length).toBe(2);
      expect(matches.map(c => c.name)).toContain('commit');
      expect(matches.map(c => c.name)).toContain('config');
    });

    test('should find commands by description', async () => {
      loader.register({ name: 'commit', description: 'Commit changes', content: '' });

      const matches = loader.findMatching('changes');
      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('commit');
    });
  });
});

describe('CommandExecutor', () => {
  let loader: CommandLoader;
  let executor: CommandExecutor;
  let mockContext: CommandContext;
  let emittedChunks: Array<{ type: string; content?: string }>;

  beforeEach(() => {
    loader = new CommandLoader();
    executor = new CommandExecutor(loader);
    emittedChunks = [];

    mockContext = {
      cwd: process.cwd(),
      sessionId: 'test-session',
      messages: [],
      tools: [],
      clearMessages: () => {},
      addSystemMessage: () => {},
      emit: (type, content) => {
        emittedChunks.push({ type, content });
      },
    };
  });

  describe('parseCommand', () => {
    test('should parse command with name only', () => {
      const result = executor.parseCommand('/help');
      expect(result).toEqual({ name: 'help', args: '' });
    });

    test('should parse command with arguments', () => {
      const result = executor.parseCommand('/search hello world');
      expect(result).toEqual({ name: 'search', args: 'hello world' });
    });

    test('should return null for non-command input', () => {
      expect(executor.parseCommand('hello')).toBeNull();
      expect(executor.parseCommand('')).toBeNull();
    });

    test('should handle command with colon namespace', () => {
      const result = executor.parseCommand('/git:commit message');
      expect(result).toEqual({ name: 'git:commit', args: 'message' });
    });
  });

  describe('isCommand', () => {
    test('should return true for slash commands', () => {
      expect(executor.isCommand('/help')).toBe(true);
      expect(executor.isCommand('/search foo')).toBe(true);
    });

    test('should return false for non-commands', () => {
      expect(executor.isCommand('hello')).toBe(false);
      expect(executor.isCommand('')).toBe(false);
    });
  });

  describe('execute', () => {
    test('should handle unknown command', async () => {
      const result = await executor.execute('/unknown', mockContext);

      expect(result.handled).toBe(true);
      expect(emittedChunks.some(c => c.content?.includes('Unknown command'))).toBe(true);
    });

    test('should execute self-handled command', async () => {
      let handlerCalled = false;

      loader.register({
        name: 'test',
        description: 'Test command',
        content: '',
        selfHandled: true,
        handler: async (args, ctx) => {
          handlerCalled = true;
          ctx.emit('text', `Args: ${args}`);
          ctx.emit('done');
          return { handled: true };
        },
      });

      const result = await executor.execute('/test myargs', mockContext);

      expect(result.handled).toBe(true);
      expect(handlerCalled).toBe(true);
      expect(emittedChunks.some(c => c.content === 'Args: myargs')).toBe(true);
    });

    test('should return prompt for non-self-handled command', async () => {
      loader.register({
        name: 'summarize',
        description: 'Summarize topic',
        content: 'Please summarize: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/summarize main.ts', mockContext);

      expect(result.handled).toBe(false);
      expect(result.prompt).toContain('Please summarize:');
      expect(result.prompt).toContain('main.ts');
    });

    test('should substitute $ARGUMENTS placeholder', async () => {
      loader.register({
        name: 'debug',
        description: 'Debug issue',
        content: 'Debug this: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/debug error in line 42', mockContext);

      expect(result.prompt).toBe('Debug this: error in line 42');
    });

    test('should handle missing arguments', async () => {
      loader.register({
        name: 'test',
        description: 'Test',
        content: 'Args: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/test', mockContext);

      expect(result.prompt).toBe('Args: (no arguments provided)');
    });

    test('should execute shell commands in content', async () => {
      loader.register({
        name: 'shell',
        description: 'Shell command',
        content: 'Output:\n!echo hello',
        selfHandled: false,
      });

      const result = await executor.execute('/shell', mockContext);

      expect(result.prompt).toContain('hello');
    });

    test('should preserve indentation for shell command output', async () => {
      loader.register({
        name: 'shell-indent',
        description: 'Shell command with indent',
        content: 'List:\n  !echo indented',
        selfHandled: false,
      });

      const result = await executor.execute('/shell-indent', mockContext);
      expect(result.prompt).toContain('  ```');
      expect(result.prompt).toContain('  indented');
    });

    test('should ignore empty shell command lines', async () => {
      loader.register({
        name: 'shell-empty',
        description: 'Empty shell command',
        content: '!\nNext',
        selfHandled: false,
      });

      const result = await executor.execute('/shell-empty', mockContext);
      expect(result.prompt).toContain('!');
      expect(result.prompt).toContain('Next');
    });

    test('should not execute shell commands inside code blocks', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'assistants-shell-block-'));
      loader.register({
        name: 'block',
        description: 'Shell in code block',
        content: '```bash\n!pwd\n```',
        selfHandled: false,
      });

      mockContext.cwd = tempDir;
      const result = await executor.execute('/block', mockContext);

      expect(result.prompt).toContain('!pwd');
      expect(result.prompt).not.toContain(tempDir);

      rmSync(tempDir, { recursive: true, force: true });
    });

    test('should run shell commands from context cwd', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'assistants-shell-'));
      loader.register({
        name: 'cwd',
        description: 'Shell cwd command',
        content: 'Output:\n!pwd',
        selfHandled: false,
      });

      mockContext.cwd = tempDir;
      const result = await executor.execute('/cwd', mockContext);

      expect(result.prompt).toContain(tempDir);

      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('getSuggestions', () => {
    test('should return matching commands for partial input', () => {
      loader.register({ name: 'help', description: 'Show help', content: '' });
      loader.register({ name: 'history', description: 'Show history', content: '' });

      const suggestions = executor.getSuggestions('/h');
      expect(suggestions.length).toBe(2);
    });

    test('should return empty for non-slash input', () => {
      expect(executor.getSuggestions('hello')).toEqual([]);
    });
  });
});

describe('BuiltinCommands', () => {
  let builtins: BuiltinCommands;
  let loader: CommandLoader;
  let mockContext: CommandContext;
  let emittedContent: string[];
  let messagesCleared: boolean;
  let tempDir: string;
  let originalAssistantsDir: string | undefined;
  let activeProjectId: string | null;
  let projectContextContent: string | null;
  const heartbeatState = {
    enabled: true,
    state: 'idle' as const,
    lastActivity: new Date().toISOString(),
    uptimeSeconds: 42,
    isStale: false,
  };

  beforeEach(() => {
    builtins = new BuiltinCommands();
    loader = new CommandLoader();
    emittedContent = [];
    messagesCleared = false;
    activeProjectId = null;
    projectContextContent = null;
    tempDir = mkdtempSync(join(tmpdir(), 'assistants-cmd-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;

    mockContext = {
      cwd: tempDir,
      sessionId: 'session-123',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      tools: [
        { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
        { name: 'read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ],
      skills: [
        { name: 'alpha', description: 'Alpha skill', argumentHint: '[arg]' },
      ],
      connectors: [],
      getHeartbeatState: () => heartbeatState,
      getHeartbeatConfig: () => ({
        historyPath: join(tempDir, 'heartbeats', 'runs', '{sessionId}.jsonl'),
      }),
      getActiveProjectId: () => activeProjectId,
      setActiveProjectId: (id) => { activeProjectId = id; },
      setProjectContext: (content) => { projectContextContent = content; },
      clearMessages: () => { messagesCleared = true; },
      addSystemMessage: () => {},
      emit: (type, content) => {
        if (type === 'text' && content) {
          emittedContent.push(content);
        }
      },
    };

    builtins.registerAll(loader);
  });

  afterEach(() => {
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('token usage tracking', () => {
    test('should track and return token usage', () => {
      builtins.updateTokenUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });

      const usage = builtins.getTokenUsage();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.totalTokens).toBe(1500);
    });
  });

  describe('/help command', () => {
    test('should list all commands', async () => {
      const cmd = loader.getCommand('help');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(true);

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Available Slash Commands'))).toBe(true);
      }
    });

    test('should include and sort custom commands', async () => {
      loader.register({ name: 'zeta', description: 'Zeta cmd', content: 'z', builtin: false });
      loader.register({ name: 'alpha', description: 'Alpha cmd', content: 'a', builtin: false });

      const cmd = loader.getCommand('help');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);

        const output = emittedContent.join('\n');
        const alphaIndex = output.indexOf('/alpha - Alpha cmd');
        const zetaIndex = output.indexOf('/zeta - Zeta cmd');
        expect(alphaIndex).toBeGreaterThanOrEqual(0);
        expect(zetaIndex).toBeGreaterThanOrEqual(0);
        expect(alphaIndex).toBeLessThan(zetaIndex);
      }
    });
  });

  describe('/clear command', () => {
    test('should clear conversation', async () => {
      const cmd = loader.getCommand('clear');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.clearConversation).toBe(true);
        expect(messagesCleared).toBe(true);
      }
    });
  });

  describe('/identity command', () => {
    test('edit opens identity panel with target id', async () => {
      const cmd = loader.getCommand('identity');
      expect(cmd).toBeDefined();

      const identityManager = new IdentityManager('assistant-test', tempDir);
      await identityManager.initialize();
      const identity = await identityManager.createIdentity({ name: 'Primary' });

      const contextWithIdentity: CommandContext = {
        ...mockContext,
        getIdentityManager: () => identityManager,
      };

      if (cmd?.handler) {
        const result = await cmd.handler(`edit ${identity.id}`, contextWithIdentity);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('identity');
        expect(result.panelValue).toBe(`edit:${identity.id}`);
      }
    });
  });

  describe('/status command', () => {
    test('should show session status', async () => {
      builtins.updateTokenUsage({
        inputTokens: 5000,
        outputTokens: 2000,
        totalTokens: 7000,
        maxContextTokens: 200000,
      });

      const cmd = loader.getCommand('status');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Session Status'))).toBe(true);
        expect(emittedContent.some(c => c.includes(tempDir))).toBe(true);
        expect(emittedContent.some(c => c.includes('session-123'))).toBe(true);
      }
    });

    test('should include cache token usage when available', async () => {
      builtins.updateTokenUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        maxContextTokens: 200000,
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
      });

      const cmd = loader.getCommand('status');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Cache Read');
        expect(output).toContain('Cache Write');
      }
    });
  });

  describe('/cost command', () => {
    test('should show cost estimate', async () => {
      builtins.updateTokenUsage({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        maxContextTokens: 200000,
      });

      const cmd = loader.getCommand('cost');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Estimated Session Cost'))).toBe(true);
        expect(emittedContent.some(c => c.includes('$'))).toBe(true);
      }
    });

    test('should include cache savings when cache tokens exist', async () => {
      builtins.updateTokenUsage({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        maxContextTokens: 200000,
        cacheReadTokens: 5000,
      });

      const cmd = loader.getCommand('cost');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Cache savings'))).toBe(true);
      }
    });
  });

  describe('/model command', () => {
    test('should show model information', async () => {
      const cmd = loader.getCommand('model');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Current Model'))).toBe(true);
      }
    });
  });

  describe('/config command', () => {
    test('should show configuration', async () => {
      const cmd = loader.getCommand('config');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('config');
      }
    });
  });

  describe('non-self-handled commands', () => {
    test('/compact should return LLM prompt', () => {
      const cmd = loader.getCommand('compact');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(false);
      expect(cmd?.content).toContain('summarize');
    });

    test('/memory should return LLM prompt', () => {
      const cmd = loader.getCommand('memory');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(true);
    });
  });

  describe('/tokens command', () => {
    test('should show token usage', async () => {
      builtins.updateTokenUsage({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        maxContextTokens: 10,
      });

      const cmd = loader.getCommand('tokens');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Token Usage'))).toBe(true);
      }
    });
  });

  describe('/skills command', () => {
    test('should list available skills', async () => {
      const cmd = loader.getCommand('skills');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('skills');
      }
    });

    test('should handle no skills', async () => {
      const cmd = loader.getCommand('skills');
      expect(cmd).toBeDefined();

      const contextNoSkills = { ...mockContext, skills: [] };
      if (cmd?.handler) {
        const result = await cmd.handler('', contextNoSkills);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('skills');
      }
    });
  });

  describe('/session command', () => {
    test('should return list action when no args', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.sessionAction).toBe('list');
      }
    });

    test('should return new action', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('new', mockContext);
        expect(result.sessionAction).toBe('new');
      }
    });

    test('should return switch action for numeric arg', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('2', mockContext);
        expect(result.sessionAction).toBe('switch');
        expect(result.sessionNumber).toBe(2);
      }
    });
  });

  describe('/exit and /new commands', () => {
    test('exit should signal exit', async () => {
      const cmd = loader.getCommand('exit');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.exit).toBe(true);
      }
    });

    test('new should clear conversation', async () => {
      const cmd = loader.getCommand('new');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.clearConversation).toBe(true);
        expect(messagesCleared).toBe(true);
      }
    });
  });

  describe('/init command', () => {
    test('should create commands directory and example', async () => {
      const cmd = loader.getCommand('init');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Initialized assistants'))).toBe(true);
        expect(existsSync(join(tempDir, '.assistants', 'commands', 'reflect.md'))).toBe(true);
      }
    });
  });

  describe('/connectors command', () => {
    test('should show empty state when no connectors', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('--list', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('No connectors found'))).toBe(true);
      }
    });

    test('should report unknown connector when name not found', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          { name: 'demo', description: 'Demo connector', cli: 'connect-demo', commands: [] },
        ],
      };

      if (cmd?.handler) {
        const result = await cmd.handler('--list missing', contextWithConnector);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('not found'))).toBe(true);
      }
    });

    test('should show connector details when name provided', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ authenticated: true, user: 'test' })));
              controller.close();
            },
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: Promise.resolve(0),
          kill: () => {},
        }) as any;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list demo', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Demo'))).toBe(true);
        }
      } finally {
        runtime.spawn = originalSpawn;
      }
    });

    test('should list connectors with status', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ authenticated: true })));
              controller.close();
            },
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: Promise.resolve(0),
          kill: () => {},
        }) as any;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Available Connectors'))).toBe(true);
          expect(emittedContent.some(c => c.includes('demo'))).toBe(true);
        }
      } finally {
        runtime.spawn = originalSpawn;
      }
    });

    test('should fall back to timeout status when auth check hangs', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      const originalSetTimeout = globalThis.setTimeout;

      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start() {},
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: new Promise(() => {}),
          kill: () => {},
        }) as any;
      globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
        fn(...args);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Available Connectors'))).toBe(true);
          expect(emittedContent.some(c => c.includes('| ○ |'))).toBe(true);
        }
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        runtime.spawn = originalSpawn;
      }
    });
  });

  describe('/schedules command', () => {
    test('should list schedules', async () => {
      const cmd = loader.getCommand('schedules');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const future = new Date(Date.now() + 60_000).toISOString();
        const scheduleId = generateId();
        const schedule = {
          id: scheduleId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'user' as const,
          sessionId: mockContext.sessionId,
          command: '/status',
          status: 'active' as const,
          schedule: { kind: 'once' as const, at: future },
        };
        schedule.nextRunAt = computeNextRun(schedule, Date.now());
        await saveSchedule(tempDir, schedule);
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('| ID |'))).toBe(true);
      }
    });

    test('should show help on unknown action', async () => {
      const cmd = loader.getCommand('schedules');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('resume', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Schedules');
        expect(output).toContain('Usage');
      }
    });
  });

  describe('/heartbeat command', () => {
    test('should list heartbeat runs', async () => {
      const cmd = loader.getCommand('heartbeat');
      expect(cmd).toBeDefined();

      const runsDir = join(tempDir, 'heartbeats', 'runs');
      mkdirSync(runsDir, { recursive: true });
      const historyPath = join(runsDir, `${mockContext.sessionId}.jsonl`);
      const heartbeatRun = {
        sessionId: mockContext.sessionId,
        timestamp: new Date(Date.now() - 10_000).toISOString(),
        state: 'idle',
        lastActivity: new Date(Date.now() - 5_000).toISOString(),
        stats: { messagesProcessed: 1, toolCallsExecuted: 2, errorsEncountered: 0, uptimeSeconds: 10 },
      };
      writeFileSync(historyPath, `${JSON.stringify(heartbeatRun)}\n`);

      if (cmd?.handler) {
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Heartbeat Status');
        expect(output).toContain('| Time | State |');
      }
    });

    test('should show status', async () => {
      const cmd = loader.getCommand('heartbeat');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('status', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Heartbeat Status');
        expect(output).toContain('State: idle');
      }
    });
  });

  describe('/resume command', () => {
    test('should open resume panel by default', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('resume');
      }
    });

    test('should list sessions scoped to cwd', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      const rootId = 'resume-root';
      const otherId = 'resume-other';
      const rootSession = new SessionStorage(rootId);
      rootSession.save({
        messages: [],
        startedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
        cwd: tempDir,
      });

      const otherSession = new SessionStorage(otherId);
      otherSession.save({
        messages: [],
        startedAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:01.000Z',
        cwd: '/tmp/other',
      });

      if (cmd?.handler) {
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain(rootId.slice(0, 8));
        expect(output).not.toContain(otherId.slice(0, 8));
      }
    });

    test('should list sessions across assistants with --all', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      const rootId = 'resume-all-root';
      const assistantSessionId = 'resume-all-assistant';
      const rootSession = new SessionStorage(rootId);
      rootSession.save({
        messages: [],
        startedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
        cwd: tempDir,
      });

      const assistantId = 'assistant-test';
      const assistantSession = new SessionStorage(assistantSessionId, undefined, assistantId);
      assistantSession.save({
        messages: [],
        startedAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:01.000Z',
        cwd: tempDir,
      });

      if (cmd?.handler) {
        const result = await cmd.handler('list --all', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain(rootId.slice(0, 8));
        expect(output).toContain(assistantSessionId.slice(0, 8));
      }
    });
  });

  describe('/projects and /plans commands', () => {
    test('should create and switch to a project', async () => {
      const cmd = loader.getCommand('projects');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('new Alpha', mockContext);
        expect(result.handled).toBe(true);
        expect(activeProjectId).toBeTruthy();
        expect(projectContextContent).toContain('Project: Alpha');

        const projects = await listProjects(tempDir);
        expect(projects.length).toBe(1);
        const saved = await readProject(tempDir, projects[0].id);
        expect(saved?.name).toBe('Alpha');
      }
    });

    test('should add a plan and step', async () => {
      const projectsCmd = loader.getCommand('projects');
      const plansCmd = loader.getCommand('plans');
      expect(projectsCmd).toBeDefined();
      expect(plansCmd).toBeDefined();

      if (projectsCmd?.handler && plansCmd?.handler) {
        await projectsCmd.handler('new Beta', mockContext);
        const createResult = await plansCmd.handler('new Launch Plan', mockContext);
        expect(createResult.handled).toBe(true);

        const activeId = activeProjectId as string;
        const project = await readProject(tempDir, activeId);
        expect(project?.plans.length).toBe(1);
        const planId = project?.plans[0].id as string;

        const addResult = await plansCmd.handler(`add ${planId} Define requirements`, mockContext);
        expect(addResult.handled).toBe(true);
        const updated = await readProject(tempDir, activeId);
        expect(updated?.plans[0].steps.length).toBe(1);
      }
    });
  });

  describe('/feedback command', () => {
    test('should open browser on success', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      runtime.shell = () => ({
        quiet: async () => {},
      }) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Opening GitHub'))).toBe(true);
        }
      } finally {
        runtime.shell = originalShell;
      }
    });

    test('should render fallback when open fails', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      runtime.shell = () => ({
        quiet: async () => {
          throw new Error('fail');
        },
      }) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Submit Feedback'))).toBe(true);
        }
      } finally {
        runtime.shell = originalShell;
      }
    });

    test('should label bug feedback appropriately', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      runtime.shell = () => ({
        quiet: async () => {},
      }) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('bug', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Opening GitHub'))).toBe(true);
        }
      } finally {
        runtime.shell = originalShell;
      }
    });
  });
});
