#!/usr/bin/env bun
/**
 * Build script for @hasna/assistants
 *
 * Bundles core and shared packages into a single distributable package.
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
  console.log('Building @hasna/assistants...');

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
      // Internal packages are bundled, not external
      // '@hasna/assistants-core',  -- bundled
      // '@hasna/assistants-shared', -- bundled
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
      // Internal packages are bundled, not external
      // '@hasna/assistants-core',  -- bundled
      // '@hasna/assistants-shared', -- bundled
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
    // Generate minimal fallback declarations
    // Core and shared are bundled, so types are inline
    const fallbackDeclaration = `/**
 * Type declarations for @hasna/assistants
 *
 * Note: Full declarations are generated from source in development.
 * Published packages should include proper .d.ts files.
 */

// Core types (bundled from @hasna/assistants-core)
export declare class AgentLoop {
  constructor(options: AgentLoopOptions);
  initialize(): Promise<void>;
  process(message: string): Promise<void>;
  stop(): void;
}

export interface AgentLoopOptions {
  cwd?: string;
  sessionId?: string;
  llmClient?: any;
  allowedTools?: string[];
  onChunk?: (chunk: StreamChunk) => void;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result: string;
  isError?: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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
