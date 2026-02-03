import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, refreshTokens } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '@/lib/auth/jwt';
import { errorResponse } from '@/lib/api/response';
import { UnauthorizedError } from '@/lib/api/errors';
import { getRefreshTokenFromCookie, setRefreshTokenCookie } from '@/lib/auth/cookies';
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit';
import { eq, and, isNull, gt } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  // Rate limit: 60 refresh attempts per minute per IP (normal API rate)
  // This is more lenient since refresh is called automatically on page load
  const rateLimitResponse = checkRateLimit(request, 'auth/refresh', RateLimitPresets.api);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Read refresh token from httpOnly cookie
    const refreshToken = await getRefreshTokenFromCookie();

    if (!refreshToken) {
      return errorResponse(new UnauthorizedError('No refresh token'));
    }

    // Verify the refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return errorResponse(new UnauthorizedError('Invalid refresh token'));
    }

    // Find valid token in DB
    const storedTokens = await db.query.refreshTokens.findMany({
      where: and(
        eq(refreshTokens.userId, payload.userId),
        eq(refreshTokens.family, payload.family),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date())
      ),
    });

    // Verify the token matches one of the stored tokens
    let matchedToken = null;
    for (const token of storedTokens) {
      if (await verifyPassword(refreshToken, token.tokenHash)) {
        matchedToken = token;
        break;
      }
    }

    if (!matchedToken) {
      // Token reuse detected - revoke entire family
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.family, payload.family));

      return errorResponse(new UnauthorizedError('Token has been revoked'));
    }

    // Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
    });

    if (!user) {
      return errorResponse(new UnauthorizedError('User not found'));
    }

    // Revoke old token
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, matchedToken.id));

    // Create new tokens (token rotation)
    const accessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const newRefreshToken = await createRefreshToken({
      userId: user.id,
      family: payload.family, // Keep same family for rotation detection
    });

    // Store new refresh token
    const tokenHash = await hashPassword(newRefreshToken);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      family: payload.family,
      expiresAt: getRefreshTokenExpiry(),
    });

    // Set new refresh token as httpOnly cookie (token rotation)
    // Access token is returned in body for in-memory storage only
    const response = NextResponse.json({
      success: true,
      data: {
        accessToken,
      },
    });

    return setRefreshTokenCookie(response, newRefreshToken);
  } catch (error) {
    return errorResponse(error);
  }
}
