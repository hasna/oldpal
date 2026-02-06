import React from 'react';
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock state
let mockUser: any = null;

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => '/chat',
}));

// Mock next/link
mock.module('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock useAuthStore hook
mock.module('@/hooks/use-auth', () => ({
  useAuthStore: () => ({
    user: mockUser,
    isAuthenticated: !!mockUser,
    logout: () => {},
  }),
}));

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => ({
  Sidebar: ({ children, ...props }: any) => <aside data-testid="sidebar" {...props}>{children}</aside>,
  SidebarContent: ({ children }: any) => <div data-testid="sidebar-content">{children}</div>,
  SidebarFooter: ({ children }: any) => <footer data-testid="sidebar-footer">{children}</footer>,
  SidebarHeader: ({ children }: any) => <header data-testid="sidebar-header">{children}</header>,
  SidebarMenu: ({ children }: any) => <nav data-testid="sidebar-menu">{children}</nav>,
  SidebarMenuButton: ({ children, asChild, ...props }: any) => <button {...props}>{children}</button>,
  SidebarMenuItem: ({ children }: any) => <div data-testid="sidebar-menu-item">{children}</div>,
}));

// Mock nav components
mock.module('@/components/nav-main', () => ({
  NavMain: ({ items }: any) => (
    <nav data-testid="nav-main">
      {items.map((item: any) => (
        <div key={item.title} data-nav-item={item.title}>{item.title}</div>
      ))}
    </nav>
  ),
}));

mock.module('@/components/nav-projects', () => ({
  NavProjects: ({ projects }: any) => <nav data-testid="nav-projects">Projects</nav>,
}));

mock.module('@/components/nav-secondary', () => ({
  NavSecondary: ({ items }: any) => (
    <nav data-testid="nav-secondary">
      {items.map((item: any) => (
        <div key={item.title} data-nav-item={item.title}>{item.title}</div>
      ))}
    </nav>
  ),
}));

mock.module('@/components/nav-user', () => ({
  NavUser: ({ user }: any) => (
    <div data-testid="nav-user">
      <span data-user-name>{user.name}</span>
      <span data-user-email>{user.email}</span>
    </div>
  ),
}));

// Mock lucide-react icons
mock.module('lucide-react', () => ({
  Bot: () => <span>Bot</span>,
  Command: () => <span>Command</span>,
  Inbox: () => <span>Inbox</span>,
  LifeBuoy: () => <span>LifeBuoy</span>,
  MessageSquare: () => <span>MessageSquare</span>,
  Send: () => <span>Send</span>,
  Settings2: () => <span>Settings2</span>,
  SquareTerminal: () => <span>SquareTerminal</span>,
  History: () => <span>History</span>,
  Users: () => <span>Users</span>,
}));

describe('AppSidebar', () => {
  beforeEach(() => {
    mockUser = {
      id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      avatarUrl: 'https://example.com/avatar.png',
    };
  });

  test('exports AppSidebar component', async () => {
    const mod = await import('../src/components/app-sidebar');
    expect(mod.AppSidebar).toBeDefined();
    expect(typeof mod.AppSidebar).toBe('function');
  });

  test('renders sidebar component', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('sidebar');
  });

  test('renders sidebar header', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('sidebar-header');
  });

  test('renders brand logo with link to chat', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('/chat');
    expect(markup).toContain('Assistants');
    expect(markup).toContain('AI Platform');
  });

  test('renders sidebar content area', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('sidebar-content');
  });

  test('renders main navigation', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('nav-main');
  });

  test('renders navigation items', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('Chat');
    expect(markup).toContain('Assistants');
    expect(markup).toContain('Messages');
    expect(markup).toContain('Settings');
  });

  test('renders secondary navigation', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('nav-secondary');
    expect(markup).toContain('Support');
    expect(markup).toContain('Feedback');
  });

  test('renders sidebar footer', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('sidebar-footer');
  });

  test('renders user navigation', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('nav-user');
  });

  test('passes user data to NavUser', async () => {
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    expect(markup).toContain('Test User');
    expect(markup).toContain('test@example.com');
  });

  test('handles missing user gracefully', async () => {
    mockUser = null;
    const { AppSidebar } = await import('../src/components/app-sidebar');
    const markup = renderToStaticMarkup(<AppSidebar />);

    // Should show "Guest" when no user
    expect(markup).toContain('Guest');
  });
});
