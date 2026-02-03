import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Cookie options for refresh token
 * - httpOnly: Prevents XSS attacks from accessing the cookie via JavaScript
 * - secure: Only sent over HTTPS in production
 * - sameSite: Strict prevents CSRF attacks
 * - path: Restrict to auth endpoints to minimize exposure
 */
function getCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  };
}

/**
 * Set refresh token cookie in response
 */
export function setRefreshTokenCookie(response: NextResponse, token: string): NextResponse {
  const options = getCookieOptions();
  response.cookies.set(REFRESH_TOKEN_COOKIE, token, options);
  return response;
}

/**
 * Clear refresh token cookie in response
 */
export function clearRefreshTokenCookie(response: NextResponse): NextResponse {
  const options = getCookieOptions();
  response.cookies.set(REFRESH_TOKEN_COOKIE, '', {
    ...options,
    maxAge: 0,
  });
  return response;
}

/**
 * Get refresh token from request cookies
 */
export async function getRefreshTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(REFRESH_TOKEN_COOKIE);
  return cookie?.value ?? null;
}
