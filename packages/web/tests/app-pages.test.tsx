import React from 'react';
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter' }),
  Sora: () => ({ variable: '--font-sora' }),
  JetBrains_Mono: () => ({ variable: '--font-mono' }),
}));

mock.module('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

mock.module('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'error' ? null : null),
  }),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  usePathname: () => '/',
}));

const { default: RootLayout, metadata } = await import('../src/app/layout');
const { default: SettingsPage } = await import('../src/app/(dashboard)/settings/page');
const { default: HomePage } = await import('../src/app/page');
const { default: AuthLayout } = await import('../src/app/(auth)/layout');
const { default: LoginPage } = await import('../src/app/(auth)/login/page');
const { default: RegisterPage } = await import('../src/app/(auth)/register/page');

// Admin pages use useAuth which requires complex mocking
// We test them by verifying exports exist - full testing via E2E


describe('app layout and pages', () => {
  test('RootLayout renders metadata and wraps children', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>Child</div>
      </RootLayout>
    );

    expect(metadata.title).toBe('Assistants Web');
    expect(markup).toContain('Child');
    expect(markup).toContain('font-body');
  });

  test('SettingsPage renders sections', () => {
    const markup = renderToStaticMarkup(<SettingsPage />);
    expect(markup).toContain('Settings');
    expect(markup).toContain('Profile');
  });

  test('HomePage renders structure', () => {
    const markup = renderToStaticMarkup(<HomePage />);
    expect(markup).toContain('Operations Console');
  });

  test('AuthLayout wraps children with branding', () => {
    const markup = renderToStaticMarkup(
      <AuthLayout>
        <div>Login Form</div>
      </AuthLayout>
    );
    expect(markup).toContain('Assistants');
    expect(markup).toContain('Login Form');
    expect(markup).toContain('Your personal AI assistant');
  });

  test('LoginPage renders welcome text and form structure', () => {
    const markup = renderToStaticMarkup(<LoginPage />);
    expect(markup).toContain('Welcome back');
    expect(markup).toContain('Sign in to your account');
    expect(markup).toContain('Or continue with');
  });

  test('RegisterPage renders create account text', () => {
    const markup = renderToStaticMarkup(<RegisterPage />);
    expect(markup).toContain('Create an account');
    expect(markup).toContain('Get started with Assistants');
    expect(markup).toContain('Or continue with');
  });

  test('Admin stats page exports component', async () => {
    // Admin pages use useAuth which requires complex mocking
    // This test verifies the module can be imported without errors
    const mod = await import('../src/app/(dashboard)/admin/stats/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Admin users page exports component', async () => {
    const mod = await import('../src/app/(dashboard)/admin/users/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Assistants page exports component', async () => {
    const mod = await import('../src/app/(dashboard)/assistants/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Chat page exports component', async () => {
    const mod = await import('../src/app/(dashboard)/chat/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Messages page exports component', async () => {
    const mod = await import('../src/app/(dashboard)/messages/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Sessions page exports component', async () => {
    const mod = await import('../src/app/(dashboard)/sessions/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('Dashboard layout exports component', async () => {
    const mod = await import('../src/app/(dashboard)/layout');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

});

afterAll(() => {
  mock.restore();
});
