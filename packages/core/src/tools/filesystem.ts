import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { join, resolve, dirname, sep } from 'path';
import { existsSync } from 'fs';
import { getProjectConfigDir } from '../config';
import { Glob } from 'bun';
import { ErrorCodes, ToolExecutionError } from '../errors';
import { validatePath } from '../validation/paths';
import { exceedsFileReadLimit, getLimits } from '../validation/limits';
import { getSecurityLogger } from '../security/logger';
import { isPathSafe } from '../security/path-validator';

// Session ID for temp folder (set during registration)
let currentSessionId: string = 'default';

/**
 * Get the scripts folder path for the current session
 */
function getScriptsFolder(cwd: string, sessionId?: string): string {
  const resolvedSessionId = sessionId || currentSessionId;
  const legacyDir = join(cwd, '.oldpal');
  if (existsSync(legacyDir)) {
    return join(legacyDir, 'scripts', resolvedSessionId);
  }
  return join(getProjectConfigDir(cwd), 'scripts', resolvedSessionId);
}

/**
 * Check if a path is within the allowed scripts folder
 */
function isInScriptsFolder(path: string, cwd: string, sessionId?: string): boolean {
  const scriptsFolder = resolve(getScriptsFolder(cwd, sessionId));
  const resolved = resolve(path);
  if (resolved === scriptsFolder) return true;
  return resolved.startsWith(`${scriptsFolder}${sep}`);
}

/**
 * Filesystem tools - read, write, glob, grep
 * Write operations are RESTRICTED to the project scripts folder (.oldpal/scripts/{session-id}/ or .assistants/scripts/{session-id}/)
 */
export class FilesystemTools {
  /**
   * Register all filesystem tools with session context
   */
  static registerAll(registry: ToolRegistry, sessionId?: string): void {
    if (sessionId) {
      currentSessionId = sessionId;
    }
    registry.register(this.readTool, this.readExecutor);
    registry.register(this.writeTool, this.writeExecutor);
    registry.register(this.globTool, this.globExecutor);
    registry.register(this.grepTool, this.grepExecutor);
  }

  /**
   * Set the session ID for temp folder
   */
  static setSessionId(sessionId: string): void {
    currentSessionId = sessionId;
  }

  // ============================================
  // Read Tool
  // ============================================

  static readonly readTool: Tool = {
    name: 'read',
    description: 'Read the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to read (absolute or relative to cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (1-indexed)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['path'],
    },
  };

  static readonly readExecutor: ToolExecutor = async (input) => {
    const baseCwd = (input.cwd as string) || process.cwd();
    const path = resolve(baseCwd, input.path as string);
    const offset = ((input.offset as number) || 1) - 1;
    const limit = input.limit as number | undefined;

    try {
      const safety = await isPathSafe(path, 'read', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'read',
            path,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const validated = await validatePath(path, { allowSymlinks: true });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Provide a valid file path.',
        });
      }

      const file = Bun.file(validated.resolved);
      if (!(await file.exists())) {
        throw new ToolExecutionError(`File not found: ${path}`, {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: false,
          retryable: false,
          suggestion: 'Check the file path and try again.',
        });
      }

      const limits = getLimits();
      if (exceedsFileReadLimit(file.size, limits.maxFileReadSize)) {
        throw new ToolExecutionError(`File exceeds size limit (${limits.maxFileReadSize} bytes)`, {
          toolName: 'read',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Use a smaller file or narrow the read range.',
        });
      }

      const content = await file.text();
      const lines = content.split('\n');

      const startLine = Math.max(0, offset);
      const endLine = limit ? startLine + limit : lines.length;
      const selectedLines = lines.slice(startLine, endLine);

      // Format with line numbers
      const formattedLines: string[] = [];
      for (let i = 0; i < selectedLines.length; i++) {
        formattedLines.push(`${String(startLine + i + 1).padStart(6)}  ${selectedLines[i]}`);
      }
      const formatted = formattedLines.join('\n');

      return formatted || '(empty file)';
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Write Tool (RESTRICTED to temp folder)
  // ============================================

  static readonly writeTool: Tool = {
    name: 'write',
    description: 'Write content to a file. RESTRICTED: Can only write to the project scripts folder (.oldpal/scripts/{session} or .assistants/scripts/{session}). Provide a filename and it will be saved under the scripts folder.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to write to (saved in the project scripts folder)',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for the project (optional)',
        },
      },
      required: ['filename', 'content'],
    },
  };

  static readonly writeExecutor: ToolExecutor = async (input) => {
    const filename = input.filename as string || input.path as string;
    const content = input.content as string;
    const baseCwd = (input.cwd as string) || process.cwd();

    // Always write to scripts folder
    const scriptsFolder = getScriptsFolder(baseCwd, input.sessionId as string | undefined);

    if (!filename || !filename.trim()) {
      throw new ToolExecutionError('Filename is required', {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
        suggestion: 'Provide a filename and try again.',
      });
    }

    // Sanitize filename - remove any path traversal attempts
    const sanitizedFilename = filename
      .replace(/\.\.[/\\]/g, '')
      .replace(/\.\./g, '')
      .replace(/^[/\\]+/, '');
    const path = join(scriptsFolder, sanitizedFilename);

    // Double check we're in scripts folder
    if (!isInScriptsFolder(path, baseCwd, input.sessionId as string | undefined)) {
      throw new ToolExecutionError(`Cannot write outside scripts folder. Files are saved to ${scriptsFolder}`, {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_PERMISSION_DENIED,
        recoverable: false,
        retryable: false,
        suggestion: 'Write only within the project scripts folder.',
      });
    }

    try {
      // Ensure scripts directory exists
      const validated = await validatePath(path, { allowSymlinks: false, allowedPaths: [scriptsFolder] });
      if (!validated.valid) {
        throw new ToolExecutionError(validated.error || 'Invalid path', {
          toolName: 'write',
          toolInput: input,
          code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
          recoverable: false,
          retryable: false,
          suggestion: 'Write only within the allowed scripts folder.',
        });
      }

      const safety = await isPathSafe(validated.resolved, 'write', { cwd: baseCwd });
      if (!safety.safe) {
        getSecurityLogger().log({
          eventType: 'path_violation',
          severity: 'high',
          details: {
            tool: 'write',
            path: validated.resolved,
            reason: safety.reason || 'Blocked path',
          },
          sessionId: (input.sessionId as string) || 'unknown',
        });
        throw new ToolExecutionError(safety.reason || 'Blocked path', {
          toolName: 'write',
          toolInput: input,
          code: ErrorCodes.TOOL_PERMISSION_DENIED,
          recoverable: false,
          retryable: false,
        });
      }

      const dir = dirname(validated.resolved);
      await Bun.$`mkdir -p ${dir}`.quiet();

      await Bun.write(validated.resolved, content);
      return `Successfully wrote ${content.length} characters to ${validated.resolved}`;
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'write',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Glob Tool
  // ============================================

  static readonly globTool: Tool = {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.tsx")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: cwd)',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
      },
      required: ['pattern'],
    },
  };

  static readonly globExecutor: ToolExecutor = async (input) => {
    const pattern = input.pattern as string;
    const baseCwd = (input.cwd as string) || process.cwd();
    const searchPath = resolve(baseCwd, (input.path as string) || '.');

    try {
      const glob = new Glob(pattern);
      const matches: string[] = [];

      for await (const file of glob.scan({ cwd: searchPath })) {
        matches.push(file);
        if (matches.length >= 1000) break; // Limit results
      }

      if (matches.length === 0) {
        return 'No files found matching pattern';
      }

      return matches.join('\n');
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'glob',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };

  // ============================================
  // Grep Tool
  // ============================================

  static readonly grepTool: Tool = {
    name: 'grep',
    description: 'Search for a pattern in files',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in',
        },
        cwd: {
          type: 'string',
          description: 'Base working directory for relative paths (optional)',
        },
        glob: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts")',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive search (default: false)',
        },
      },
      required: ['pattern'],
    },
  };

  static readonly grepExecutor: ToolExecutor = async (input) => {
    const pattern = input.pattern as string;
    const baseCwd = (input.cwd as string) || process.cwd();
    const searchPath = resolve(baseCwd, (input.path as string) || '.');
    const globPattern = (input.glob as string) || '**/*';
    const caseSensitive = (input.caseSensitive as boolean) || false;

    try {
      // Don't use global flag - it causes stateful behavior with .test()
      const flags = caseSensitive ? '' : 'i';
      const regex = new RegExp(pattern, flags);
      const results: string[] = [];

      const glob = new Glob(globPattern);

      for await (const file of glob.scan({ cwd: searchPath })) {
        const filePath = join(searchPath, file);

        try {
          const content = await Bun.file(filePath).text();
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= 500) break; // Limit results
            }
          }
        } catch {
          // Skip files that can't be read
        }

        if (results.length >= 500) break;
      }

      if (results.length === 0) {
        return 'No matches found';
      }

      return results.join('\n');
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
        toolName: 'grep',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
  };
}

export const __test__ = {
  getScriptsFolder,
  isInScriptsFolder,
};
