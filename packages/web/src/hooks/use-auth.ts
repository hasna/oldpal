'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: true,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
        }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
        }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    }
  )
);

export function useAuth() {
  const store = useAuthStore();

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

    store.setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
    return data.data;
  };

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

    store.setAuth(data.data.user, data.data.accessToken, data.data.refreshToken);
    return data.data;
  };

  const logout = async () => {
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
    store.logout();
  };

  const refreshAccessToken = async () => {
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
      store.logout();
      throw new Error(data.error?.message || 'Token refresh failed');
    }

    store.setTokens(data.data.accessToken, data.data.refreshToken);
    return data.data;
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    if (!store.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${store.accessToken}`,
      },
    });

    // If unauthorized, try to refresh token
    if (response.status === 401 && store.refreshToken) {
      try {
        await refreshAccessToken();
        // Retry request with new token
        return fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${store.accessToken}`,
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
