import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { refreshTokens } from '@/db/schema';
import { verifyRefreshToken } from '@/lib/auth/jwt';
import { errorResponse } from '@/lib/api/response';
import { getRefreshTokenFromCookie, clearRefreshTokenCookie } from '@/lib/auth/cookies';
import { eq, and, isNull } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    // Read refresh token from httpOnly cookie
    const refreshToken = await getRefreshTokenFromCookie();

    // If no token, still clear cookie and return success
    if (!refreshToken) {
      const response = NextResponse.json({
        success: true,
        data: { message: 'Logged out successfully' },
      });
      return clearRefreshTokenCookie(response);
    }

    // Verify the refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      // Invalid token, still clear cookie
      const response = NextResponse.json({
        success: true,
        data: { message: 'Logged out successfully' },
      });
      return clearRefreshTokenCookie(response);
    }

    // Find and revoke all tokens in this family
    const tokens = await db.query.refreshTokens.findMany({
      where: and(
        eq(refreshTokens.family, payload.family),
        isNull(refreshTokens.revokedAt)
      ),
    });

    // Revoke all tokens in the family
    if (tokens.length > 0) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.family, payload.family));
    }

    // Clear refresh token cookie
    const response = NextResponse.json({
      success: true,
      data: { message: 'Logged out successfully' },
    });
    return clearRefreshTokenCookie(response);
  } catch (error) {
    return errorResponse(error);
  }
}
