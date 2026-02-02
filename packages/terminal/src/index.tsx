#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './components/App';
import { runHeadless } from './headless';

// Version is embedded at build time via define in build.ts
const VERSION = process.env.ASSISTANTS_VERSION || 'dev';

// DEC Mode 2026 - Synchronized Output
// This prevents scrollback destruction by batching all updates atomically
// Supported by: Ghostty, WezTerm, Windows Terminal, VS Code terminal
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

/**
 * Patch stdout.write to use synchronized output (DEC 2026)
 * This batches writes and flushes them atomically, preventing partial renders
 * that can destroy scrollback in terminals like Ghostty.
 */
function enableSynchronizedOutput(): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let buffer = '';
  let flushTimeout: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (buffer) {
      // Wrap the batched output in synchronized mode
      originalWrite(SYNC_START + buffer + SYNC_END);
      buffer = '';
    }
    flushTimeout = null;
  };

  // Patch the write method
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    buffer += str;

    // Debounce flushes to batch rapid updates
    if (flushTimeout) {
      clearTimeout(flushTimeout);
    }
    // Flush on next tick to batch synchronous writes
    flushTimeout = setTimeout(flush, 0);

    // Handle callback
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    if (cb) {
      setImmediate(() => cb());
    }

    return true;
  } as typeof process.stdout.write;

  // Return cleanup function
  return () => {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
    }
    flush();
    process.stdout.write = originalWrite as typeof process.stdout.write;
  };
}

// Parse CLI arguments
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const options: {
    cwd: string;
    version: boolean;
    help: boolean;
    print: string | null;
    outputFormat: 'text' | 'json' | 'stream-json';
    allowedTools: string[];
    systemPrompt: string | null;
    jsonSchema: string | null;
    continue: boolean;
    resume: string | null;
    cwdProvided: boolean;
  } = {
    cwd: process.cwd(),
    version: false,
    help: false,
    print: null,
    outputFormat: 'text',
    allowedTools: [],
    systemPrompt: null,
    jsonSchema: null,
    continue: false,
    resume: null,
    cwdProvided: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Version
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }

    // Help
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    // Print (headless mode)
    if (arg === '--print' || arg === '-p') {
      options.print = args[++i] || '';
      continue;
    }

    // Output format
    if (arg === '--output-format') {
      const format = args[++i];
      if (format === 'text' || format === 'json' || format === 'stream-json') {
        options.outputFormat = format;
      }
      continue;
    }

    // Allowed tools
    if (arg === '--allowed-tools' || arg === '--allowedTools') {
      const tools = args[++i];
      if (tools) {
        options.allowedTools = tools.split(',').map(t => t.trim());
      }
      continue;
    }

    // System prompt
    if (arg === '--system-prompt') {
      options.systemPrompt = args[++i] || null;
      continue;
    }

    // JSON schema
    if (arg === '--json-schema') {
      options.jsonSchema = args[++i] || null;
      continue;
    }

    // Continue last session
    if (arg === '--continue' || arg === '-c') {
      options.continue = true;
      continue;
    }

    // Resume specific session
    if (arg === '--resume' || arg === '-r') {
      options.resume = args[++i] || null;
      continue;
    }

    // Working directory
    if (arg === '--cwd') {
      options.cwd = args[++i] || process.cwd();
      options.cwdProvided = true;
      continue;
    }

    // Positional argument after -p could be the prompt
    if (options.print === '' && !arg.startsWith('-')) {
      options.print = arg;
    }
  }

  return options;
}

const options = parseArgs(process.argv);

// Handle version
if (options.version) {
  console.log(`assistants v${VERSION}`);
  process.exit(0);
}

// Handle help
if (options.help) {
  console.log(`
assistants - Your personal AI assistant

Usage:
  assistants [options]                    Start interactive mode
  assistants -p "<prompt>" [options]      Run in headless mode

Options:
  -h, --help                   Show this help message
  -v, --version                Show version number

Headless Mode:
  -p, --print <prompt>         Run non-interactively with the given prompt
  --output-format <format>     Output format: text (default), json, stream-json
  --allowed-tools <tools>      Comma-separated tools to auto-approve (e.g., "Read,Edit,Bash")
  --system-prompt <prompt>     Custom system prompt
  --json-schema <schema>       JSON Schema for structured output (use with --output-format json)
  -c, --continue               Continue the most recent conversation
  -r, --resume <session_id>    Resume a specific session by ID
  --cwd <path>                 Set working directory

Examples:
  # Ask a question
  assistants -p "What does the auth module do?"

  # Run with JSON output
  assistants -p "Summarize this project" --output-format json

  # Stream JSON events
  assistants -p "Explain this code" --output-format stream-json

  # Auto-approve tools
  assistants -p "Fix the bug in auth.py" --allowed-tools "Read,Edit,Bash"

  # Get structured output
  assistants -p "List all functions" --output-format json --json-schema '{"type":"array","items":{"type":"string"}}'

  # Continue conversation
  assistants -p "What else can you tell me?" --continue

Interactive Mode:
  - Type your message and press Enter to send
  - Use $skill-name to invoke a skill
  - Use /command for built-in commands
  - Press Ctrl+S to switch sessions
  - Press Ctrl+C to exit
`);
  process.exit(0);
}

// Headless mode
if (options.print !== null) {
  if (!options.print.trim()) {
    console.error('Error: Prompt is required with -p/--print flag');
    process.exit(1);
  }

  runHeadless({
    prompt: options.print,
    cwd: options.cwd,
    outputFormat: options.outputFormat,
    allowedTools: options.allowedTools.length > 0 ? options.allowedTools : undefined,
    systemPrompt: options.systemPrompt || undefined,
    jsonSchema: options.jsonSchema || undefined,
    continue: options.continue,
    resume: options.resume,
    cwdProvided: options.cwdProvided,
  }).catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
} else {
  // Interactive mode
  // Enable synchronized output for terminals that support DEC 2026 (Ghostty, WezTerm, etc.)
  // This batches all terminal writes and flushes them atomically, preserving scrollback
  const disableSyncOutput = enableSynchronizedOutput();

  const { waitUntilExit } = render(<App cwd={options.cwd} version={VERSION} />, {
    // Patch console to route through our synced output
    patchConsole: true,
  });

  waitUntilExit().then(() => {
    // Restore original stdout.write before exiting
    disableSyncOutput();
    process.exit(0);
  });
}
