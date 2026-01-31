#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './components/App';

// Parse CLI arguments
const args = process.argv.slice(2);
const options = {
  cwd: process.cwd(),
  version: args.includes('--version') || args.includes('-v'),
  help: args.includes('--help') || args.includes('-h'),
};

// Handle version
if (options.version) {
  console.log('oldpal v0.3.0');
  process.exit(0);
}

// Handle help
if (options.help) {
  console.log(`
oldpal - Your personal AI assistant

Usage:
  oldpal [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number

Commands:
  (none)         Start interactive mode

In interactive mode:
  - Type your message and press Enter to send
  - Use /skill-name to invoke a skill
  - Press Ctrl+C to exit
`);
  process.exit(0);
}

// Start the app
const { waitUntilExit } = render(<App cwd={options.cwd} />);

waitUntilExit().then(() => {
  process.exit(0);
});
