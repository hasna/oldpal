import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { Card, CardContent, CardHeader } from '../src/components/ui/Card';
import { FilePreview } from '../src/components/chat/FilePreview';
import { ToolCallCard } from '../src/components/chat/ToolCallCard';

describe('UI components', () => {
  test('Button renders children', () => {
    const markup = renderToStaticMarkup(<Button>Press</Button>);
    expect(markup).toContain('Press');
  });

  test('Badge renders variant and label', () => {
    const markup = renderToStaticMarkup(<Badge variant="success">Ok</Badge>);
    expect(markup).toContain('Ok');
  });

  test('Card renders header and content', () => {
    const markup = renderToStaticMarkup(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardContent>Body</CardContent>
      </Card>
    );
    expect(markup).toContain('Header');
    expect(markup).toContain('Body');
  });

  test('FilePreview renders path and content', () => {
    const markup = renderToStaticMarkup(
      <FilePreview path="notes.txt" content="hello" />
    );
    expect(markup).toContain('notes.txt');
    expect(markup).toContain('hello');
  });

  test('ToolCallCard renders tool name', () => {
    const call = { id: 'call-1', name: 'read', input: { path: 'file.txt' } };
    const result = { toolCallId: 'call-1', content: 'content', isError: false };
    const markup = renderToStaticMarkup(
      <ToolCallCard call={call as any} result={result as any} />
    );
    expect(markup).toContain('read');
  });
});
