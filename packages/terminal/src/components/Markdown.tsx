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

  // Restore code blocks with dim styling
  result = result.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => {
    const block = codeBlocks[parseInt(index)];
    // Remove ``` markers and language identifier
    const code = block.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim();
    return chalk.dim(code);
  });

  return result.trim();
}
