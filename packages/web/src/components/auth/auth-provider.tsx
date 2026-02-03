'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useAuthStore } from '@/hooks/use-auth';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const initialized = useRef(false);

  useEffect(() => {
    // Only initialize once
    if (initialized.current) return;
    initialized.current = true;

    const initialize = async () => {
      const state = useAuthStore.getState();
      const { accessToken, refreshToken } = state;

      // If no access token, ensure we're logged out
      if (!accessToken) {
        useAuthStore.getState().setLoading(false);
        return;
      }

      // Verify token and hydrate user data from /auth/me
      try {
        const response = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.ok) {
          // Token is valid, hydrate user data
          const data = await response.json();
          if (data.success && data.data) {
            useAuthStore.getState().setAuth(data.data, accessToken, refreshToken || '');
          }
        } else if (response.status === 401 && refreshToken) {
          // Token expired, try to refresh
          try {
            const refreshResponse = await fetch('/api/v1/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });

            const refreshData = await refreshResponse.json();

            if (refreshData.success) {
              const { accessToken: newAccessToken, refreshToken: newRefreshToken } = refreshData.data;
              useAuthStore.getState().setTokens(newAccessToken, newRefreshToken);

              // Fetch user data with new token
              const meResponse = await fetch('/api/v1/auth/me', {
                headers: { Authorization: `Bearer ${newAccessToken}` },
              });

              if (meResponse.ok) {
                const meData = await meResponse.json();
                if (meData.success && meData.data) {
                  useAuthStore.getState().setAuth(meData.data, newAccessToken, newRefreshToken);
                }
              }
            } else {
              useAuthStore.getState().logout();
            }
          } catch {
            useAuthStore.getState().logout();
          }
        } else {
          // Token is invalid, log out
          useAuthStore.getState().logout();
        }
      } catch {
        // Network error, keep existing state but stop loading
      }

      useAuthStore.getState().setLoading(false);
    };

    initialize();
  }, []);

  return <>{children}</>;
}
