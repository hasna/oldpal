'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

function AuthCallbackContent() {
  const router = useRouter();
  const { setAuth } = useAuth();
  const exchangeAttempted = useRef(false);

  useEffect(() => {
    // Prevent duplicate attempts in strict mode
    if (exchangeAttempted.current) return;
    exchangeAttempted.current = true;

    // Exchange HTTP-only cookies for tokens via secure API endpoint
    // This avoids passing tokens in URL query params (security improvement)
    // The refresh token is already in a persistent httpOnly cookie
    fetch('/api/v1/auth/oauth/exchange', {
      method: 'POST',
      credentials: 'include', // Important: include cookies
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          const { user, accessToken } = data.data;
          // setAuth only takes user and accessToken now
          // refreshToken is stored in httpOnly cookie
          setAuth(user, accessToken);
          router.push('/chat');
        } else {
          router.push('/login?error=' + encodeURIComponent(data.error?.message || 'Authentication failed'));
        }
      })
      .catch(() => {
        router.push('/login?error=Authentication failed');
      });
  }, [setAuth, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mx-auto"></div>
        <p className="mt-4 text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Completing authentication...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
