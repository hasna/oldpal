import React from 'react';
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';
import { createSidebarMock } from './helpers/mock-sidebar';

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
mock.module('@/hooks/use-auth', () => createUseAuthMock({
  useAuth: () => ({
    user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
    isAuthenticated: true,
    isLoading: false,
    logout: () => {},
  }),
}));

// Mock useSidebar hook - this is exported from sidebar component
mock.module('@/components/ui/sidebar', () => createSidebarMock());

describe('Dashboard Page', () => {
  test('exports default component', async () => {
    const mod = await import('../src/app/dashboard/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('renders loading shell', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('min-h-screen');
    expect(markup).toContain('items-center');
    expect(markup).toContain('justify-center');
  });

  test('renders spinner indicator', async () => {
    const { default: DashboardPage } = await import('../src/app/dashboard/page');
    const markup = renderToStaticMarkup(<DashboardPage />);

    expect(markup).toContain('animate-spin');
    expect(markup).toContain('rounded-full');
    expect(markup).toContain('border-b-2');
  });
});

afterAll(() => {
  mock.restore();
});
