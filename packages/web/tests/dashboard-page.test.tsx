import React from 'react';
import { describe, expect, test, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => '/dashboard',
}));

// Mock next/link
mock.module('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock useAuth hook
mock.module('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
    isAuthenticated: true,
    logout: () => {},
  }),
}));

// Mock useSidebar hook - this is exported from sidebar component
mock.module('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: any) => <div data-testid="sidebar-provider">{children}</div>,
  SidebarInset: ({ children }: any) => <div data-testid="sidebar-inset">{children}</div>,
  SidebarTrigger: (props: any) => <button {...props}>Toggle</button>,
  useSidebar: () => ({
    state: 'expanded',
    open: true,
    setOpen: () => {},
    openMobile: false,
    setOpenMobile: () => {},
    isMobile: false,
    toggleSidebar: () => {},
  }),
}));

// Mock AppSidebar
mock.module('@/components/app-sidebar', () => ({
  AppSidebar: () => <div data-testid="app-sidebar">Sidebar</div>,
}));

describe('Dashboard Page', () => {
  test('exports default component', async () => {
    const mod = await import('../src/app/dashboard/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('renders page with sidebar provider', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('sidebar-provider');
  });

  test('renders breadcrumb navigation', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('Building Your Application');
    expect(markup).toContain('Data Fetching');
  });

  test('renders grid layout for content', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('grid');
    expect(markup).toContain('md:grid-cols-3');
  });

  test('renders placeholder cards', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('aspect-video');
    expect(markup).toContain('rounded-xl');
    expect(markup).toContain('bg-muted/50');
  });

  test('renders header with fixed height', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('h-16');
  });

  test('renders sidebar inset section', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('sidebar-inset');
  });

  test('uses flexbox layout', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('flex');
  });
});
