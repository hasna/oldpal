import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { Button } from '../src/components/ui/Button';
import { Badge } from '../src/components/ui/Badge';
import { Card, CardContent, CardHeader } from '../src/components/ui/Card';
import { FilePreview } from '../src/components/chat/FilePreview';
import { ToolCallCard } from '../src/components/chat/ToolCallCard';
import { Separator } from '../src/components/ui/Separator';
import { Input } from '../src/components/ui/Input';
import { Label } from '../src/components/ui/Label';
import { Avatar, AvatarFallback, AvatarImage } from '../src/components/ui/avatar';
import { Skeleton } from '../src/components/ui/skeleton';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '../src/components/ui/breadcrumb';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../src/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../src/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../src/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '../src/components/ui/sheet';
import { SidebarProvider, Sidebar, SidebarContent, SidebarTrigger } from '../src/components/ui/sidebar';

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

  test('ToolCallCard expands to show file preview for read results', async () => {
    const call = { id: 'call-2', name: 'read', input: { file_path: 'notes.txt' } };
    const result = { toolCallId: 'call-2', content: 'hello', isError: false };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ToolCallCard call={call as any} result={result as any} />);
    });
    const header = renderer!.root.find((node) => typeof node.props?.onClick === 'function');
    await act(async () => {
      header.props.onClick();
    });
    const preview = renderer!.root.findByType(FilePreview);
    expect(preview.props.path).toBe('notes.txt');
    expect(preview.props.content).toBe('hello');
    renderer!.unmount();
  });

  test('ToolCallCard expands to show error output', async () => {
    const call = { id: 'call-3', name: 'bash', input: { cmd: 'ls' } };
    const result = { toolCallId: 'call-3', content: 'boom', isError: true };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ToolCallCard call={call as any} result={result as any} />);
    });
    const header = renderer!.root.find((node) => typeof node.props?.onClick === 'function');
    await act(async () => {
      header.props.onClick();
    });
    const tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('boom');
    expect(JSON.stringify(tree)).toContain('Error');
    renderer!.unmount();
  });

  test('ToolCallCard shows elapsed seconds while pending', async () => {
    const originalNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalCb: (() => void) | null = null;
    Date.now = () => 3500;
    globalThis.setInterval = ((cb: () => void) => {
      intervalCb = cb;
      cb();
      return 1 as any;
    }) as any;
    globalThis.clearInterval = (() => {}) as any;

    const call = { id: 'call-4', name: 'bash', input: {}, startedAt: 1000 };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ToolCallCard call={call as any} />);
    });
    await act(async () => {
      intervalCb?.();
    });
    const tree = renderer!.toJSON();
    expect(JSON.stringify(tree)).toContain('"2"');
    expect(JSON.stringify(tree)).toContain('"s"');
    renderer!.unmount();

    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  test('ToolCallCard skips timer when startedAt is invalid', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let intervalCalled = false;
    globalThis.setInterval = (() => {
      intervalCalled = true;
      return 1 as any;
    }) as any;
    globalThis.clearInterval = (() => {}) as any;

    const call = { id: 'call-5', name: 'bash', input: {}, startedAt: Number.NaN };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ToolCallCard call={call as any} />);
    });
    expect(intervalCalled).toBe(false);
    renderer!.unmount();

    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  test('Separator renders with default orientation', () => {
    const markup = renderToStaticMarkup(<Separator />);
    expect(markup).toContain('data-orientation');
  });

  test('Input renders and accepts className', () => {
    const markup = renderToStaticMarkup(<Input placeholder="Type here" className="custom" />);
    expect(markup).toContain('Type here');
    expect(markup).toContain('custom');
  });

  test('Label renders children', () => {
    const markup = renderToStaticMarkup(<Label>Field Name</Label>);
    expect(markup).toContain('Field Name');
  });

  test('Avatar renders fallback', () => {
    const markup = renderToStaticMarkup(
      <Avatar>
        <AvatarImage src="" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(markup).toContain('AB');
  });

  test('Skeleton renders with pulse animation class', () => {
    const markup = renderToStaticMarkup(<Skeleton className="w-10 h-10" />);
    expect(markup).toContain('animate-pulse');
  });

  test('Breadcrumb renders items', () => {
    const markup = renderToStaticMarkup(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Home</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
    expect(markup).toContain('Home');
  });

  test('Collapsible renders trigger and content', () => {
    const markup = renderToStaticMarkup(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>
    );
    expect(markup).toContain('Toggle');
  });

  test('Tooltip renders provider and trigger', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(markup).toContain('Hover me');
  });

  test('DropdownMenu renders trigger', () => {
    const markup = renderToStaticMarkup(
      <DropdownMenu>
        <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(markup).toContain('Open Menu');
  });

  test('Sheet renders trigger', () => {
    const markup = renderToStaticMarkup(
      <Sheet>
        <SheetTrigger>Open Sheet</SheetTrigger>
        <SheetContent>Sheet content</SheetContent>
      </Sheet>
    );
    expect(markup).toContain('Open Sheet');
  });

  test('Sidebar renders within provider', () => {
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar>
          <SidebarContent>Sidebar items</SidebarContent>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>
    );
    expect(markup).toContain('Sidebar items');
  });
});
