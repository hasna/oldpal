import React from 'react';
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLucideMock } from './helpers/mock-lucide-react';
import { createSidebarMock } from './helpers/mock-sidebar';

// Mock lucide-react icons (generic proxy)
const lucideMock = createLucideMock();
mock.module('lucide-react', () => lucideMock);
mock.module('lucide-react/dist/cjs/lucide-react.js', () => lucideMock);

// Mock collapsible components
mock.module('@/components/ui/collapsible', () => ({
  Collapsible: ({ children, asChild, defaultOpen }: any) => (
    <div data-collapsible data-default-open={defaultOpen}>{children}</div>
  ),
  CollapsibleContent: ({ children }: any) => (
    <div data-collapsible-content>{children}</div>
  ),
  CollapsibleTrigger: ({ children, asChild }: any) => (
    <div data-collapsible-trigger>{children}</div>
  ),
}));

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => createSidebarMock());

// Create mock icon component
const MockIcon = () => <span data-mock-icon>Icon</span>;

describe('NavMain', () => {
  const basicItems = [
    {
      title: 'Dashboard',
      url: '/dashboard',
      icon: MockIcon,
    },
    {
      title: 'Settings',
      url: '/settings',
      icon: MockIcon,
    },
  ];

  const itemsWithSubItems = [
    {
      title: 'Dashboard',
      url: '/dashboard',
      icon: MockIcon,
      isActive: true,
      items: [
        { title: 'Overview', url: '/dashboard/overview' },
        { title: 'Analytics', url: '/dashboard/analytics' },
      ],
    },
  ];

  test('exports NavMain component', async () => {
    const mod = await import('../src/components/nav-main');
    expect(mod.NavMain).toBeDefined();
    expect(typeof mod.NavMain).toBe('function');
  });

  test('renders sidebar group', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('data-sidebar-group');
  });

  test('renders Platform group label', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('data-sidebar-group-label');
    expect(markup).toContain('Platform');
  });

  test('renders sidebar menu', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('data-sidebar-menu');
  });

  test('renders menu items', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('Dashboard');
    expect(markup).toContain('Settings');
  });

  test('renders item URLs', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('href="/settings"');
  });

  test('renders collapsible containers', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('data-collapsible');
  });

  test('renders menu buttons with tooltips', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).toContain('data-sidebar-menu-button');
    expect(markup).toContain('data-tooltip="Dashboard"');
    expect(markup).toContain('data-tooltip="Settings"');
  });

  test('renders sub-items when provided', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('Overview');
    expect(markup).toContain('Analytics');
  });

  test('renders sub-item URLs', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('href="/dashboard/overview"');
    expect(markup).toContain('href="/dashboard/analytics"');
  });

  test('renders collapsible trigger for items with sub-items', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('data-collapsible-trigger');
  });

  test('renders collapsible content for items with sub-items', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('data-collapsible-content');
  });

  test('does not render collapsible trigger for items without sub-items', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={basicItems} />);

    expect(markup).not.toContain('data-collapsible-trigger');
    expect(markup).not.toContain('data-collapsible-content');
  });

  test('renders screen reader text for toggle', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('sr-only');
    expect(markup).toContain('Toggle');
  });

  test('passes isActive to collapsible defaultOpen', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('data-default-open="true"');
  });

  test('renders sub-menu container for nested items', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={itemsWithSubItems} />);

    expect(markup).toContain('data-sidebar-menu-sub');
    expect(markup).toContain('data-sidebar-menu-sub-item');
    expect(markup).toContain('data-sidebar-menu-sub-button');
  });

  test('renders empty when no items provided', async () => {
    const { NavMain } = await import('../src/components/nav-main');
    const markup = renderToStaticMarkup(<NavMain items={[]} />);

    expect(markup).toContain('data-sidebar-group');
    expect(markup).toContain('Platform');
    // Menu should still exist but be empty
    expect(markup).toContain('data-sidebar-menu');
  });
});

afterAll(() => {
  mock.restore();
});
