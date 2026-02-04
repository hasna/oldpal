'use client';

import { create } from 'zustand';
import { useChatStore } from '@/lib/store';

// Module-level refresh lock to prevent concurrent refresh races
let refreshPromise: Promise<{ accessToken: string }> | null = null;

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  avatarUrl: string | null;
  hasPassword: boolean; // false for OAuth-only users
}

interface AuthState {
  user: AuthUser | null;
  // Access token kept in memory only (not persisted to localStorage)
  // This prevents XSS attacks from stealing tokens
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  setAuth: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

// Using plain zustand without persist - tokens are kept in memory only
// Refresh token is stored in httpOnly cookie (managed by server)
export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  isAuthenticated: false,

  setAuth: (user, accessToken) =>
    set({
      user,
      accessToken,
      isAuthenticated: true,
      isLoading: false,
    }),

  setAccessToken: (accessToken) =>
    set({
      accessToken,
      // Ensure isAuthenticated stays true when tokens are refreshed
      isAuthenticated: true,
      isLoading: false,
    }),

  logout: () =>
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),
}));

export function useAuth() {
  const store = useAuthStore();

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include', // Include cookies in request/response
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Login failed');
    }

    // Refresh token is set as httpOnly cookie by server
    // Only access token is returned in response body
    store.setAuth(data.data.user, data.data.accessToken);
    return data.data;
  };

  const register = async (email: string, password: string, name: string) => {
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
      credentials: 'include', // Include cookies in request/response
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Registration failed');
    }

    // Refresh token is set as httpOnly cookie by server
    // Only access token is returned in response body
    store.setAuth(data.data.user, data.data.accessToken);
    return data.data;
  };

  const logout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include', // Send refresh token cookie
      });
    } catch {
      // Ignore logout errors
    }
    // Clear chat state on logout to prevent data leakage
    useChatStore.getState().clearAll();
    store.logout();
  };

  const refreshAccessToken = async () => {
    // If a refresh is already in progress, reuse it to prevent race conditions
    if (refreshPromise) {
      return refreshPromise;
    }

    // Create a new refresh promise and store it
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include', // Send refresh token cookie
        });

        const data = await response.json();

        if (!data.success) {
          store.logout();
          throw new Error(data.error?.message || 'Token refresh failed');
        }

        // New refresh token is set as httpOnly cookie by server
        // Only access token is returned in response body
        store.setAccessToken(data.data.accessToken);
        return data.data;
      } finally {
        // Clear the promise when done (success or failure)
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    if (!store.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(url, {
      ...options,
      credentials: 'include', // Include cookies
      headers: {
        ...options.headers,
        Authorization: `Bearer ${store.accessToken}`,
      },
    });

    // If unauthorized, try to refresh token (refresh token is in httpOnly cookie)
    if (response.status === 401) {
      // Only retry if body is repeatable (string, undefined, or null)
      // Non-repeatable bodies (streams, FormData, Blob) can't be re-sent
      const isBodyRepeatable = options.body === undefined ||
        options.body === null ||
        typeof options.body === 'string';

      if (!isBodyRepeatable) {
        // Can't retry with non-repeatable body, let the 401 propagate
        return response;
      }

      try {
        await refreshAccessToken();
        const freshToken = useAuthStore.getState().accessToken;
        if (!freshToken) {
          throw new Error('Session expired');
        }
        // Retry request with new token
        return fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            ...options.headers,
            Authorization: `Bearer ${freshToken}`,
          },
        });
      } catch {
        store.logout();
        throw new Error('Session expired');
      }
    }

    return response;
  };

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    accessToken: store.accessToken,
    login,
    register,
    logout,
    refreshAccessToken,
    fetchWithAuth,
    setAuth: store.setAuth,
    setLoading: store.setLoading,
  };
}
