type UseAuthMockOverrides = Record<string, unknown>;

export function createUseAuthMock(overrides: UseAuthMockOverrides = {}) {
  let state = {
    user: null as any,
    accessToken: null as string | null,
    isLoading: false,
    isAuthenticated: false,
    refreshAccessToken: async () => {},
    setAuth: (user: any, accessToken: string) => {
      setState({
        user,
        accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setAccessToken: (accessToken: string) => {
      setState({
        accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setLoading: (loading: boolean) => {
      setState({ isLoading: loading });
    },
    logout: () => {
      setState({
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
      });
    },
  };

  const setState = (next: Partial<typeof state> | ((prev: typeof state) => Partial<typeof state>)) => {
    const update = typeof next === 'function' ? next(state) : next;
    state = { ...state, ...update };
  };

  const store = {
    getState: () => state,
    setState,
  };

  return {
    useAuth: () => state,
    useAuthStore: store,
    ...overrides,
  };
}
