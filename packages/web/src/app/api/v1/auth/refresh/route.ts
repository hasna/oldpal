import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { users, refreshTokens } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '@/lib/auth/jwt';
import { successResponse, errorResponse } from '@/lib/api/response';
import { UnauthorizedError } from '@/lib/api/errors';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = refreshSchema.parse(body);

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

    return successResponse({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
