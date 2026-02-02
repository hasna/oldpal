import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { refreshTokens } from '@/db/schema';
import { verifyRefreshToken } from '@/lib/auth/jwt';
import { verifyPassword } from '@/lib/auth/password';
import { successResponse, errorResponse } from '@/lib/api/response';
import { UnauthorizedError } from '@/lib/api/errors';
import { eq, and, isNull } from 'drizzle-orm';

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = logoutSchema.parse(body);

    // Verify the refresh token
    const payload = await verifyRefreshToken(refreshToken);
    if (!payload) {
      return errorResponse(new UnauthorizedError('Invalid refresh token'));
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

    return successResponse({ message: 'Logged out successfully' });
  } catch (error) {
    return errorResponse(error);
  }
}
