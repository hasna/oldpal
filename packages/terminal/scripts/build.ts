#!/usr/bin/env bun
/**
 * Build script for @hasna/assistants-terminal
 *
 * Produces:
 * - dist/lib.js    - Library entry point (for imports)
 * - dist/cli.js    - CLI entry point (for bin commands)
 * - dist/*.d.ts    - TypeScript declarations
 */

import { $ } from 'bun';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');

async function build() {
  console.log('Building @hasna/assistants-terminal...');

  // Clean dist
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });

  // Build library entry point
  console.log('  Building lib.js...');
  const libResult = await Bun.build({
    entrypoints: [join(ROOT, 'src/lib.ts')],
    outdir: DIST,
    target: 'bun',
    format: 'esm',
    external: [
      '@hasna/assistants-core',
      '@hasna/assistants-shared',
      '@hasna/runtime-bun',
      'react',
      'ink',
      'ink-text-input',
      'ink-spinner',
      'ink-scroll-view',
      'marked',
      'marked-terminal',
      'chalk',
    ],
    define: {
      'process.env.ASSISTANTS_VERSION': JSON.stringify(
        process.env.ASSISTANTS_VERSION || 'dev'
      ),
    },
  });

  if (!libResult.success) {
    console.error('Failed to build lib.js:', libResult.logs);
    process.exit(1);
  }

  // Build CLI entry point
  console.log('  Building cli.js...');
  const cliResult = await Bun.build({
    entrypoints: [join(ROOT, 'src/cli.tsx')],
    outdir: DIST,
    target: 'bun',
    format: 'esm',
    external: [
      '@hasna/assistants-core',
      '@hasna/assistants-shared',
      '@hasna/runtime-bun',
      'react',
      'ink',
      'ink-text-input',
      'ink-spinner',
      'ink-scroll-view',
      'marked',
      'marked-terminal',
      'chalk',
    ],
    define: {
      'process.env.ASSISTANTS_VERSION': JSON.stringify(
        process.env.ASSISTANTS_VERSION || 'dev'
      ),
    },
  });

  if (!cliResult.success) {
    console.error('Failed to build cli.js:', cliResult.logs);
    process.exit(1);
  }

  // Add shebang to CLI
  const cliPath = join(DIST, 'cli.js');
  const cliContent = await Bun.file(cliPath).text();
  await Bun.write(cliPath, '#!/usr/bin/env bun\n' + cliContent);

  // Generate TypeScript declarations
  console.log('  Generating type declarations...');
  const tscResult = await $`cd ${ROOT} && bunx tsc -p tsconfig.build.json`.quiet();
  if (tscResult.exitCode !== 0) {
    console.error('Failed to generate declarations:', tscResult.stderr.toString());
    process.exit(1);
  }

  console.log('Build complete!');
  console.log('  dist/lib.js  - Library entry point');
  console.log('  dist/cli.js  - CLI entry point');
  console.log('  dist/*.d.ts  - Type declarations');
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
