import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * API v1 Alignment Test
 *
 * This test scans client-side source code to ensure all API calls
 * use the versioned /api/v1/* endpoints, not bare /api/* endpoints.
 *
 * Purpose:
 * - Prevent regressions when legacy endpoints are removed
 * - Enforce v1-only API usage across the codebase
 * - Catch accidental use of deprecated endpoints
 */

// Patterns that indicate non-v1 API usage (excluding /api/v1/*)
const NON_V1_PATTERNS = [
  // Fetch calls to /api/* without /v1
  /fetch\s*\(\s*['"`]\/api\/(?!v1\/)/g,
  /fetch\s*\(\s*[`'].*\/api\/(?!v1\/)/g,

  // String literals containing /api/* without /v1 (for URLs)
  /['"`]\/api\/(?!v1\/)[a-zA-Z]/g,

  // WebSocket connections to /api/* without /v1
  /new\s+WebSocket\s*\([^)]*\/api\/(?!v1\/)/g,
  /WebSocket\s*\([^)]*\/api\/(?!v1\/)/g,

  // Dynamic URL construction
  /`\$\{[^}]*\}\/api\/(?!v1\/)/g,
];

// Allowed exceptions (legacy code that's intentionally kept)
const ALLOWED_EXCEPTIONS = [
  // Test files that test the alignment itself
  'api-v1-alignment.test.ts',
];

function findNonV1ApiUsage(dir: string): { file: string; line: number; match: string }[] {
  const violations: { file: string; line: number; match: string }[] = [];

  function scanDir(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // Skip node_modules, .next, dist folders
      if (entry.isDirectory()) {
        if (['node_modules', '.next', 'dist', '.git'].includes(entry.name)) {
          continue;
        }
        scanDir(fullPath);
        continue;
      }

      // Only scan TypeScript/JavaScript files
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        continue;
      }

      // Skip allowed exception files
      if (ALLOWED_EXCEPTIONS.some((exc) => fullPath.includes(exc))) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, lineIndex) => {
        // Skip comment lines
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          return;
        }

        for (const pattern of NON_V1_PATTERNS) {
          // Reset lastIndex for global patterns
          pattern.lastIndex = 0;
          const matches = line.match(pattern);
          if (matches) {
            for (const match of matches) {
              // Double-check it's not a false positive for /api/v1/
              if (!match.includes('/api/v1/')) {
                violations.push({
                  file: path.relative(dir, fullPath),
                  line: lineIndex + 1,
                  match: match.slice(0, 60) + (match.length > 60 ? '...' : ''),
                });
              }
            }
          }
        }
      });
    }
  }

  scanDir(dir);
  return violations;
}

/**
 * Check if a directory contains route files (route.ts)
 */
function hasRouteFiles(dir: string): boolean {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'route.ts') {
      return true;
    }
    if (entry.isDirectory()) {
      if (hasRouteFiles(path.join(dir, entry.name))) {
        return true;
      }
    }
  }
  return false;
}

describe('API v1 Alignment', () => {
  const webSrcDir = path.join(__dirname, '../src');

  test('client code uses /api/v1/* endpoints (not bare /api/*)', () => {
    const violations = findNonV1ApiUsage(webSrcDir);

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} - ${v.match}`)
        .join('\n');

      throw new Error(
        `Found ${violations.length} non-v1 API usage(s):\n${report}\n\n` +
          'All API calls should use /api/v1/* endpoints. ' +
          'If this is intentional, add the file to ALLOWED_EXCEPTIONS in this test.'
      );
    }

    // Test passes if no violations found
    expect(violations).toHaveLength(0);
  });

  test('API routes are under /api/v1/ (no bare /api/* routes)', () => {
    const apiDir = path.join(__dirname, '../src/app/api');

    // Get all files directly under /api/ (not in v1 subdirectory)
    const entries = fs.readdirSync(apiDir, { withFileTypes: true });
    const nonV1Routes: string[] = [];

    for (const entry of entries) {
      // v1 directory is expected
      if (entry.name === 'v1') {
        continue;
      }

      // Check for directories that contain route files (not just empty directories)
      if (entry.isDirectory()) {
        const dirPath = path.join(apiDir, entry.name);
        const hasRoutes = hasRouteFiles(dirPath);
        if (hasRoutes) {
          nonV1Routes.push(entry.name);
        }
      } else if (entry.name === 'route.ts') {
        // Direct route.ts file under /api/
        nonV1Routes.push(entry.name);
      }
    }

    if (nonV1Routes.length > 0) {
      throw new Error(
        `Found non-v1 API routes: ${nonV1Routes.join(', ')}\n\n` +
          'All API routes should be under /api/v1/. ' +
          'Legacy routes should be migrated or removed.'
      );
    }

    expect(nonV1Routes).toHaveLength(0);
  });

  test('WebSocket connections use /api/v1/ws path', () => {
    const violations: string[] = [];

    function scanForWS(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (['node_modules', '.next', 'dist', '.git'].includes(entry.name)) {
            continue;
          }
          scanForWS(fullPath);
          continue;
        }

        if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          continue;
        }

        // Skip test files
        if (fullPath.includes('/tests/') || fullPath.includes('.test.')) {
          continue;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');

        // Look for WebSocket connections to /api/ws instead of /api/v1/ws
        const wsPattern = /\/api\/ws(?![a-zA-Z0-9])/g;
        if (wsPattern.test(content) && !content.includes('/api/v1/ws')) {
          violations.push(path.relative(webSrcDir, fullPath));
        }
      }
    }

    scanForWS(webSrcDir);

    if (violations.length > 0) {
      throw new Error(
        `Found WebSocket connections using /api/ws instead of /api/v1/ws:\n` +
          violations.map((v) => `  ${v}`).join('\n')
      );
    }

    expect(violations).toHaveLength(0);
  });
});
