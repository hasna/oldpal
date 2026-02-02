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
import { errorResponse } from '@/lib/api/response';
import { BadRequestError, UnauthorizedError } from '@/lib/api/errors';
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

    // Exchange code for user info
    const googleUser = await getGoogleUserInfo(code);

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
        [user] = await db
          .update(users)
          .set({
            googleId: googleUser.id,
            emailVerified: true,
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

    // Redirect with tokens
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3001';
    const redirectUrl = new URL('/auth/callback', baseUrl);
    redirectUrl.searchParams.set('accessToken', accessToken);
    redirectUrl.searchParams.set('refreshToken', refreshToken);

    const response = NextResponse.redirect(redirectUrl);

    // Clear state cookie
    response.cookies.delete('oauth_state');

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
  return NextResponse.redirect(redirectUrl);
}
