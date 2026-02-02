'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuth();

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');

    if (accessToken && refreshToken) {
      // Fetch user info and set auth state
      fetch('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setAuth(data.data, accessToken, refreshToken);
            router.push('/chat');
          } else {
            router.push('/login?error=Authentication failed');
          }
        })
        .catch(() => {
          router.push('/login?error=Authentication failed');
        });
    } else {
      router.push('/login?error=Missing authentication tokens');
    }
  }, [searchParams, setAuth, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400 mx-auto"></div>
        <p className="mt-4 text-slate-400">Completing authentication...</p>
      </div>
    </div>
  );
}
