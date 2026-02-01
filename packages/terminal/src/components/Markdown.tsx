import React from 'react';
import { Text } from 'ink';
import chalk from 'chalk';

interface MarkdownProps {
  content: string;
}

/**
 * Simple markdown parser for terminal output
 * - Uses dashes for lists (no bullets)
 * - Handles bold text
 * - Handles code blocks and inline code
 */
export function Markdown({ content }: MarkdownProps) {
  const rendered = parseMarkdown(content);
  return <Text>{rendered}</Text>;
}

function parseMarkdown(text: string): string {
  let result = text;

  // Handle code blocks first (preserve them)
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => chalk.bold(text));
  result = result.replace(/__(.+?)__/g, (_, text) => chalk.bold(text));

  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, (_, text) => chalk.italic(text));
  result = result.replace(/_(.+?)_/g, (_, text) => chalk.italic(text));

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, (_, code) => chalk.dim(code));

  // Headers: # ## ###
  result = result.replace(/^### (.+)$/gm, (_, text) => chalk.bold(text));
  result = result.replace(/^## (.+)$/gm, (_, text) => chalk.bold(text));
  result = result.replace(/^# (.+)$/gm, (_, text) => chalk.bold(text));

  // Unordered lists: convert * and • to -
  result = result.replace(/^(\s*)[*•] /gm, '$1- ');

  // Ordered lists: keep as is but ensure proper spacing
  result = result.replace(/^(\s*)\d+\. /gm, '$1- ');

  // Links: [text](url) -> text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${text} (${chalk.dim(url)})`);

  // Status keyword highlighting
  result = result.replace(/\b(Building|Running|Working|Queued|Pending|Connecting)\b/gi, (match) => chalk.yellow(match));
  result = result.replace(/\b(Success|Succeeded|Done|Complete|Completed|Connected|Authenticated)\b/gi, (match) => chalk.green(match));
  result = result.replace(/\b(Error|Failed|Failure|Denied|Blocked)\b/gi, (match) => chalk.red(match));

  // Format markdown tables (before restoring code blocks)
  result = formatMarkdownTables(result);

  // Restore code blocks with dim styling
  result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => {
    const block = codeBlocks[parseInt(index)];
    // Remove ``` markers and language identifier
    const code = block.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim();
    return chalk.dim(code);
  });

  return result.trim();
}

function formatMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];

  const isSeparator = (line: string) => /^\s*\|?[\s:-]+\|?[\s:-]*$/.test(line);
  const hasPipes = (line: string) => line.includes('|');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];

    if (line && next && hasPipes(line) && isSeparator(next)) {
      const header = parseTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && hasPipes(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }

      const table = renderTable(header, rows);
      output.push(...table);
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join('\n');
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function renderTable(header: string[], rows: string[][]): string[] {
  const colCount = Math.max(header.length, ...rows.map((r) => r.length));
  const widths = new Array(colCount).fill(0);

  const allRows = [header, ...rows];
  for (const row of allRows) {
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? '';
      const len = stripAnsi(cell).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const pad = (value: string, width: number) => {
    const len = stripAnsi(value).length;
    if (len >= width) return value;
    return value + ' '.repeat(width - len);
  };

  const top = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (row: string[], isHeader = false) => {
    const cells = [];
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? '';
      const rendered = isHeader ? chalk.bold.cyan(cell) : cell;
      cells.push(pad(rendered, widths[i]));
    }
    return `│ ${cells.join(' │ ')} │`;
  };

  const output: string[] = [];
  output.push(chalk.dim(top));
  output.push(formatRow(header, true));
  output.push(chalk.dim(mid));
  for (const row of rows) {
    output.push(formatRow(row, false));
  }
  output.push(chalk.dim(bot));

  return output;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}
