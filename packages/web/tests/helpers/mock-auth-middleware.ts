type AuthMiddlewareMockOverrides = Record<string, unknown>;

const passthrough = (handler: any) => async (req: any, context: any) => handler(req, context);

const baseAuthMiddlewareMock = {
  withAuth: passthrough,
  withAdminAuth: passthrough,
  withApiKeyAuth: passthrough,
  withScopedApiKeyAuth: passthrough,
  getAuthUser: async () => null,
  invalidateUserStatusCache: () => {},
  clearUserStatusCache: () => {},
};

export function createAuthMiddlewareMock(overrides: AuthMiddlewareMockOverrides = {}) {
  return { ...baseAuthMiddlewareMock, ...overrides };
}
