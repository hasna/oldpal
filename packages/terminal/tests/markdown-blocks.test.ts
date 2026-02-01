import { describe, expect, test } from 'bun:test';
import { __test__ } from '../src/components/Markdown';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

describe('Markdown block rendering', () => {
  test('renders a block with header and content', () => {
    const markdown = `:::block type=info title="Tweet 3"\nLine one\nLine two\n:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('┌');
    expect(output).toContain('INFO · Tweet 3');
    expect(output).toContain('Line one');
    expect(output).not.toContain(':::block');
  });

  test('renders a card grid with multiple cards', () => {
    const markdown = `:::grid columns=2
:::card type=success title="A"
First
:::
:::card type=warning title="B"
Second
:::
:::`;
    const output = stripAnsi(__test__.parseMarkdown(markdown));
    expect(output).toContain('SUCCESS · A');
    expect(output).toContain('WARNING · B');
    const boxCount = (output.match(/┌/g) ?? []).length;
    expect(boxCount).toBeGreaterThanOrEqual(2);
  });
});
