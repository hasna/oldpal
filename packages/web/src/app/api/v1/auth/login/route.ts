import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { users, refreshTokens } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiry,
} from '@/lib/auth/jwt';
import { errorResponse } from '@/lib/api/response';
import { UnauthorizedError } from '@/lib/api/errors';
import { setRefreshTokenCookie } from '@/lib/auth/cookies';
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  // Rate limit: 10 login attempts per 15 minutes per IP
  const rateLimitResponse = checkRateLimit(request, 'auth/login', RateLimitPresets.login);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // Find user
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    });

    if (!user || !user.passwordHash) {
      return errorResponse(new UnauthorizedError('Invalid email or password'));
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return errorResponse(new UnauthorizedError('Invalid email or password'));
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

    // Store refresh token hash
    const tokenHash = await hashPassword(refreshToken);
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      family,
      expiresAt: getRefreshTokenExpiry(),
    });

    // Set refresh token as httpOnly cookie (not accessible via JavaScript)
    // Access token is returned in body for in-memory storage only
    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatarUrl: user.avatarUrl,
        },
        accessToken,
      },
    });

    return setRefreshTokenCookie(response, refreshToken);
  } catch (error) {
    return errorResponse(error);
  }
}
