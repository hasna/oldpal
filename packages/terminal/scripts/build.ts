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

  // Ensure CLI has shebang (only add if not already present)
  const cliPath = join(DIST, 'cli.js');
  const cliContent = await Bun.file(cliPath).text();
  if (!cliContent.startsWith('#!')) {
    await Bun.write(cliPath, '#!/usr/bin/env bun\n' + cliContent);
  }

  // Generate TypeScript declarations
  // In monorepo: may fail due to cross-package imports pointing to source files
  // We generate fallback .d.ts files that re-export from @hasna/assistants-core
  //
  // CI/Release mode: Set STRICT_TYPES=1 to fail build if declarations fail
  // This ensures published packages have proper types
  const strictTypes = process.env.STRICT_TYPES === '1' || process.env.CI === 'true';
  console.log(`  Generating type declarations... (strict=${strictTypes})`);

  let declarationsGenerated = false;
  let declarationError: string | undefined;

  try {
    const tscResult = await $`cd ${ROOT} && bunx tsc -p tsconfig.build.json`.quiet();
    if (tscResult.exitCode === 0) {
      declarationsGenerated = true;
    } else {
      declarationError = tscResult.stderr.toString() || 'Unknown error';
    }
  } catch (error) {
    declarationError = error instanceof Error ? error.message : String(error);
  }

  if (!declarationsGenerated) {
    if (strictTypes) {
      console.error('  ERROR: Type declaration generation failed in strict mode');
      if (declarationError) {
        console.error('  Error:', declarationError.slice(0, 500));
      }
      console.error('  Set STRICT_TYPES=0 to allow fallback declarations in development');
      process.exit(1);
    }

    console.log('  Full declarations failed, generating fallback .d.ts...');
    // Generate minimal fallback declarations that re-export from dependencies
    // This allows consumers to get types from the source packages
    const fallbackDeclaration = `/**
 * Type declarations for @hasna/assistants-terminal
 *
 * Note: Full declarations are generated from source in development.
 * Published packages should include proper .d.ts files.
 *
 * For full type support, consumers can also import types directly from:
 * - @hasna/assistants-core (AgentLoop, ToolRegistry, etc.)
 * - @hasna/assistants-shared (Message, Tool, StreamChunk, etc.)
 */

// Re-export core types that terminal exposes
export { AgentLoop, EmbeddedClient, ToolRegistry, SkillLoader } from '@hasna/assistants-core';
export type { AgentLoopOptions } from '@hasna/assistants-core';
export type { Message, Tool, ToolCall, ToolResult, StreamChunk, Skill, AssistantsConfig } from '@hasna/assistants-shared';

// Terminal-specific exports
export declare function startTerminal(options?: {
  cwd?: string;
  sessionId?: string;
}): Promise<void>;

export declare function startHeadless(options?: {
  cwd?: string;
  sessionId?: string;
  onChunk?: (chunk: StreamChunk) => void;
}): Promise<{ agent: AgentLoop; process: (message: string) => Promise<void>; stop: () => void }>;
`;
    await Bun.write(join(DIST, 'lib.d.ts'), fallbackDeclaration);
    console.log('  Generated fallback lib.d.ts');
  } else {
    console.log('  Type declarations generated successfully');
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
