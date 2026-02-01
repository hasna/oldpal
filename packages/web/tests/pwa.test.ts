import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('PWA assets', () => {
  test('manifest exists and has required fields', () => {
    const manifestPath = join(__dirname, '..', 'public', 'manifest.json');
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as { name?: string; start_url?: string };
    expect(manifest.name).toBeDefined();
    expect(manifest.start_url).toBe('/');
  });

  test('service worker exists', () => {
    const swPath = join(__dirname, '..', 'public', 'sw.js');
    const content = readFileSync(swPath, 'utf-8');
    expect(content).toContain('CACHE_NAME');
  });
});
