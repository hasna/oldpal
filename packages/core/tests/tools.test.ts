import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { BashTool } from '../src/tools/bash';
import { FilesystemTools } from '../src/tools/filesystem';
import { WebFetchTool, WebSearchTool, CurlTool, WebTools } from '../src/tools/web';
import { ImageDisplayTool } from '../src/tools/image';
import { ToolRegistry } from '../src/tools/registry';
import { ConnectorBridge } from '../src/tools/connector';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let originalOldpalDir: string | undefined;

beforeEach(async () => {
  originalOldpalDir = process.env.OLDPAL_DIR;
  tempDir = await mkdtemp(join(tmpdir(), 'oldpal-tools-'));
  process.env.OLDPAL_DIR = tempDir;
  FilesystemTools.setSessionId('test');
});

afterEach(async () => {
  process.env.OLDPAL_DIR = originalOldpalDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('BashTool', () => {
  test('should allow safe commands', async () => {
    const output = await BashTool.executor({ command: 'echo hello' });
    expect(output).toBe('hello');
  });

  test('should respect cwd when provided', async () => {
    const filePath = join(tempDir, 'cwd-check.txt');
    await writeFile(filePath, 'ok');
    const output = await BashTool.executor({ command: 'ls', cwd: tempDir });
    expect(output).toContain('cwd-check.txt');
  });

  test('should block unsafe commands', async () => {
    const output = await BashTool.executor({ command: 'rm -rf /' });
    expect(output).toContain('not allowed');
  });

  test('should reject commands not in allowlist', async () => {
    const output = await BashTool.executor({ command: 'uname -a' });
    expect(output).toContain('not in allowed list');
  });

  test('should report non-zero exit codes', async () => {
    const output = await BashTool.executor({ command: 'ls /nonexistent' });
    expect(output).toContain('Exit code');
  });
});

describe('FilesystemTools', () => {
  test('should write and read within temp folder', async () => {
    const writeResult = await FilesystemTools.writeExecutor({ filename: 'test.txt', content: 'hello' });
    expect(writeResult).toContain('Successfully wrote');

    const readResult = await FilesystemTools.readExecutor({ path: join(tempDir, 'temp', 'test', 'test.txt') });
    expect(readResult).toContain('hello');
  });

  test('should glob and grep files', async () => {
    await FilesystemTools.writeExecutor({ filename: 'notes.txt', content: 'alpha\nbeta' });

    const globResult = await FilesystemTools.globExecutor({ pattern: '**/*.txt', path: join(tempDir, 'temp') });
    expect(globResult).toContain('notes.txt');

    const grepResult = await FilesystemTools.grepExecutor({ pattern: 'beta', path: join(tempDir, 'temp') });
    expect(grepResult).toContain('beta');
  });

  test('should resolve relative paths against cwd', async () => {
    const localDir = join(tempDir, 'project');
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, 'cwd.txt'), 'from cwd');

    const readResult = await FilesystemTools.readExecutor({ path: 'cwd.txt', cwd: localDir });
    expect(readResult).toContain('from cwd');

    const globResult = await FilesystemTools.globExecutor({ pattern: '**/*.txt', cwd: localDir });
    expect(globResult).toContain('cwd.txt');

    const grepResult = await FilesystemTools.grepExecutor({ pattern: 'cwd', cwd: localDir });
    expect(grepResult).toContain('cwd.txt');
  });
});

describe('Web tools', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('WebFetchTool should block localhost', async () => {
    const result = await WebFetchTool.executor({ url: 'http://localhost' });
    expect(result).toContain('Cannot fetch');
  });

  test('WebFetchTool should extract text from HTML', async () => {
    globalThis.fetch = async () =>
      new Response('<html><body><h1>Hello</h1><p>World</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com' });
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  test('WebFetchTool should return JSON error for invalid JSON', async () => {
    globalThis.fetch = async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com', extract_type: 'json' });
    expect(result).toContain('not valid JSON');
  });

  test('WebSearchTool should parse results', async () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
      <a class="result__snippet">Snippet</a>
    `;

    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await WebSearchTool.executor({ query: 'example' });
    expect(result).toContain('Example');
    expect(result).toContain('https://example.com');
  });

  test('CurlTool should return JSON', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await CurlTool.executor({ url: 'https://api.test', method: 'GET' });
    expect(result).toContain('HTTP 200');
    expect(result).toContain('"ok": true');
  });

  test('WebTools registerAll should register tools', () => {
    const names: string[] = [];
    WebTools.registerAll({
      register: (tool) => {
        names.push(tool.name);
      },
    });
    expect(names).toContain('web_fetch');
    expect(names).toContain('web_search');
    expect(names).toContain('curl');
  });
});

describe('ImageDisplayTool', () => {
  test('should report missing viu or missing file', async () => {
    const result = await ImageDisplayTool.executor({ path: 'missing.png' });
    expect(result).toMatch(/viu is not installed|Image file not found/);
  });
});

describe('ConnectorBridge', () => {
  test('should register connector tools and execute', async () => {
    const bridge = new ConnectorBridge();
    const registry = new ToolRegistry();

    // Inject a fake connector using echo
    (bridge as any).connectors.set('echo', {
      name: 'echo',
      cli: 'echo',
      description: 'Echo connector',
      commands: [{ name: 'hello', description: 'Say hello', args: [], options: [] }],
      auth: { type: 'none' },
    });

    bridge.registerAll(registry);

    const result = await registry.execute({ id: '1', name: 'echo', input: { command: 'hello' } });
    expect(result.content).toContain('hello');
  });
});
