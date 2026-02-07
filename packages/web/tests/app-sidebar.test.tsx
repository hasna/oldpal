import React from 'react';
import { describe, expect, test, afterAll, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';
import { createLucideMock } from './helpers/mock-lucide-react';
import { createSidebarMock } from './helpers/mock-sidebar';

// Mock state
let mockUser: any = null;

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/chat',
}));

// Mock next/link
mock.module('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock useAuthStore hook
mock.module('@/hooks/use-auth', () => createUseAuthMock({
  useAuthStore: () => ({
    user: mockUser,
    isAuthenticated: !!mockUser,
    logout: () => {},
  }),
}));

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => createSidebarMock());

// Mock collapsible components used in NavMain
mock.module('@/components/ui/collapsible', () => ({
  Collapsible: ({ children, defaultOpen }: any) => (
    <div data-collapsible data-default-open={defaultOpen}>{children}</div>
  ),
  CollapsibleContent: ({ children }: any) => (
    <div data-collapsible-content>{children}</div>
  ),
  CollapsibleTrigger: ({ children }: any) => (
    <div data-collapsible-trigger>{children}</div>
  ),
}));

// Mock dropdown menu components used in NavProjects/NavUser
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-dropdown-menu>{children}</div>,
  DropdownMenuContent: ({ children, className, side, align }: any) => (
    <div data-dropdown-menu-content className={className} data-side={side} data-align={align}>
      {children}
    </div>
  ),
  DropdownMenuGroup: ({ children }: any) => <div data-dropdown-menu-group>{children}</div>,
  DropdownMenuItem: ({ children }: any) => <div data-dropdown-menu-item>{children}</div>,
  DropdownMenuLabel: ({ children, className }: any) => (
    <div data-dropdown-menu-label className={className}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr data-dropdown-menu-separator />,
  DropdownMenuTrigger: ({ children }: any) => <div data-dropdown-menu-trigger>{children}</div>,
}));

// Mock avatar components used in NavUser
mock.module('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: any) => (
    <div data-avatar className={className}>{children}</div>
  ),
  AvatarFallback: ({ children, className }: any) => (
    <span data-avatar-fallback className={className}>{children}</span>
  ),
  AvatarImage: ({ src, alt }: any) => (
    <img data-avatar-image src={src} alt={alt} />
  ),
}));

// Mock lucide-react icons (generic proxy)
const lucideMock = createLucideMock();
mock.module('lucide-react', () => lucideMock);
mock.module('lucide-react/dist/cjs/lucide-react.js', () => lucideMock);

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

    expect(markup).toContain('Platform');
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

    expect(markup).toContain('Test User');
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

afterAll(() => {
  mock.restore();
});
