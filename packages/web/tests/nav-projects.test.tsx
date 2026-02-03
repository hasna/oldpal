import React from 'react';
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock state
let mockIsMobile = false;

// Mock lucide-react icons
mock.module('lucide-react', () => ({
  Folder: () => <span data-icon="folder">Folder</span>,
  MoreHorizontal: () => <span data-icon="more-horizontal">MoreHorizontal</span>,
  Share: () => <span data-icon="share">Share</span>,
  Trash2: () => <span data-icon="trash">Trash2</span>,
}));

// Mock dropdown menu components
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-dropdown-menu>{children}</div>,
  DropdownMenuContent: ({ children, className, side, align }: any) => (
    <div data-dropdown-menu-content className={className} data-side={side} data-align={align}>
      {children}
    </div>
  ),
  DropdownMenuItem: ({ children }: any) => <div data-dropdown-menu-item>{children}</div>,
  DropdownMenuSeparator: () => <hr data-dropdown-menu-separator />,
  DropdownMenuTrigger: ({ children, asChild }: any) => (
    <div data-dropdown-menu-trigger>{children}</div>
  ),
}));

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children, className }: any) => (
    <div data-sidebar-group className={className}>{children}</div>
  ),
  SidebarGroupLabel: ({ children }: any) => <div data-sidebar-group-label>{children}</div>,
  SidebarMenu: ({ children }: any) => <nav data-sidebar-menu>{children}</nav>,
  SidebarMenuAction: ({ children, showOnHover }: any) => (
    <button data-sidebar-menu-action data-show-on-hover={showOnHover}>{children}</button>
  ),
  SidebarMenuButton: ({ children, asChild }: any) => (
    <button data-sidebar-menu-button>{children}</button>
  ),
  SidebarMenuItem: ({ children }: any) => <div data-sidebar-menu-item>{children}</div>,
  useSidebar: () => ({ isMobile: mockIsMobile }),
}));

// Create mock icon component
const MockIcon = () => <span data-mock-icon>Icon</span>;

describe('NavProjects', () => {
  beforeEach(() => {
    mockIsMobile = false;
  });

  const basicProjects = [
    {
      name: 'Project Alpha',
      url: '/projects/alpha',
      icon: MockIcon,
    },
    {
      name: 'Project Beta',
      url: '/projects/beta',
      icon: MockIcon,
    },
  ];

  test('exports NavProjects component', async () => {
    const mod = await import('../src/components/nav-projects');
    expect(mod.NavProjects).toBeDefined();
    expect(typeof mod.NavProjects).toBe('function');
  });

  test('renders sidebar group', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-sidebar-group');
  });

  test('renders Projects group label', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-sidebar-group-label');
    expect(markup).toContain('Projects');
  });

  test('renders sidebar menu', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-sidebar-menu');
  });

  test('renders project names', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('Project Alpha');
    expect(markup).toContain('Project Beta');
  });

  test('renders project URLs', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('href="/projects/alpha"');
    expect(markup).toContain('href="/projects/beta"');
  });

  test('renders menu items for each project', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    const menuItemCount = (markup.match(/data-sidebar-menu-item/g) || []).length;
    // 2 projects + 1 "More" button
    expect(menuItemCount).toBe(3);
  });

  test('renders dropdown menus for projects', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-dropdown-menu');
    expect(markup).toContain('data-dropdown-menu-trigger');
    expect(markup).toContain('data-dropdown-menu-content');
  });

  test('renders View Project option', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('View Project');
  });

  test('renders Share Project option', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('Share Project');
  });

  test('renders Delete Project option', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('Delete Project');
  });

  test('renders dropdown menu separator', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-dropdown-menu-separator');
  });

  test('renders More button at the end', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    // The last menu item should be "More"
    expect(markup).toContain('>More<');
  });

  test('renders screen reader text for action', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('sr-only');
  });

  test('renders menu action with showOnHover', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('data-show-on-hover="true"');
  });

  test('applies collapsible hidden class to group', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('group-data-[collapsible=icon]:hidden');
  });

  test('dropdown content has fixed width class', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={basicProjects} />);

    expect(markup).toContain('w-48');
  });

  test('renders empty projects list gracefully', async () => {
    const { NavProjects } = await import('../src/components/nav-projects');
    const markup = renderToStaticMarkup(<NavProjects projects={[]} />);

    expect(markup).toContain('data-sidebar-group');
    expect(markup).toContain('Projects');
    // Should still have the "More" button
    expect(markup).toContain('>More<');
  });
});
