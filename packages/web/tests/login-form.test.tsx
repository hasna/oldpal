import React from 'react';
import { describe, expect, test, afterAll, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';

// Mock state
let mockLogin: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: () => {},
    back: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
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
    login: mockLogin,
    user: null,
    isAuthenticated: false,
  }),
}));

// Mock UI components
mock.module('@/components/ui/Button', () => ({
  Button: ({ children, type, disabled, className }: any) => (
    <button type={type} disabled={disabled} className={className}>{children}</button>
  ),
  buttonVariants: () => '',
}));

mock.module('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

mock.module('@/components/ui/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

describe('LoginForm', () => {
  beforeEach(() => {
    mockLogin = mock(() => Promise.resolve());
    mockPush = mock(() => {});
  });

  test('exports LoginForm component', async () => {
    const mod = await import('../src/components/auth/login-form');
    expect(mod.LoginForm).toBeDefined();
    expect(typeof mod.LoginForm).toBe('function');
  });

  test('renders form element', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('<form');
  });

  test('renders email input field', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('id="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('placeholder="you@example.com"');
  });

  test('renders email label', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('Email');
    expect(markup).toContain('for="email"');
  });

  test('renders password input field', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('id="password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('placeholder="Enter your password"');
  });

  test('renders password label', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('Password');
    expect(markup).toContain('for="password"');
  });

  test('renders submit button', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Sign in');
  });

  test('renders link to register page', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('href="/register"');
    expect(markup).toContain('Sign up');
  });

  test('renders helper text for new users', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    // React escapes apostrophe as &#x27;
    expect(markup).toContain("Don&#x27;t have an account?");
  });

  test('inputs have required attribute', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    // Count required attributes in the form
    const requiredCount = (markup.match(/required/g) || []).length;
    expect(requiredCount).toBeGreaterThanOrEqual(2);
  });

  test('email input has autocomplete attribute', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    // React uses camelCase for autoComplete
    expect(markup).toContain('autoComplete="email"');
  });

  test('password input has autocomplete attribute', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    // React uses camelCase for autoComplete
    expect(markup).toContain('autoComplete="current-password"');
  });

  test('submit button spans full width', async () => {
    const { LoginForm } = await import('../src/components/auth/login-form');
    const markup = renderToStaticMarkup(<LoginForm />);

    expect(markup).toContain('w-full');
  });
});

afterAll(() => {
  mock.restore();
});
