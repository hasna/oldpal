import React from 'react';
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock Button component
mock.module('@/components/ui/Button', () => ({
  Button: ({ children, type, variant, className, onClick }: any) => (
    <button type={type} className={className} data-variant={variant} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('OAuthButtons', () => {
  test('exports OAuthButtons component', async () => {
    const mod = await import('../src/components/auth/oauth-buttons');
    expect(mod.OAuthButtons).toBeDefined();
    expect(typeof mod.OAuthButtons).toBe('function');
  });

  test('renders container div', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('<div');
    expect(markup).toContain('space-y-3');
  });

  test('renders Google login button', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('Continue with Google');
  });

  test('renders button as type="button"', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('type="button"');
  });

  test('button has outline variant', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('data-variant="outline"');
  });

  test('button spans full width', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('w-full');
  });

  test('renders Google logo SVG', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('viewBox="0 0 24 24"');
  });

  test('SVG has proper sizing classes', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('h-4');
    expect(markup).toContain('w-4');
    expect(markup).toContain('mr-2');
  });

  test('SVG paths have fill color', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    expect(markup).toContain('fill="currentColor"');
  });

  test('renders four SVG path elements for Google logo', async () => {
    const { OAuthButtons } = await import('../src/components/auth/oauth-buttons');
    const markup = renderToStaticMarkup(<OAuthButtons />);

    const pathCount = (markup.match(/<path/g) || []).length;
    expect(pathCount).toBe(4);
  });
});

afterAll(() => {
  mock.restore();
});
