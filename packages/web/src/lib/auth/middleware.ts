import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type TokenPayload } from './jwt';
import { ApiError, UnauthorizedError, ForbiddenError } from '../api/errors';
import { errorResponse, type ApiResponse } from '../api/response';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends NextRequest {
  user: TokenPayload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params?: any };

type AuthedHandler<T = unknown, C = RouteContext> = (
  request: AuthenticatedRequest,
  context: C
) => Promise<NextResponse<ApiResponse<T>>>;

type RouteHandler<T = unknown, C = RouteContext> = (
  request: NextRequest,
  context: C
) => Promise<NextResponse<ApiResponse<T>>>;

// Simple in-memory cache for user status to minimize DB hits
// Cache entries expire after 30 seconds
interface UserStatusCache {
  isActive: boolean;
  role: 'user' | 'admin';
  timestamp: number;
}

const userStatusCache = new Map<string, UserStatusCache>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Get user status from cache or database
 * Returns null if user doesn't exist
 */
async function getUserStatus(userId: string): Promise<{ isActive: boolean; role: 'user' | 'admin' } | null> {
  const now = Date.now();
  const cached = userStatusCache.get(userId);

  // Return cached value if still valid
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { isActive: cached.isActive, role: cached.role };
  }

  // Fetch from database
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { isActive: true, role: true },
    });

    if (!user) {
      // Remove from cache if user doesn't exist
      userStatusCache.delete(userId);
      return null;
    }

    // Update cache
    userStatusCache.set(userId, {
      isActive: user.isActive,
      role: user.role,
      timestamp: now,
    });

    return { isActive: user.isActive, role: user.role };
  } catch {
    // On DB error, trust the JWT payload (fail open for availability)
    // but log for monitoring
    console.error(`[Auth] Failed to verify user status for ${userId}`);
    return null;
  }
}

/**
 * Clear the user status cache for a specific user
 * Call this when user status changes (suspend, role change)
 */
export function invalidateUserStatusCache(userId: string): void {
  userStatusCache.delete(userId);
}

/**
 * Clear all user status cache entries
 */
export function clearUserStatusCache(): void {
  userStatusCache.clear();
}

export function withAuth<T = unknown, C = RouteContext>(handler: AuthedHandler<T, C>): RouteHandler<T, C> {
  return async (request: NextRequest, context: C) => {
    const authHeader = request.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(new UnauthorizedError('Missing or invalid authorization header'));
    }

    const token = authHeader.substring(7);
    const payload = await verifyAccessToken(token);

    if (!payload) {
      return errorResponse(new UnauthorizedError('Invalid or expired token'));
    }

    // Verify user status from database
    const userStatus = await getUserStatus(payload.userId);

    // Check if user still exists
    if (!userStatus) {
      return errorResponse(new UnauthorizedError('User account not found'));
    }

    // Check if user is suspended
    if (!userStatus.isActive) {
      return errorResponse(new ForbiddenError('Your account has been suspended'));
    }

    // Update the payload with current role from database
    // This catches role changes (demotions) that happened after token was issued
    const updatedPayload: TokenPayload = {
      ...payload,
      role: userStatus.role,
    };

    (request as AuthenticatedRequest).user = updatedPayload;
    return handler(request as AuthenticatedRequest, context);
  };
}

export function withAdminAuth<T = unknown, C = RouteContext>(handler: AuthedHandler<T, C>): RouteHandler<T, C> {
  return withAuth<T, C>(async (request: AuthenticatedRequest, context: C) => {
    // The role has already been verified from DB in withAuth
    // So this check uses the current DB role, not the stale JWT role
    if (request.user.role !== 'admin') {
      return errorResponse(new ForbiddenError('Admin access required'));
    }
    return handler(request, context);
  });
}

export async function getAuthUser(request: NextRequest): Promise<TokenPayload | null> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const payload = await verifyAccessToken(token);

  if (!payload) {
    return null;
  }

  // For read-only operations, we can optionally verify user status
  // but return null on any issue
  const userStatus = await getUserStatus(payload.userId);

  if (!userStatus || !userStatus.isActive) {
    return null;
  }

  // Return with current role
  return {
    ...payload,
    role: userStatus.role,
  };
}
