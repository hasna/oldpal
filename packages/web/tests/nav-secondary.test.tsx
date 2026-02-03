import React from 'react';
import { describe, expect, test, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children, ...props }: any) => (
    <div data-sidebar-group {...props}>{children}</div>
  ),
  SidebarGroupContent: ({ children }: any) => (
    <div data-sidebar-group-content>{children}</div>
  ),
  SidebarMenu: ({ children }: any) => <nav data-sidebar-menu>{children}</nav>,
  SidebarMenuButton: ({ children, asChild, size }: any) => (
    <button data-sidebar-menu-button data-size={size}>{children}</button>
  ),
  SidebarMenuItem: ({ children }: any) => <div data-sidebar-menu-item>{children}</div>,
}));

// Create mock icon component
const MockIcon = () => <span data-mock-icon>Icon</span>;

describe('NavSecondary', () => {
  const basicItems = [
    {
      title: 'Support',
      url: '/support',
      icon: MockIcon,
    },
    {
      title: 'Feedback',
      url: '/feedback',
      icon: MockIcon,
    },
  ];

  test('exports NavSecondary component', async () => {
    const mod = await import('../src/components/nav-secondary');
    expect(mod.NavSecondary).toBeDefined();
    expect(typeof mod.NavSecondary).toBe('function');
  });

  test('renders sidebar group', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('data-sidebar-group');
  });

  test('renders sidebar group content', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('data-sidebar-group-content');
  });

  test('renders sidebar menu', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('data-sidebar-menu');
  });

  test('renders item titles', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('Support');
    expect(markup).toContain('Feedback');
  });

  test('renders item URLs', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('href="/support"');
    expect(markup).toContain('href="/feedback"');
  });

  test('renders menu items for each item', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    const menuItemCount = (markup.match(/data-sidebar-menu-item/g) || []).length;
    expect(menuItemCount).toBe(2);
  });

  test('renders menu buttons with small size', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('data-size="sm"');
  });

  test('renders menu buttons for each item', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    const buttonCount = (markup.match(/data-sidebar-menu-button/g) || []).length;
    expect(buttonCount).toBe(2);
  });

  test('renders icons for each item', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    const iconCount = (markup.match(/data-mock-icon/g) || []).length;
    expect(iconCount).toBe(2);
  });

  test('passes additional props to sidebar group', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(
      <NavSecondary items={basicItems} className="custom-class" data-testid="secondary-nav" />
    );

    expect(markup).toContain('class="custom-class"');
    expect(markup).toContain('data-testid="secondary-nav"');
  });

  test('renders empty items list gracefully', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={[]} />);

    expect(markup).toContain('data-sidebar-group');
    expect(markup).toContain('data-sidebar-group-content');
    expect(markup).toContain('data-sidebar-menu');
    // No menu items should be rendered
    expect(markup).not.toContain('data-sidebar-menu-item');
  });

  test('renders links as anchor elements', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('<a href=');
  });

  test('wraps item title in span', async () => {
    const { NavSecondary } = await import('../src/components/nav-secondary');
    const markup = renderToStaticMarkup(<NavSecondary items={basicItems} />);

    expect(markup).toContain('<span>Support</span>');
    expect(markup).toContain('<span>Feedback</span>');
  });
});
