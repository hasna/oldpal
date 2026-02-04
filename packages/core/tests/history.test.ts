import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';

// Set a custom ASSISTANTS_DIR before importing the module
const testDir = await mkdtemp(join(tmpdir(), 'assistants-test-'));
process.env.ASSISTANTS_DIR = testDir;

// Now import the module after setting the env var
const { CommandHistory, loadHistory, saveHistory, appendToHistory, getHistoryPath } = await import('../src/history');

describe('Command History', () => {
  beforeEach(async () => {
    // Ensure test directory exists
    await mkdir(testDir, { recursive: true });
    // Clean up any existing history file
    try {
      await rm(getHistoryPath());
    } catch {
      // File may not exist
    }
  });

  afterEach(async () => {
    // Clean up test directory contents but keep the dir
    try {
      await rm(getHistoryPath());
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadHistory', () => {
    test('returns empty array when file does not exist', async () => {
      const history = await loadHistory();
      expect(history).toEqual([]);
    });

    test('loads history from file', async () => {
      await writeFile(getHistoryPath(), '/help\n/status\n/clear\n');
      const history = await loadHistory();
      expect(history).toEqual(['/help', '/status', '/clear']);
    });

    test('filters empty lines', async () => {
      await writeFile(getHistoryPath(), '/help\n\n/status\n\n');
      const history = await loadHistory();
      expect(history).toEqual(['/help', '/status']);
    });
  });

  describe('saveHistory', () => {
    test('saves history to file', async () => {
      await saveHistory(['/help', '/status', '/clear']);
      const content = await readFile(getHistoryPath(), 'utf-8');
      expect(content).toBe('/help\n/status\n/clear\n');
    });
  });

  describe('appendToHistory', () => {
    test('appends to existing file', async () => {
      await writeFile(getHistoryPath(), '/help\n');
      await appendToHistory('/status');
      const content = await readFile(getHistoryPath(), 'utf-8');
      expect(content).toBe('/help\n/status\n');
    });

    test('creates file if it does not exist', async () => {
      await appendToHistory('/help');
      const content = await readFile(getHistoryPath(), 'utf-8');
      expect(content).toBe('/help\n');
    });

    test('ignores empty commands', async () => {
      await appendToHistory('');
      await appendToHistory('   ');
      const history = await loadHistory();
      expect(history).toEqual([]);
    });
  });

  describe('CommandHistory class', () => {
    test('navigates through history', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');
      await history.add('/clear');

      // Start navigation - should get last command
      expect(history.previous()).toBe('/clear');
      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');
      // Already at oldest
      expect(history.previous()).toBe(null);

      // Navigate forward
      expect(history.next()).toBe('/status');
      expect(history.next()).toBe('/clear');
      // Past end - returns saved input (empty in this case)
      expect(history.next()).toBe('');
    });

    test('skips duplicate of last command', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/help'); // Duplicate
      await history.add('/status');

      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');
      expect(history.previous()).toBe(null); // Only 2 unique entries
    });

    test('resetIndex clears navigation state', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');

      history.previous(); // Start navigation
      expect(history.isNavigating()).toBe(true);

      history.resetIndex();
      expect(history.isNavigating()).toBe(false);
    });

    test('preserves saved input during navigation', async () => {
      const history = new CommandHistory();
      await history.add('/help');
      await history.add('/status');

      // Simulate user typing before navigating
      history.resetIndex('partial text');

      // Navigate up
      expect(history.previous()).toBe('/status');
      expect(history.previous()).toBe('/help');

      // Navigate down past end - should restore saved input
      expect(history.next()).toBe('/status');
      expect(history.next()).toBe('partial text');
    });
  });
});
