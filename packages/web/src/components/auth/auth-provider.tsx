'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/hooks/use-auth';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { accessToken, refreshAccessToken, setLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    const initialize = async () => {
      // If we have an access token stored, verify it's still valid
      if (accessToken) {
        try {
          const response = await fetch('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (response.status === 401) {
            // Token expired, try to refresh
            await refreshAccessToken();
          }
        } catch {
          // Token is invalid, user will be logged out
        }
      }
      setLoading(false);
    };

    initialize();
  }, []);

  return <>{children}</>;
}
