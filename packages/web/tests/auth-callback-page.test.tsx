import React from 'react';
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
  }),
  useSearchParams: () => new URLSearchParams('accessToken=test&refreshToken=test'),
}));

// Mock useAuth hook
mock.module('@/hooks/use-auth', () => createUseAuthMock({
  useAuth: () => ({
    setAuth: () => {},
    user: null,
    isAuthenticated: false,
  }),
}));

describe('AuthCallbackPage', () => {
  test('exports default component', async () => {
    // Auth callback page uses useEffect hooks for client-side auth flow
    // We verify the module exports correctly - full testing via E2E
    const mod = await import('../src/app/auth/callback/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  test('renders loading state in suspense fallback', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');

    // The page uses Suspense with a fallback - we can render the fallback content
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    // Should contain the loading message
    expect(markup).toContain('Completing authentication');
  });

  test('contains spinner animation class', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    expect(markup).toContain('animate-spin');
  });

  test('uses centered flex layout', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    expect(markup).toContain('min-h-screen');
    expect(markup).toContain('flex');
    expect(markup).toContain('items-center');
    expect(markup).toContain('justify-center');
  });

  test('has background color styling', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    expect(markup).toContain('bg-gray-50');
  });

  test('displays spinner with correct border styling', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    expect(markup).toContain('rounded-full');
    expect(markup).toContain('border-b-2');
    expect(markup).toContain('border-sky-500');
  });

  test('has text center alignment', async () => {
    const { default: AuthCallbackPage } = await import('../src/app/auth/callback/page');
    const markup = renderToStaticMarkup(<AuthCallbackPage />);

    expect(markup).toContain('text-center');
  });
});

afterAll(() => {
  mock.restore();
});
