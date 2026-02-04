export function sanitizeTerminalOutput(chunk: string): string {
  // Strip clear scrollback (CSI 3 J) sequences that wipe terminal history.
  // Strip full clear-terminal sequences that would wipe scrollback.
  // Note: We preserve cursor-home (\x1b[H) as Ink needs it for proper rendering.
  return chunk
    .replace(/\x1b\[2J\x1b\[3J\x1b\[H/g, '')
    .replace(/\x1b\[2J\x1b\[3J/g, '')
    .replace(/\x1b\[3J/g, '');
}
