import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { BashTool } from '../src/tools/bash';
import { FilesystemTools } from '../src/tools/filesystem';
import { WebFetchTool, WebSearchTool, CurlTool, WebTools } from '../src/tools/web';
import { ImageDisplayTool } from '../src/tools/image';
import { ToolRegistry } from '../src/tools/registry';
import { ConnectorBridge } from '../src/tools/connector';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'fs/promises';
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

  test('should kill commands that exceed timeout', async () => {
    const output = await BashTool.executor({ command: 'tail -f /dev/null', timeout: 10 });
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

  test('should return error when reading missing file', async () => {
    const readResult = await FilesystemTools.readExecutor({ path: 'missing.txt', cwd: tempDir });
    expect(readResult).toContain('File not found');
  });

  test('should reject empty filenames', async () => {
    const writeResult = await FilesystemTools.writeExecutor({ filename: '   ', content: 'hello' });
    expect(writeResult).toContain('filename is required');
  });

  test('should glob and grep files', async () => {
    await FilesystemTools.writeExecutor({ filename: 'notes.txt', content: 'alpha\nbeta' });

    const globResult = await FilesystemTools.globExecutor({ pattern: '**/*.txt', path: join(tempDir, 'temp') });
    expect(globResult).toContain('notes.txt');

    const grepResult = await FilesystemTools.grepExecutor({ pattern: 'beta', path: join(tempDir, 'temp') });
    expect(grepResult).toContain('beta');
  });

  test('should handle glob and grep misses', async () => {
    await mkdir(join(tempDir, 'temp'), { recursive: true });
    const globResult = await FilesystemTools.globExecutor({ pattern: '**/*.nope', path: join(tempDir, 'temp') });
    expect(globResult).toContain('No files found');

    const grepResult = await FilesystemTools.grepExecutor({ pattern: 'nope', path: join(tempDir, 'temp') });
    expect(grepResult).toContain('No matches found');
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

  test('registerAll should register filesystem tools', () => {
    const registry = new ToolRegistry();
    FilesystemTools.registerAll(registry, 'session-123');
    const names = registry.getTools().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['read', 'write', 'glob', 'grep']));
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

  test('WebFetchTool should return raw HTML when requested', async () => {
    globalThis.fetch = async () =>
      new Response('<html><body><h1>Raw</h1></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com', extract_type: 'html' });
    expect(result).toContain('<h1>Raw</h1>');
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

  test('WebFetchTool should timeout on slow response', async () => {
    globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
          });
        }
      });

    const result = await WebFetchTool.executor({ url: 'https://example.com', timeout: 5 });
    expect(result).toContain('timed out');
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

  test('WebSearchTool should use fallback parser when needed', async () => {
    const html = `
      <a class="result__snippet">Snippet</a>
      <a href="https://fallback.test" class="result__title result__a">Fallback</a>
    `;

    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });

    const result = await WebSearchTool.executor({ query: 'fallback' });
    expect(result).toContain('Fallback');
    expect(result).toContain('https://fallback.test');
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

  test('CurlTool should block localhost', async () => {
    const result = await CurlTool.executor({ url: 'http://localhost', method: 'GET' });
    expect(result).toContain('Cannot fetch');
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

  test('should display image when viu is available', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'oldpal-viu-'));
    const viuPath = join(binDir, 'viu');
    await writeFile(viuPath, '#!/bin/sh\necho "viu mock"\nexit 0\n');
    await chmod(viuPath, 0o755);

    const imagePath = join(binDir, 'image.png');
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAgMBAJ+lWQ0AAAAASUVORK5CYII=',
      'base64'
    );
    await writeFile(imagePath, pngData);

    const originalPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${originalPath}`;

    try {
      const result = await ImageDisplayTool.executor({ path: imagePath });
      expect(result).toMatch(/Image displayed|Error displaying image/);
    } finally {
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
    }
  });

  test('should handle image URLs when viu is available', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'oldpal-viu-url-'));
    const viuPath = join(binDir, 'viu');
    await writeFile(viuPath, '#!/bin/sh\necho "viu mock"\nexit 0\n');
    await chmod(viuPath, 0o755);

    const originalPath = process.env.PATH || '';
    process.env.PATH = binDir;

    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAgMBAJ+lWQ0AAAAASUVORK5CYII=',
      'base64'
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(pngData, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });

    try {
      const result = await ImageDisplayTool.executor({ path: 'https://example.com/image.png' });
      expect(result).toMatch(/Image displayed|Error displaying image/);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
    }
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
