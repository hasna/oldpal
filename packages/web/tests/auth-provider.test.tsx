import React from 'react';
import { describe, expect, test, afterAll, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';

// Mock state
let mockAccessToken: string | null = null;
let mockRefreshAccessToken: ReturnType<typeof mock>;
let mockSetLoading: ReturnType<typeof mock>;

// Mock useAuth hook
mock.module('@/hooks/use-auth', () => createUseAuthMock({
  useAuth: () => ({
    accessToken: mockAccessToken,
    refreshAccessToken: mockRefreshAccessToken,
    setLoading: mockSetLoading,
    user: null,
    isAuthenticated: false,
  }),
}));

describe('AuthProvider', () => {
  beforeEach(() => {
    mockAccessToken = null;
    mockRefreshAccessToken = mock(() => Promise.resolve());
    mockSetLoading = mock(() => {});
  });

  test('exports AuthProvider component', async () => {
    const mod = await import('../src/components/auth/auth-provider');
    expect(mod.AuthProvider).toBeDefined();
    expect(typeof mod.AuthProvider).toBe('function');
  });

  test('renders children', async () => {
    const { AuthProvider } = await import('../src/components/auth/auth-provider');
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <div data-testid="child">Child Content</div>
      </AuthProvider>
    );

    expect(markup).toContain('Child Content');
    expect(markup).toContain('child');
  });

  test('renders multiple children', async () => {
    const { AuthProvider } = await import('../src/components/auth/auth-provider');
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <div>First Child</div>
        <div>Second Child</div>
      </AuthProvider>
    );

    expect(markup).toContain('First Child');
    expect(markup).toContain('Second Child');
  });

  test('renders nested components', async () => {
    const { AuthProvider } = await import('../src/components/auth/auth-provider');
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <div className="parent">
          <span className="nested">Nested Content</span>
        </div>
      </AuthProvider>
    );

    expect(markup).toContain('parent');
    expect(markup).toContain('nested');
    expect(markup).toContain('Nested Content');
  });

  test('preserves child props', async () => {
    const { AuthProvider } = await import('../src/components/auth/auth-provider');
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <button type="submit" disabled>Submit</button>
      </AuthProvider>
    );

    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled');
    expect(markup).toContain('Submit');
  });

  test('renders fragment containing children', async () => {
    const { AuthProvider } = await import('../src/components/auth/auth-provider');
    const markup = renderToStaticMarkup(
      <AuthProvider>
        <main>Main Content</main>
      </AuthProvider>
    );

    // Should not add extra wrapper elements
    expect(markup).toContain('<main>');
    expect(markup).toContain('Main Content');
  });
});

afterAll(() => {
  mock.restore();
});
