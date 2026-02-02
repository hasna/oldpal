import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { users, refreshTokens } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import {
  createAccessToken,
  createRefreshToken,
  getRefreshTokenExpiry,
} from '@/lib/auth/jwt';
import { successResponse, errorResponse } from '@/lib/api/response';
import { ConflictError } from '@/lib/api/errors';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(255),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = registerSchema.parse(body);

    // Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    });

    if (existingUser) {
      return errorResponse(new ConflictError('Email already registered'));
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);

    const [newUser] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: 'user',
      })
      .returning();

    // Create tokens
    const family = randomUUID();
    const accessToken = await createAccessToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    const refreshToken = await createRefreshToken({
      userId: newUser.id,
      family,
    });

    // Store refresh token hash
    const tokenHash = await hashPassword(refreshToken);
    await db.insert(refreshTokens).values({
      userId: newUser.id,
      tokenHash,
      family,
      expiresAt: getRefreshTokenExpiry(),
    });

    return successResponse(
      {
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          avatarUrl: newUser.avatarUrl,
        },
        accessToken,
        refreshToken,
      },
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
}
