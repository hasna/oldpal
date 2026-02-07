import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';

let clearAllCalls = 0;

// Mock chat store used during logout
mock.module('@/lib/store', () => ({
  useChatStore: {
    getState: () => ({
      clearAll: () => {
        clearAllCalls += 1;
      },
    }),
  },
}));

const authModule = await import('../src/hooks/use-auth');
const { useAuthStore } = authModule;
const { useChatStore } = await import('@/lib/store');

describe('useAuthStore', () => {
  beforeEach(() => {
    clearAllCalls = 0;
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isLoading: true,
      isAuthenticated: false,
    });
  });

  test('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
  });

  test('setAuth updates user and auth state', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
      hasPassword: true,
    };

    useAuthStore.getState().setAuth(user, 'access-token');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('access-token');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  test('setAccessToken updates token and keeps auth state', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
      hasPassword: true,
    };
    useAuthStore.getState().setAuth(user, 'old-access');

    useAuthStore.getState().setAccessToken('new-access');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-access');
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
  });

  test('logout clears auth state', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
      hasPassword: true,
    };
    useAuthStore.getState().setAuth(user, 'access');

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  test('setLoading updates loading state', () => {
    expect(useAuthStore.getState().isLoading).toBe(true);

    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);

    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
  });

  test('admin role is stored correctly', () => {
    const adminUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin' as const,
      avatarUrl: 'https://example.com/avatar.png',
      hasPassword: false,
    };

    useAuthStore.getState().setAuth(adminUser, 'access');

    expect(useAuthStore.getState().user?.role).toBe('admin');
    expect(useAuthStore.getState().user?.avatarUrl).toBe('https://example.com/avatar.png');
  });
});

describe('useAuth hook functions', () => {
  let mockFetch: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearAllCalls = 0;
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isLoading: true,
      isAuthenticated: false,
    });

    mockFetch = spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  test('login calls API and sets auth state on success', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
      hasPassword: true,
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          user: mockUser,
          accessToken: 'new-access-token',
        },
      }),
    } as Response);

    const login = async (email: string, password: string) => {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Login failed');
      }
      useAuthStore.getState().setAuth(data.data.user, data.data.accessToken);
      return data.data;
    };

    const result = await login('test@example.com', 'password123');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      credentials: 'include',
    }));
    expect(result.user).toEqual(mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('new-access-token');
  });

  test('login throws error on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: { message: 'Invalid credentials' },
      }),
    } as Response);

    const login = async (email: string, password: string) => {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Login failed');
      }
      useAuthStore.getState().setAuth(data.data.user, data.data.accessToken);
      return data.data;
    };

    await expect(login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('register calls API and sets auth state on success', async () => {
    const mockUser = {
      id: 'user-2',
      email: 'new@example.com',
      name: 'New User',
      role: 'user' as const,
      avatarUrl: null,
      hasPassword: true,
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          user: mockUser,
          accessToken: 'new-access',
        },
      }),
    } as Response);

    const register = async (email: string, password: string, name: string) => {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Registration failed');
      }
      useAuthStore.getState().setAuth(data.data.user, data.data.accessToken);
      return data.data;
    };

    await register('new@example.com', 'password', 'New User');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/register', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('logout calls API and clears state', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'access'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    } as Response);

    const logout = async () => {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Ignore logout errors
      }
      useChatStore.getState().clearAll();
      useAuthStore.getState().logout();
    };

    await logout();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(clearAllCalls).toBe(1);
  });

  test('logout clears state even if API call fails', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'access'
    );

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const logout = async () => {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Ignore logout errors
      }
      useChatStore.getState().clearAll();
      useAuthStore.getState().logout();
    };

    await logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(clearAllCalls).toBe(1);
  });

  test('refreshAccessToken updates access token on success', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'old-access'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          accessToken: 'new-access-token',
        },
      }),
    } as Response);

    const refreshAccessToken = async () => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        useAuthStore.getState().logout();
        throw new Error(data.error?.message || 'Token refresh failed');
      }
      useAuthStore.getState().setAccessToken(data.data.accessToken);
      return data.data;
    };

    await refreshAccessToken();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(useAuthStore.getState().accessToken).toBe('new-access-token');
  });

  test('refreshAccessToken logs out on failure', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'access'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: { message: 'Invalid refresh token' },
      }),
    } as Response);

    const refreshAccessToken = async () => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        useAuthStore.getState().logout();
        throw new Error(data.error?.message || 'Token refresh failed');
      }
      useAuthStore.getState().setAccessToken(data.data.accessToken);
      return data.data;
    };

    await expect(refreshAccessToken()).rejects.toThrow('Invalid refresh token');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('fetchWithAuth adds Authorization header', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'my-access-token'
    );

    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ data: 'success' }),
    } as Response);

    const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
      const store = useAuthStore.getState();
      if (!store.accessToken) {
        throw new Error('Not authenticated');
      }
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...options.headers,
          Authorization: `Bearer ${store.accessToken}`,
        },
      });
    };

    await fetchWithAuth('/api/v1/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/test', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({
        Authorization: 'Bearer my-access-token',
      }),
    }));
  });

  test('fetchWithAuth retries after 401 and refreshes token', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null, hasPassword: true },
      'old-access'
    );

    mockFetch
      .mockResolvedValueOnce({ status: 401 } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { accessToken: 'new-access' },
        }),
      } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);

    const refreshAccessToken = async () => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!data.success) {
        useAuthStore.getState().logout();
        throw new Error(data.error?.message || 'Token refresh failed');
      }
      useAuthStore.getState().setAccessToken(data.data.accessToken);
      return data.data;
    };

    const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
      const store = useAuthStore.getState();
      if (!store.accessToken) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...options.headers,
          Authorization: `Bearer ${store.accessToken}`,
        },
      });

      if (response.status === 401) {
        const isBodyRepeatable = options.body === undefined ||
          options.body === null ||
          typeof options.body === 'string';

        if (!isBodyRepeatable) {
          return response;
        }

        try {
          await refreshAccessToken();
          const freshToken = useAuthStore.getState().accessToken;
          if (!freshToken) {
            throw new Error('Session expired');
          }
          return fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
              ...options.headers,
              Authorization: `Bearer ${freshToken}`,
            },
          });
        } catch {
          useAuthStore.getState().logout();
          throw new Error('Session expired');
        }
      }

      return response;
    };

    await fetchWithAuth('/api/v1/test');

    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/v1/test', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({
        Authorization: 'Bearer old-access',
      }),
    }));
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(mockFetch).toHaveBeenNthCalledWith(3, '/api/v1/test', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({
        Authorization: 'Bearer new-access',
      }),
    }));
  });

  test('fetchWithAuth throws when not authenticated', async () => {
    useAuthStore.getState().logout();

    const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
      const store = useAuthStore.getState();
      if (!store.accessToken) {
        throw new Error('Not authenticated');
      }
      return fetch(url, options);
    };

    await expect(fetchWithAuth('/api/v1/test')).rejects.toThrow('Not authenticated');
  });
});
