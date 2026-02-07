type JwtMockOverrides = Record<string, unknown>;

export function createJwtMock(overrides: JwtMockOverrides = {}) {
  return {
    verifyAccessToken: async () => null,
    verifyRefreshToken: async () => null,
    createAccessToken: async () => 'mock-access-token',
    createRefreshToken: async () => 'mock-refresh-token',
    getRefreshTokenExpiry: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}
