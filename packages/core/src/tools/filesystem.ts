import type { Tool } from '@oldpal/shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { join, resolve, dirname, sep } from 'path';
import { getConfigDir } from '../config';
import { Glob } from 'bun';

// Session ID for temp folder (set during registration)
let currentSessionId: string = 'default';

/**
 * Get the temp folder path for the current session
 */
function getTempFolder(): string {
  return join(getConfigDir(), 'temp', currentSessionId);
}

/**
 * Check if a path is within the allowed temp folder
 */
function isInTempFolder(path: string): boolean {
  const tempFolder = resolve(getTempFolder());
  const resolved = resolve(path);
  if (resolved === tempFolder) return true;
  return resolved.startsWith(`${tempFolder}${sep}`);
}

/**
 * Filesystem tools - read, write, glob, grep
 * Write operations are RESTRICTED to ~/.oldpal/temp/{session-id}/
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
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return `Error: File not found: ${path}`;
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
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  // ============================================
  // Write Tool (RESTRICTED to temp folder)
  // ============================================

  static readonly writeTool: Tool = {
    name: 'write',
    description: 'Write content to a file. RESTRICTED: Can only write to ~/.oldpal/temp/{session}/ folder. Provide just the filename and it will be saved to the temp folder.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'The filename to write to (will be saved in temp folder)',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['filename', 'content'],
    },
  };

  static readonly writeExecutor: ToolExecutor = async (input) => {
    const filename = input.filename as string || input.path as string;
    const content = input.content as string;

    // Always write to temp folder
    const tempFolder = getTempFolder();

    if (!filename || !filename.trim()) {
      return 'Error: filename is required';
    }

    // Sanitize filename - remove any path traversal attempts
    const sanitizedFilename = filename
      .replace(/\.\.[/\\]/g, '')
      .replace(/\.\./g, '')
      .replace(/^[/\\]+/, '');
    const path = join(tempFolder, sanitizedFilename);

    // Double check we're in temp folder
    if (!isInTempFolder(path)) {
      return `Error: Cannot write outside temp folder. Files are saved to ${tempFolder}`;
    }

    try {
      // Ensure temp directory exists
      const dir = dirname(path);
      await Bun.$`mkdir -p ${dir}`.quiet();

      await Bun.write(path, content);
      return `Successfully wrote ${content.length} characters to ${path}\n\nYou can review and copy this file to your project if needed.`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
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
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
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
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

export const __test__ = {
  getTempFolder,
  isInTempFolder,
};
