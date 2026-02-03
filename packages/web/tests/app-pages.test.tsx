import React from 'react';
import { describe, expect, test, mock } from 'bun:test';
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

const { default: RootLayout, metadata } = await import('../src/app/layout');
const { default: SettingsPage } = await import('../src/app/(dashboard)/settings/page');
const { default: HomePage } = await import('../src/app/page');


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

});
