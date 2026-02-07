type OAuthMockOverrides = Record<string, unknown>;

export function createOAuthMock(overrides: OAuthMockOverrides = {}) {
  return {
    generateGoogleAuthUrl: (state?: string, codeChallenge?: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state ?? ''}&code_challenge=${codeChallenge ?? ''}`,
    getGoogleUserInfo: async () => ({
      id: 'google-123',
      email: 'user@example.com',
      verified_email: true,
      name: 'Test User',
      picture: undefined,
    }),
    generateCodeVerifier: () => 'mock-code-verifier',
    generateCodeChallenge: () => 'mock-code-challenge',
    isGoogleOAuthConfigured: () => true,
    ...overrides,
  };
}
