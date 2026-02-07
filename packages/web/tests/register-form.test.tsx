import React from 'react';
import { describe, expect, test, afterAll, mock, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createUseAuthMock } from './helpers/mock-use-auth';

// Mock state
let mockRegister: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

// Mock next/navigation
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: () => {},
    back: () => {},
  }),
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
    register: mockRegister,
    user: null,
    isAuthenticated: false,
  }),
}));

// Mock UI components
mock.module('@/components/ui/Button', () => ({
  Button: ({ children, type, disabled, className }: any) => (
    <button type={type} disabled={disabled} className={className}>{children}</button>
  ),
}));

mock.module('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

mock.module('@/components/ui/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

describe('RegisterForm', () => {
  beforeEach(() => {
    mockRegister = mock(() => Promise.resolve());
    mockPush = mock(() => {});
  });

  test('exports RegisterForm component', async () => {
    const mod = await import('../src/components/auth/register-form');
    expect(mod.RegisterForm).toBeDefined();
    expect(typeof mod.RegisterForm).toBe('function');
  });

  test('renders form element', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('<form');
  });

  test('renders name input field', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('id="name"');
    expect(markup).toContain('type="text"');
    expect(markup).toContain('placeholder="Your name"');
  });

  test('renders name label', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('Name');
    expect(markup).toContain('for="name"');
  });

  test('renders email input field', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('id="email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('placeholder="you@example.com"');
  });

  test('renders email label', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('Email');
    expect(markup).toContain('for="email"');
  });

  test('renders password input field', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('id="password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('placeholder="Create a password"');
  });

  test('renders password label', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('Password');
    expect(markup).toContain('for="password"');
  });

  test('renders confirm password input field', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('id="confirmPassword"');
    expect(markup).toContain('placeholder="Confirm your password"');
  });

  test('renders confirm password label', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('Confirm Password');
    expect(markup).toContain('for="confirmPassword"');
  });

  test('renders submit button', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Create account');
  });

  test('renders link to login page', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('href="/login"');
    expect(markup).toContain('Sign in');
  });

  test('renders helper text for existing users', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('Already have an account?');
  });

  test('inputs have required attribute', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    // Count required attributes in the form - should be 4 (name, email, password, confirm)
    const requiredCount = (markup.match(/required/g) || []).length;
    expect(requiredCount).toBeGreaterThanOrEqual(4);
  });

  test('name input has autocomplete attribute', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('autoComplete="name"');
  });

  test('email input has autocomplete attribute', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('autoComplete="email"');
  });

  test('password inputs have new-password autocomplete', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    // Both password and confirmPassword should have new-password autocomplete
    const newPasswordCount = (markup.match(/autoComplete="new-password"/g) || []).length;
    expect(newPasswordCount).toBe(2);
  });

  test('submit button spans full width', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('w-full');
  });

  test('form has proper spacing', async () => {
    const { RegisterForm } = await import('../src/components/auth/register-form');
    const markup = renderToStaticMarkup(<RegisterForm />);

    expect(markup).toContain('space-y-4');
    expect(markup).toContain('space-y-2');
  });
});

afterAll(() => {
  mock.restore();
});
