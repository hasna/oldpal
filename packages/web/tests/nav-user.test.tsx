import React from 'react';
import { describe, expect, test, afterAll, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLucideMock } from './helpers/mock-lucide-react';
import { createSidebarMock } from './helpers/mock-sidebar';

// Mock state
let mockIsMobile = false;

// Mock lucide-react icons (generic proxy)
const lucideMock = createLucideMock();
mock.module('lucide-react', () => lucideMock);
mock.module('lucide-react/dist/cjs/lucide-react.js', () => lucideMock);

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => '/',
}));

// Mock useAuth hook
mock.module('@/hooks/use-auth', () => ({
  useAuth: () => ({
    logout: async () => {},
  }),
}));

// Mock avatar components
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

// Mock dropdown menu components
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-dropdown-menu>{children}</div>,
  DropdownMenuContent: ({ children, className, side, align, sideOffset }: any) => (
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
  DropdownMenuTrigger: ({ children, asChild }: any) => (
    <div data-dropdown-menu-trigger>{children}</div>
  ),
}));

// Mock sidebar components
mock.module('@/components/ui/sidebar', () => createSidebarMock({
  getIsMobile: () => mockIsMobile,
}));

describe('NavUser', () => {
  beforeEach(() => {
    mockIsMobile = false;
  });

  const testUser = {
    name: 'John Doe',
    email: 'john@example.com',
    avatar: 'https://example.com/avatar.jpg',
  };

  test('exports NavUser component', async () => {
    const mod = await import('../src/components/nav-user');
    expect(mod.NavUser).toBeDefined();
    expect(typeof mod.NavUser).toBe('function');
  });

  test('renders sidebar menu', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-sidebar-menu');
  });

  test('renders sidebar menu item', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-sidebar-menu-item');
  });

  test('renders dropdown menu', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-dropdown-menu');
    expect(markup).toContain('data-dropdown-menu-trigger');
    expect(markup).toContain('data-dropdown-menu-content');
  });

  test('renders user name', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('John Doe');
  });

  test('renders user email', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('john@example.com');
  });

  test('renders user avatar', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-avatar');
    expect(markup).toContain('data-avatar-image');
    expect(markup).toContain('src="https://example.com/avatar.jpg"');
  });

  test('renders avatar fallback', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-avatar-fallback');
    expect(markup).toContain('CN');
  });

  test('renders Upgrade to Pro option', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('Upgrade to Pro');
    expect(markup).toContain('data-icon="Sparkles"');
  });

  test('renders Account option', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('Account');
    expect(markup).toContain('data-icon="BadgeCheck"');
  });

  test('renders Billing option', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('Billing');
    expect(markup).toContain('data-icon="CreditCard"');
  });

  test('renders Notifications option', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('Notifications');
    expect(markup).toContain('data-icon="Bell"');
  });

  test('renders Log out option', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('Log out');
    expect(markup).toContain('data-icon="LogOut"');
  });

  test('renders menu button with large size', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-size="lg"');
  });

  test('renders dropdown menu separators', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    const separatorCount = (markup.match(/data-dropdown-menu-separator/g) || []).length;
    expect(separatorCount).toBe(3);
  });

  test('renders dropdown menu groups', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    const groupCount = (markup.match(/data-dropdown-menu-group/g) || []).length;
    expect(groupCount).toBe(2);
  });

  test('renders dropdown menu label', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-dropdown-menu-label');
  });

  test('renders avatar with alt text', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('alt="John Doe"');
  });

  test('renders chevrons up down icon', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('data-icon="ChevronsUpDown"');
  });

  test('renders user info with truncate styling', async () => {
    const { NavUser } = await import('../src/components/nav-user');
    const markup = renderToStaticMarkup(<NavUser user={testUser} />);

    expect(markup).toContain('truncate');
    expect(markup).toContain('font-semibold');
  });
});

afterAll(() => {
  mock.restore();
});
