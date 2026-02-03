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
      // On page load, tokens are not in memory (only access token lives in memory)
      // But refresh token might be in httpOnly cookie
      // Try to get a new access token via refresh
      try {
        const refreshResponse = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include', // Send refresh token cookie
        });

        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();

          if (refreshData.success && refreshData.data?.accessToken) {
            const newAccessToken = refreshData.data.accessToken;

            // Fetch user data with new token
            const meResponse = await fetch('/api/v1/auth/me', {
              headers: { Authorization: `Bearer ${newAccessToken}` },
              credentials: 'include',
            });

            if (meResponse.ok) {
              const meData = await meResponse.json();
              if (meData.success && meData.data) {
                useAuthStore.getState().setAuth(meData.data, newAccessToken);
                return;
              }
            }
          }
        }

        // No valid session, ensure we're logged out
        useAuthStore.getState().logout();
      } catch {
        // Network error, assume not logged in
        useAuthStore.getState().logout();
      }

      useAuthStore.getState().setLoading(false);
    };

    initialize();
  }, []);

  return <>{children}</>;
}
