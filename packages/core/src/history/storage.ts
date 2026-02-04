/**
 * Command history storage for terminal input
 * Persists command history to ~/.assistants/history
 */

import { join } from 'path';
import { getConfigDir } from '../config';

const MAX_HISTORY_SIZE = 1000; // Maximum number of commands to store

/**
 * Get the path to the history file
 */
export function getHistoryPath(): string {
  return join(getConfigDir(), 'history');
}

/**
 * Load command history from file
 * Returns array of commands, most recent last
 */
export async function loadHistory(): Promise<string[]> {
  try {
    const { readFile, access } = await import('fs/promises');
    const historyPath = getHistoryPath();

    try {
      await access(historyPath);
    } catch {
      return [];
    }

    const content = await readFile(historyPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    // Return only the last MAX_HISTORY_SIZE entries
    return lines.slice(-MAX_HISTORY_SIZE);
  } catch {
    return [];
  }
}

/**
 * Save command history to file
 */
export async function saveHistory(history: string[]): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    const historyPath = getHistoryPath();

    // Ensure config directory exists
    await mkdir(dirname(historyPath), { recursive: true });

    // Keep only the last MAX_HISTORY_SIZE entries
    const trimmedHistory = history.slice(-MAX_HISTORY_SIZE);
    await writeFile(historyPath, trimmedHistory.join('\n') + '\n', 'utf-8');
  } catch (error) {
    // Silently fail - history is non-critical
    console.error('Failed to save history:', error);
  }
}

/**
 * Append a single command to history file
 * More efficient than rewriting the entire file
 */
export async function appendToHistory(command: string): Promise<void> {
  if (!command.trim()) return;

  try {
    const { appendFile, mkdir, stat, readFile, writeFile } = await import('fs/promises');
    const { dirname } = await import('path');
    const historyPath = getHistoryPath();

    // Ensure config directory exists
    await mkdir(dirname(historyPath), { recursive: true });

    // Check if we need to trim the file (every 100 commands or so)
    try {
      const stats = await stat(historyPath);
      // If file is larger than ~100KB, trim it
      if (stats.size > 100_000) {
        const content = await readFile(historyPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        const trimmedLines = lines.slice(-MAX_HISTORY_SIZE + 1); // Leave room for new entry
        trimmedLines.push(command);
        await writeFile(historyPath, trimmedLines.join('\n') + '\n', 'utf-8');
        return;
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    // Append the new command
    await appendFile(historyPath, command + '\n', 'utf-8');
  } catch (error) {
    // Silently fail - history is non-critical
    console.error('Failed to append to history:', error);
  }
}

/**
 * Command history manager for in-memory access with file persistence
 */
export class CommandHistory {
  private history: string[] = [];
  private index: number = -1;
  private currentInput: string = '';
  private loaded: boolean = false;

  /**
   * Load history from file (call once at startup)
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.history = await loadHistory();
    this.resetIndex();
    this.loaded = true;
  }

  /**
   * Add a command to history
   * Skips duplicates of the last command
   */
  async add(command: string): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Skip if it's the same as the last command
    if (this.history.length > 0 && this.history[this.history.length - 1] === trimmed) {
      this.resetIndex();
      return;
    }

    this.history.push(trimmed);

    // Trim in-memory history if needed
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(-MAX_HISTORY_SIZE);
    }

    this.resetIndex();

    // Persist to file
    await appendToHistory(trimmed);
  }

  /**
   * Reset the navigation index (call when input changes or command is submitted)
   */
  resetIndex(currentInput: string = ''): void {
    this.index = -1;
    this.currentInput = currentInput;
  }

  /**
   * Navigate to previous command (arrow up)
   * Returns the command to display, or null if at the beginning
   */
  previous(): string | null {
    if (this.history.length === 0) return null;

    // Save current input before navigating
    if (this.index === -1) {
      // Starting navigation - save what user typed
      // currentInput is already set by caller
    }

    // Move to previous (older) command
    const newIndex = this.index === -1
      ? this.history.length - 1
      : Math.max(0, this.index - 1);

    if (newIndex === this.index && this.index === 0) {
      // Already at oldest command
      return null;
    }

    this.index = newIndex;
    return this.history[this.index];
  }

  /**
   * Navigate to next command (arrow down)
   * Returns the command to display, or the original input if at the end
   */
  next(): string | null {
    if (this.index === -1) {
      // Not navigating history
      return null;
    }

    // Move to next (newer) command
    const newIndex = this.index + 1;

    if (newIndex >= this.history.length) {
      // Past the end of history - restore original input
      this.index = -1;
      return this.currentInput;
    }

    this.index = newIndex;
    return this.history[this.index];
  }

  /**
   * Check if currently navigating history
   */
  isNavigating(): boolean {
    return this.index !== -1;
  }

  /**
   * Get current history length
   */
  get length(): number {
    return this.history.length;
  }

  /**
   * Get all history entries (for display/search)
   */
  getAll(): string[] {
    return [...this.history];
  }
}

// Global singleton instance for the terminal
let globalHistory: CommandHistory | null = null;

/**
 * Get the global command history instance
 */
export function getCommandHistory(): CommandHistory {
  if (!globalHistory) {
    globalHistory = new CommandHistory();
  }
  return globalHistory;
}
