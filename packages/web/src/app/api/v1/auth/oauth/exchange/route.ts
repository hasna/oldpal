import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { UnauthorizedError } from '@/lib/api/errors';

/**
 * POST /api/v1/auth/oauth/exchange
 *
 * Exchange OAuth cookies for tokens and user info.
 * This endpoint reads the temporary HTTP-only access token cookie set by the OAuth callback,
 * verifies it, and returns the access token + user info to the client.
 * The refresh token is already in the persistent httpOnly cookie (set by callback).
 * The temp access token cookie is cleared after exchange to prevent reuse.
 */
export async function POST(request: NextRequest) {
  try {
    // Read access token from temporary HTTP-only cookie
    const accessToken = request.cookies.get('oauth_access_token')?.value;

    if (!accessToken) {
      throw new UnauthorizedError('Missing OAuth access token');
    }

    // Verify access token
    const payload = await verifyAccessToken(accessToken);
    if (!payload) {
      throw new UnauthorizedError('Invalid access token');
    }

    // Fetch user info
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      columns: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Return user and access token (refresh token is in httpOnly cookie already)
    // Clear temp OAuth cookie after successful exchange
    const response = NextResponse.json({
      success: true,
      data: {
        user,
        accessToken,
        // refreshToken is not returned - it's in httpOnly cookie
      },
    });

    response.cookies.delete('oauth_access_token');

    return response;
  } catch (error) {
    // Clear cookies on error too to prevent repeated attempts
    const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
    const response = NextResponse.json(
      {
        success: false,
        error: { message: errorMessage },
      },
      { status: 401 }
    );
    response.cookies.delete('oauth_access_token');
    return response;
  }
}
