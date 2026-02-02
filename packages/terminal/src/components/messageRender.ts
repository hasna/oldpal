import type { Message } from '@hasna/assistants-shared';
import { renderMarkdown } from './Markdown';
import type { DisplayMessage } from './messageLines';

function wrapTextLines(text: string, wrapChars: number): string[] {
  const rawLines = text.split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if (line.length <= wrapChars) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += wrapChars) {
      lines.push(line.slice(i, i + wrapChars));
    }
  }
  return lines;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function countWrappedLines(lines: string[], maxWidth?: number): number {
  if (!maxWidth || maxWidth <= 0) return lines.length;
  let total = 0;
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    total += Math.max(1, Math.ceil(visible / maxWidth));
  }
  return total;
}

function chunkRenderedLines(lines: string[], chunkLines: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let i = 0;

  const isBoxStart = (line: string) => stripAnsi(line).trimStart().startsWith('┌');
  const isBoxEnd = (line: string) => stripAnsi(line).trimStart().startsWith('└');

  while (i < lines.length) {
    const line = lines[i];
    if (isBoxStart(line)) {
      let end = i + 1;
      while (end < lines.length && !isBoxEnd(lines[end])) {
        end += 1;
      }
      if (end < lines.length) end += 1;
      const boxLines = lines.slice(i, end);
      if (current.length > 0 && current.length + boxLines.length > chunkLines) {
        chunks.push(current);
        current = [];
      }
      if (boxLines.length >= chunkLines) {
        chunks.push(boxLines);
      } else {
        current.push(...boxLines);
      }
      i = end;
      continue;
    }

    if (current.length >= chunkLines) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
    i += 1;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function buildDisplayMessages(
  messages: Message[],
  chunkLines: number,
  wrapChars: number,
  options?: { maxWidth?: number }
): DisplayMessage[] {
  const display: DisplayMessage[] = [];

  for (const msg of messages) {
    const content = msg.content ?? '';
    const shouldChunk = content.trim() !== '';
    if (!shouldChunk) {
      display.push(msg);
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantWidth = options?.maxWidth ? Math.max(1, options.maxWidth - 2) : undefined;
      const rendered = renderMarkdown(content, { maxWidth: assistantWidth });
      const renderedLines = rendered.split('\n');
      if (renderedLines.length <= chunkLines) {
        const lineCount = countWrappedLines(renderedLines, assistantWidth);
        display.push({ ...msg, content: rendered, __rendered: true, __lineCount: lineCount });
        continue;
      }
      const chunks = chunkRenderedLines(renderedLines, chunkLines);
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i].join('\n');
        const lineCount = countWrappedLines(chunks[i], assistantWidth);
        display.push({
          ...msg,
          id: `${msg.id}::chunk-${i}`,
          content: chunkContent,
          __rendered: true,
          __lineCount: lineCount,
          toolCalls: i === chunks.length - 1 ? msg.toolCalls : undefined,
          toolResults: i === chunks.length - 1 ? msg.toolResults : undefined,
        });
      }
      continue;
    }

    const effectiveWrap = msg.role === 'user' ? Math.max(1, wrapChars - 2) : wrapChars;
    const lines = wrapTextLines(content, effectiveWrap);
    if (lines.length <= chunkLines) {
      display.push({ ...msg, __lineCount: lines.length });
      continue;
    }

    const chunks = chunkRenderedLines(lines, chunkLines);
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i].join('\n');
      display.push({
        ...msg,
        id: `${msg.id}::chunk-${i}`,
        content: chunkContent,
        __lineCount: chunks[i].length,
        toolCalls: i === chunks.length - 1 ? msg.toolCalls : undefined,
        toolResults: i === chunks.length - 1 ? msg.toolResults : undefined,
      });
    }
  }

  return display;
}
