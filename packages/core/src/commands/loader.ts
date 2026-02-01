import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative, basename, extname } from 'path';
import { homedir } from 'os';
import type { Command, CommandFrontmatter } from './types';

/**
 * CommandLoader - discovers and loads slash commands from disk
 *
 * Command locations (in priority order):
 * 1. Project-level: .oldpal/commands/
 * 2. Global-level: ~/.oldpal/commands/
 *
 * File format:
 * - Markdown files (.md) with optional YAML frontmatter
 * - Filename becomes command name (e.g., commit.md -> /commit)
 * - Nested directories create namespaced commands (e.g., git/commit.md -> /git:commit)
 */
export class CommandLoader {
  private commands: Map<string, Command> = new Map();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  /**
   * Load all commands from disk
   */
  async loadAll(): Promise<void> {
    this.commands.clear();

    // Load global commands first (lower priority)
    const envHome = process.env.HOME || process.env.USERPROFILE;
    const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
    const globalDir = join(homeDir, '.oldpal', 'commands');
    await this.loadFromDirectory(globalDir, 'global');

    // Load project commands (higher priority, will override global)
    const projectDir = join(this.cwd, '.oldpal', 'commands');
    await this.loadFromDirectory(projectDir, 'project');
  }

  /**
   * Load commands from a directory recursively
   */
  private async loadFromDirectory(dir: string, source: 'global' | 'project', prefix: string = ''): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recurse into subdirectory with namespace prefix
        const newPrefix = prefix ? `${prefix}:${entry}` : entry;
        await this.loadFromDirectory(fullPath, source, newPrefix);
      } else if (stat.isFile() && extname(entry) === '.md') {
        // Load markdown command file
        const command = await this.loadCommandFile(fullPath, prefix);
        if (command) {
          this.commands.set(command.name, command);
        }
      }
    }
  }

  /**
   * Load a single command file
   */
  private async loadCommandFile(filePath: string, prefix: string): Promise<Command | null> {
    try {
      const content = await Bun.file(filePath).text();
      const { frontmatter, body } = this.parseFrontmatter(content);

      // Derive command name from filename or frontmatter
      const fileName = basename(filePath, '.md');
      const name = frontmatter.name || (prefix ? `${prefix}:${fileName}` : fileName);

      const allowedToolsRaw = frontmatter['allowed-tools'];
      const allowedTools = Array.isArray(allowedToolsRaw)
        ? allowedToolsRaw.map((t) => String(t).trim()).filter(Boolean)
        : typeof allowedToolsRaw === 'string'
          ? allowedToolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;

      return {
        name,
        description: frontmatter.description || `Run the ${name} command`,
        tags: frontmatter.tags,
        allowedTools,
        content: body,
        filePath,
        builtin: false,
      };
    } catch (error) {
      console.error(`Failed to load command from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: CommandFrontmatter; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const [, yamlContent, body] = match;
    const frontmatter: CommandFrontmatter = {};

    // Simple YAML parsing (key: value pairs)
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Handle arrays like [tag1, tag2]
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        frontmatter[key] = arrayContent.split(',').map(v => v.trim());
      } else {
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body: body.trim() };
  }

  /**
   * Register a command programmatically (for built-in commands)
   */
  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all loaded commands
   */
  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Check if a command exists
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Find commands matching a partial name (for autocomplete)
   */
  findMatching(partial: string): Command[] {
    const lower = partial.toLowerCase();
    return this.getCommands().filter(cmd =>
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.description.toLowerCase().includes(lower)
    );
  }
}
