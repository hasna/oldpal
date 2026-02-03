import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, refreshTokens } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { getGoogleUserInfo } from '@/lib/auth/oauth';
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiry,
} from '@/lib/auth/jwt';
import { setRefreshTokenCookie } from '@/lib/auth/cookies';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Check for OAuth errors
    if (error) {
      const errorDescription = searchParams.get('error_description') || error;
      return redirectWithError(errorDescription);
    }

    if (!code) {
      return redirectWithError('No authorization code provided');
    }

    // Verify state for CSRF protection
    const storedState = request.cookies.get('oauth_state')?.value;
    if (!storedState || storedState !== state) {
      return redirectWithError('Invalid state parameter');
    }

    // Get PKCE code_verifier from cookie
    const codeVerifier = request.cookies.get('oauth_code_verifier')?.value;
    if (!codeVerifier) {
      return redirectWithError('Missing PKCE code verifier');
    }

    // Exchange code for user info with PKCE code_verifier
    const googleUser = await getGoogleUserInfo(code, codeVerifier);

    // Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.googleId, googleUser.id),
    });

    if (!user) {
      // Check if email already exists (link accounts)
      user = await db.query.users.findFirst({
        where: eq(users.email, googleUser.email.toLowerCase()),
      });

      if (user) {
        // Link Google account to existing user
        // Only set emailVerified to true if Google reports the email as verified
        [user] = await db
          .update(users)
          .set({
            googleId: googleUser.id,
            emailVerified: googleUser.verified_email || user.emailVerified,
            avatarUrl: user.avatarUrl || googleUser.picture,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning();
      } else {
        // Create new user
        [user] = await db
          .insert(users)
          .values({
            email: googleUser.email.toLowerCase(),
            emailVerified: googleUser.verified_email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
            googleId: googleUser.id,
            role: 'user',
          })
          .returning();
      }
    }

    // Create tokens
    const family = randomUUID();
    const accessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = await createRefreshToken({
      userId: user.id,
      family,
    });

    // Store refresh token
    const tokenHash = await hashPassword(refreshToken);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      family,
      expiresAt: getRefreshTokenExpiry(),
    });

    // Redirect with tokens in HTTP-only cookies (not URL query params for security)
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3001';
    const redirectUrl = new URL('/auth/callback', baseUrl);

    let response = NextResponse.redirect(redirectUrl);

    // Set refresh token using standard httpOnly cookie helper (persistent)
    response = setRefreshTokenCookie(response, refreshToken);

    // Set access token in a temporary cookie for callback page to read
    // This is short-lived and only used for the callback page to get the token into memory
    const isProduction = process.env.NODE_ENV === 'production';
    response.cookies.set('oauth_access_token', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60, // Short-lived: 60 seconds, just enough for callback page to read
    });

    // Clear OAuth cookies
    response.cookies.delete('oauth_state');
    response.cookies.delete('oauth_code_verifier');

    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);
    return redirectWithError('Authentication failed');
  }
}

function redirectWithError(message: string): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3001';
  const redirectUrl = new URL('/login', baseUrl);
  redirectUrl.searchParams.set('error', message);
  const response = NextResponse.redirect(redirectUrl);
  // Clear OAuth cookies on error to prevent stale state
  response.cookies.delete('oauth_state');
  response.cookies.delete('oauth_code_verifier');
  response.cookies.delete('oauth_access_token');
  return response;
}
