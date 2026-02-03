/**
 * Node.js runtime implementation for @hasna/assistants-core
 */

import { statSync } from 'node:fs';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { spawn, exec, execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { Readable, Writable } from 'node:stream';
import fg from 'fast-glob';
import Database from 'better-sqlite3';
import type {
  Runtime,
  FileHandle,
  SpawnOptions,
  SpawnResult,
  ShellCommand,
  ShellResult,
  GlobOptions,
  DatabaseConnection,
  DatabaseStatement,
} from '@hasna/assistants-core/runtime';

class NodeFileHandle implements FileHandle {
  private path: string;
  private _size: number = 0;
  private sizeLoaded: boolean = false;

  constructor(path: string) {
    this.path = path;
  }

  async exists(): Promise<boolean> {
    try {
      const stats = await stat(this.path);
      this._size = stats.size;
      this.sizeLoaded = true;
      return true;
    } catch {
      return false;
    }
  }

  text(): Promise<string> {
    return readFile(this.path, 'utf-8').then((content) => {
      if (!this.sizeLoaded) {
        this._size = Buffer.byteLength(content);
        this.sizeLoaded = true;
      }
      return content;
    });
  }

  async json<T = unknown>(): Promise<T> {
    const content = await readFile(this.path, 'utf-8');
    if (!this.sizeLoaded) {
      this._size = Buffer.byteLength(content);
      this.sizeLoaded = true;
    }
    return JSON.parse(content) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = await readFile(this.path);
    if (!this.sizeLoaded) {
      this._size = buffer.length;
      this.sizeLoaded = true;
    }
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  get size(): number {
    if (!this.sizeLoaded) {
      try {
        const stats = statSync(this.path);
        this._size = stats.size;
        this.sizeLoaded = true;
      } catch {
        this._size = 0;
      }
    }
    return this._size;
  }
}

function nodeReadableToWebReadable(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

function nodeWritableToWebWritable(nodeStream: Writable): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        nodeStream.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        nodeStream.end(resolve);
      });
    },
    abort(reason) {
      nodeStream.destroy(reason instanceof Error ? reason : new Error(String(reason)));
    },
  });
}

class NodeShellCommand implements ShellCommand {
  private _cwd: string | undefined;
  private _env: Record<string, string | undefined> | undefined;
  private _quiet: boolean = false;
  private _nothrow: boolean = false;
  private command: string;

  constructor(strings: TemplateStringsArray, values: unknown[]) {
    this.command = strings.reduce((acc, str, i) => {
      const value = i < values.length ? String(values[i]) : '';
      return acc + str + value;
    }, '');
  }

  cwd(path: string): ShellCommand {
    this._cwd = path;
    return this;
  }

  env(env: Record<string, string | undefined>): ShellCommand {
    this._env = env;
    return this;
  }

  quiet(): ShellCommand {
    this._quiet = true;
    return this;
  }

  nothrow(): ShellCommand {
    this._nothrow = true;
    return this;
  }

  async text(): Promise<string> {
    const result = await this.execute();
    return result.stdout;
  }

  private execute(): Promise<ShellResult> {
    return new Promise((resolve, reject) => {
      const env = this._env ? { ...process.env, ...this._env } : process.env;

      exec(
        this.command,
        {
          cwd: this._cwd,
          env: env as NodeJS.ProcessEnv,
          maxBuffer: 50 * 1024 * 1024, // 50MB
        },
        (error, stdout, stderr) => {
          const rawCode = error ? (error as NodeJS.ErrnoException).code : undefined;
          const exitCode = typeof rawCode === 'number' ? rawCode : error ? 1 : 0;

          const result: ShellResult = {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode,
          };

          if (error && !this._nothrow) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
    });
  }

  then<T>(
    onFulfilled?: (result: ShellResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>
  ): Promise<T> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

class NodeDatabaseStatement<T = unknown> implements DatabaseStatement<T> {
  private stmt: Database.Statement;

  constructor(stmt: Database.Statement) {
    this.stmt = stmt;
  }

  all(...params: unknown[]): T[] {
    return this.stmt.all(...params) as T[];
  }

  get(...params: unknown[]): T | undefined {
    return this.stmt.get(...params) as T | undefined;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.stmt.run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }
}

class NodeDatabaseConnection implements DatabaseConnection {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query<T = unknown>(sql: string): DatabaseStatement<T> {
    return new NodeDatabaseStatement<T>(this.db.prepare(sql));
  }

  prepare<T = unknown>(sql: string): DatabaseStatement<T> {
    return new NodeDatabaseStatement<T>(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export const nodeRuntime: Runtime = {
  name: 'node',
  version: process.version,

  file(path: string): FileHandle {
    return new NodeFileHandle(path);
  },

  async write(path: string, content: string | Uint8Array | Blob): Promise<number> {
    // Ensure directory exists
    await mkdir(dirname(path), { recursive: true });

    let data: string | Buffer;
    if (content instanceof Blob) {
      data = Buffer.from(await content.arrayBuffer());
    } else if (content instanceof Uint8Array) {
      data = Buffer.from(content);
    } else {
      data = content;
    }

    await writeFile(path, data);
    return typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  },

  spawn(cmd: string[], options?: SpawnOptions): SpawnResult {
    const [command, ...args] = cmd;
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      stdio: [
        options?.stdin || 'pipe',
        options?.stdout || 'pipe',
        options?.stderr || 'pipe',
      ],
      env: options?.env ? { ...process.env, ...options.env } : process.env,
    });

    const exitedPromise = new Promise<number>((resolve) => {
      proc.on('exit', (code) => resolve(code ?? 0));
      proc.on('error', () => resolve(1));
    });

    return {
      stdout: proc.stdout ? nodeReadableToWebReadable(proc.stdout) : null,
      stderr: proc.stderr ? nodeReadableToWebReadable(proc.stderr) : null,
      stdin: proc.stdin ? nodeWritableToWebWritable(proc.stdin) : null,
      pid: proc.pid ?? 0,
      exited: exitedPromise,
      kill: (signal?: number) => proc.kill(signal),
    };
  },

  shell(strings: TemplateStringsArray, ...values: unknown[]): ShellCommand {
    return new NodeShellCommand(strings, values);
  },

  which(binary: string): string | null {
    try {
      const whichCommand = process.platform === 'win32' ? 'where' : 'which';
      const result = execSync(`${whichCommand} ${binary}`, { encoding: 'utf-8' })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0];
      return result || null;
    } catch {
      return null;
    }
  },

  async *glob(pattern: string, options?: GlobOptions): AsyncIterable<string> {
    const files = await fg(pattern, {
      cwd: options?.cwd,
      dot: options?.dot,
      absolute: options?.absolute,
      onlyFiles: options?.onlyFiles ?? true,
    });
    for (const file of files) {
      yield file;
    }
  },

  openDatabase(path: string): DatabaseConnection {
    return new NodeDatabaseConnection(path);
  },
};

export default nodeRuntime;
