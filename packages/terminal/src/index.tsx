#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './components/App';
import { runHeadless } from './headless';

const VERSION = '0.6.13';

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
  console.log(`oldpal v${VERSION}`);
  process.exit(0);
}

// Handle help
if (options.help) {
  console.log(`
oldpal - Your personal AI assistant

Usage:
  oldpal [options]                    Start interactive mode
  oldpal -p "<prompt>" [options]      Run in headless mode

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
  oldpal -p "What does the auth module do?"

  # Run with JSON output
  oldpal -p "Summarize this project" --output-format json

  # Stream JSON events
  oldpal -p "Explain this code" --output-format stream-json

  # Auto-approve tools
  oldpal -p "Fix the bug in auth.py" --allowed-tools "Read,Edit,Bash"

  # Get structured output
  oldpal -p "List all functions" --output-format json --json-schema '{"type":"array","items":{"type":"string"}}'

  # Continue conversation
  oldpal -p "What else can you tell me?" --continue

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
  const { waitUntilExit } = render(<App cwd={options.cwd} />);

  waitUntilExit().then(() => {
    process.exit(0);
  });
}
