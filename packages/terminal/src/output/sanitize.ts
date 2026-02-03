export function sanitizeTerminalOutput(chunk: string): string {
  // Strip clear scrollback (CSI 3 J) sequences that wipe terminal history.
  // Also downgrade full clear-terminal sequences to cursor-home to preserve scrollback.
  return chunk
    .replace(/\x1b\[2J\x1b\[3J\x1b\[H/g, '\x1b[H')
    .replace(/\x1b\[3J/g, '');
}
