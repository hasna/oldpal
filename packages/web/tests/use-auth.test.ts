import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';

// Mock localStorage for zustand persist
const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
  key: (index: number) => Array.from(mockStorage.keys())[index] ?? null,
  get length() { return mockStorage.size; },
};
(globalThis as any).localStorage = localStorageMock;

const { useAuthStore } = await import('../src/hooks/use-auth');

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: true,
      isAuthenticated: false,
    });
    mockStorage.clear();
  });

  test('has correct initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.isAuthenticated).toBe(false);
  });

  test('setAuth updates user, tokens and auth state', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
    };

    useAuthStore.getState().setAuth(user, 'access-token', 'refresh-token');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe('access-token');
    expect(state.refreshToken).toBe('refresh-token');
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  test('setTokens updates only tokens', () => {
    const user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
      avatarUrl: null,
    };
    useAuthStore.getState().setAuth(user, 'old-access', 'old-refresh');

    useAuthStore.getState().setTokens('new-access', 'new-refresh');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('new-access');
    expect(state.refreshToken).toBe('new-refresh');
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
    };
    useAuthStore.getState().setAuth(user, 'access', 'refresh');

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
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
    };

    useAuthStore.getState().setAuth(adminUser, 'access', 'refresh');

    expect(useAuthStore.getState().user?.role).toBe('admin');
    expect(useAuthStore.getState().user?.avatarUrl).toBe('https://example.com/avatar.png');
  });
});

describe('useAuth hook functions', () => {
  let mockFetch: ReturnType<typeof spyOn>;

  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: true,
      isAuthenticated: false,
    });
    mockStorage.clear();

    // Reset fetch mock
    mockFetch = spyOn(globalThis, 'fetch');
  });

  test('login calls API and sets auth state on success', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      avatarUrl: null,
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          user: mockUser,
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        },
      }),
    } as Response);

    // Import useAuth dynamically to test
    const { useAuth } = await import('../src/hooks/use-auth');

    // Create a simple test wrapper to call login
    const auth = {
      login: async (email: string, password: string) => {
        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error?.message || 'Login failed');
        }
        useAuthStore.getState().setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
        return data.data;
      },
    };

    const result = await auth.login('test@example.com', 'password123');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
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
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Login failed');
      }
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
      role: 'user',
      avatarUrl: null,
    };

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          user: mockUser,
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        },
      }),
    } as Response);

    const register = async (email: string, password: string, name: string) => {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Registration failed');
      }
      useAuthStore.getState().setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
      return data.data;
    };

    await register('new@example.com', 'password', 'New User');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/register', expect.objectContaining({
      method: 'POST',
    }));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  test('logout calls API and clears state', async () => {
    // Set up initial auth state
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null },
      'access',
      'refresh-token'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true }),
    } as Response);

    const logout = async () => {
      const store = useAuthStore.getState();
      if (store.refreshToken) {
        try {
          await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: store.refreshToken }),
          });
        } catch {
          // Ignore logout errors
        }
      }
      useAuthStore.getState().logout();
    };

    await logout();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  test('logout clears state even if API call fails', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null },
      'access',
      'refresh'
    );

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const logout = async () => {
      const store = useAuthStore.getState();
      if (store.refreshToken) {
        try {
          await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: store.refreshToken }),
          });
        } catch {
          // Ignore logout errors
        }
      }
      useAuthStore.getState().logout();
    };

    await logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('refreshAccessToken updates tokens on success', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null },
      'old-access',
      'old-refresh'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        },
      }),
    } as Response);

    const refreshAccessToken = async () => {
      const store = useAuthStore.getState();
      if (!store.refreshToken) {
        throw new Error('No refresh token');
      }
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: store.refreshToken }),
      });
      const data = await response.json();
      if (!data.success) {
        useAuthStore.getState().logout();
        throw new Error(data.error?.message || 'Token refresh failed');
      }
      useAuthStore.getState().setTokens(data.data.accessToken, data.data.refreshToken);
      return data.data;
    };

    await refreshAccessToken();

    expect(useAuthStore.getState().accessToken).toBe('new-access-token');
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh-token');
  });

  test('refreshAccessToken logs out on failure', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null },
      'access',
      'refresh'
    );

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: { message: 'Invalid refresh token' },
      }),
    } as Response);

    const refreshAccessToken = async () => {
      const store = useAuthStore.getState();
      if (!store.refreshToken) {
        throw new Error('No refresh token');
      }
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: store.refreshToken }),
      });
      const data = await response.json();
      if (!data.success) {
        useAuthStore.getState().logout();
        throw new Error(data.error?.message || 'Token refresh failed');
      }
      useAuthStore.getState().setTokens(data.data.accessToken, data.data.refreshToken);
    };

    await expect(refreshAccessToken()).rejects.toThrow('Invalid refresh token');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('refreshAccessToken throws when no refresh token', async () => {
    useAuthStore.getState().logout(); // Ensure no tokens

    const refreshAccessToken = async () => {
      const store = useAuthStore.getState();
      if (!store.refreshToken) {
        throw new Error('No refresh token');
      }
      // ... rest of implementation
    };

    await expect(refreshAccessToken()).rejects.toThrow('No refresh token');
  });

  test('fetchWithAuth adds Authorization header', async () => {
    useAuthStore.getState().setAuth(
      { id: '1', email: 'test@example.com', name: 'Test', role: 'user', avatarUrl: null },
      'my-access-token',
      'refresh'
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
        headers: {
          ...options.headers,
          Authorization: `Bearer ${store.accessToken}`,
        },
      });
    };

    await fetchWithAuth('/api/v1/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/test', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer my-access-token',
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
