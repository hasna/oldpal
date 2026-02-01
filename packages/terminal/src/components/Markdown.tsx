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

function parseMarkdown(text: string, options?: { skipBlocks?: boolean }): string {
  let result = text;

  // Handle code blocks first (preserve them)
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `@@CODEBLOCK${codeBlocks.length - 1}@@`;
  });

  const blockSections: BlockSection[] = [];
  if (!options?.skipBlocks) {
    result = extractBlockSections(result, blockSections);
  }

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

  // Restore block sections
  result = result.replace(/@@BLOCKSECTION(\d+)@@/g, (_, index) => {
    const section = blockSections[parseInt(index, 10)];
    if (!section) return '';
    return renderBlockSection(section);
  });

  // Restore code blocks with dim styling
  result = result.replace(/@@CODEBLOCK(\d+)@@/g, (_, index) => {
    const block = codeBlocks[parseInt(index)];
    // Remove ``` markers and language identifier
    const code = block.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim();
    return chalk.dim(code);
  });

  return result.trim();
}

type BlockSection =
  | { kind: 'block'; type: string; title?: string; body: string }
  | { kind: 'grid'; columns: number; cards: { type: string; title?: string; body: string }[]; body: string };

function extractBlockSections(text: string, blocks: BlockSection[]): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const gridMatch = line.match(/^:::grid(.*)$/);
    const blockMatch = line.match(/^:::block(.*)$/);

    if (gridMatch) {
      const header = gridMatch[1] ?? '';
      const attrs = parseAttributes(header);
      const columns = Math.max(1, Math.min(4, Number(attrs.columns || attrs.cols || 2)));
      const bodyLines: string[] = [];
      i += 1;
      let openCards = 0;
      while (i < lines.length) {
        const current = lines[i];
        if (current.startsWith(':::card')) {
          openCards += 1;
          bodyLines.push(current);
          i += 1;
          continue;
        }
        if (current.trim() === ':::') {
          if (openCards > 0) {
            openCards -= 1;
            bodyLines.push(current);
            i += 1;
            continue;
          }
          i += 1;
          break;
        }
        bodyLines.push(current);
        i += 1;
      }

      const body = bodyLines.join('\n');
      const cards = extractCards(body);
      blocks.push({ kind: 'grid', columns, cards, body });
      output.push(`@@BLOCKSECTION${blocks.length - 1}@@`);
      continue;
    }

    if (blockMatch) {
      const header = blockMatch[1] ?? '';
      const attrs = parseAttributes(header);
      const type = String(attrs.type || 'info');
      const title = attrs.title ? String(attrs.title) : undefined;
      const bodyLines: string[] = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== ':::') {
        bodyLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim() === ':::') {
        i += 1;
      }
      const body = bodyLines.join('\n');
      blocks.push({ kind: 'block', type, title, body });
      output.push(`@@BLOCKSECTION${blocks.length - 1}@@`);
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join('\n');
}

function extractCards(body: string): { type: string; title?: string; body: string }[] {
  const cards: { type: string; title?: string; body: string }[] = [];
  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^:::card(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }

    const attrs = parseAttributes(match[1] ?? '');
    const type = String(attrs.type || 'note');
    const title = attrs.title ? String(attrs.title) : undefined;
    const bodyLines: string[] = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== ':::') {
      bodyLines.push(lines[i]);
      i += 1;
    }
    if (i < lines.length && lines[i].trim() === ':::') {
      i += 1;
    }
    cards.push({ type, title, body: bodyLines.join('\n') });
  }

  return cards;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)=(".*?"|'.*?'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

function renderBlockSection(section: BlockSection): string {
  if (section.kind === 'grid') {
    if (section.cards.length === 0) {
      return renderCard({ type: 'note', title: 'Grid', body: section.body });
    }
    return renderCardGrid(section.cards, section.columns);
  }

  return renderBlock(section.type, section.title, section.body);
}

function renderBlock(type: string, title: string | undefined, body: string): string {
  const header = formatBlockHeader(type, title);
  const content = parseMarkdown(body, { skipBlocks: true });
  const lines = content ? content.split('\n') : [];
  return renderBox(header, lines, type);
}

function renderCard(card: { type: string; title?: string; body: string }): string[] {
  const header = formatBlockHeader(card.type, card.title);
  const content = parseMarkdown(card.body, { skipBlocks: true });
  const lines = content ? content.split('\n') : [];
  return renderBoxLines(header, lines, card.type);
}

function renderCardGrid(cards: { type: string; title?: string; body: string }[], columns: number): string {
  const cardLines = cards.map((card) => renderCard(card));
  const rows: string[][][] = [];
  for (let i = 0; i < cardLines.length; i += columns) {
    rows.push(cardLines.slice(i, i + columns));
  }

  const output: string[] = [];
  for (const row of rows) {
    const maxHeight = Math.max(...row.map((c) => c.length));
    const padded = row.map((lines) => {
      const width = stripAnsi(lines[0] || '').length;
      const filled = [...lines];
      while (filled.length < maxHeight) {
        filled.push(' '.repeat(width));
      }
      return filled;
    });

    for (let lineIdx = 0; lineIdx < maxHeight; lineIdx += 1) {
      output.push(padded.map((card) => card[lineIdx]).join('  '));
    }
  }

  return output.join('\n');
}

function formatBlockHeader(type: string, title?: string): string {
  const normalized = type.toLowerCase();
  const label = normalized.toUpperCase();
  const icon = getBlockIcon(normalized);
  const base = title ? `${icon} ${label} · ${title}` : `${icon} ${label}`;
  return base;
}

function getBlockIcon(type: string): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'warning':
      return '⚠';
    case 'error':
      return '✗';
    case 'command':
      return '❯';
    case 'note':
      return '✶';
    default:
      return 'ℹ';
  }
}

function renderBox(header: string, lines: string[], type: string): string {
  return renderBoxLines(header, lines, type).join('\n');
}

function renderBoxLines(header: string, lines: string[], type: string): string[] {
  const headerStyled = styleHeader(header, type);
  const width = Math.max(
    stripAnsi(headerStyled).length,
    ...lines.map((line) => stripAnsi(line).length),
    0
  );
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const mid = `├${'─'.repeat(width + 2)}┤`;
  const bot = `└${'─'.repeat(width + 2)}┘`;

  const output: string[] = [];
  output.push(chalk.dim(top));
  output.push(formatBoxRow(headerStyled, width));
  output.push(chalk.dim(mid));
  for (const line of lines) {
    output.push(formatBoxRow(line, width));
  }
  output.push(chalk.dim(bot));
  return output;
}

function styleHeader(header: string, type: string): string {
  const color = type.toLowerCase();
  switch (color) {
    case 'success':
      return chalk.green.bold(header);
    case 'warning':
      return chalk.yellow.bold(header);
    case 'error':
      return chalk.red.bold(header);
    case 'command':
      return chalk.cyan.bold(header);
    case 'note':
      return chalk.magenta.bold(header);
    default:
      return chalk.blue.bold(header);
  }
}

function formatBoxRow(line: string, width: number): string {
  const len = stripAnsi(line).length;
  const padded = len < width ? line + ' '.repeat(width - len) : line;
  return `│ ${padded} │`;
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

export const __test__ = {
  parseMarkdown,
};
