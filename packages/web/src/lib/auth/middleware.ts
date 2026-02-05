import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type TokenPayload } from './jwt';
import { isValidApiKeyFormat, verifyApiKey, checkRateLimit, clearRateLimit, generateKeyLookupHash, isApiKeyAuthEnabled } from './api-key';
import { ApiError, UnauthorizedError, ForbiddenError, TooManyRequestsError } from '../api/errors';
import { errorResponse, type ApiResponse } from '../api/response';
import { db } from '@/db';
import { users, apiKeys } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';

export interface AuthenticatedRequest extends NextRequest {
  user: TokenPayload;
  /** API key permissions (only set when authenticated via API key) */
  apiKeyPermissions?: string[];
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

interface ApiKeyAuthResult {
  payload: TokenPayload;
  permissions: string[];
}

/**
 * Extract client IP from request headers
 * Handles common proxy headers
 */
function getClientIP(request: NextRequest): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (client IP)
    return forwardedFor.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback to a generic identifier
  return 'unknown';
}

/**
 * Authenticate using API key (sk_live_... format)
 * Returns user payload and permissions if valid, null otherwise
 * Includes rate limiting by IP and key prefix to prevent brute force attacks
 *
 * NOTE: In production, API key auth is disabled if API_KEY_HMAC_SECRET is not configured
 */
async function authenticateWithApiKey(apiKeyValue: string, clientIP: string): Promise<ApiKeyAuthResult | null> {
  // Check if API key auth is enabled (disabled in production without HMAC secret)
  if (!isApiKeyAuthEnabled()) {
    console.warn('[Auth] API key authentication is disabled in production - API_KEY_HMAC_SECRET not configured');
    return null;
  }

  if (!isValidApiKeyFormat(apiKeyValue)) {
    return null;
  }

  // Extract prefix for rate limiting and lookup
  const keyPrefix = apiKeyValue.substring(0, 12);

  // Rate limit by IP
  if (!checkRateLimit(`ip:${clientIP}`)) {
    return null; // Rate limited - return same response as invalid key
  }

  // Rate limit by key prefix to prevent prefix enumeration
  if (!checkRateLimit(`prefix:${keyPrefix}`)) {
    return null;
  }

  try {
    // Find potential matching keys by prefix
    const potentialKeys = await db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.keyPrefix, keyPrefix),
        isNull(apiKeys.revokedAt)
      ),
    });

    // Even if no keys found, we still do some work to maintain consistent timing
    if (potentialKeys.length === 0) {
      // Do a dummy verification to maintain timing consistency
      await verifyApiKey(apiKeyValue, '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummyhashvalue');
      return null;
    }

    // Verify the full key against each potential match
    // Note: We intentionally continue checking all keys even after finding a match
    // to prevent timing attacks that could reveal which key index matched
    let validKey: typeof potentialKeys[0] | null = null;
    let validUser: { id: string; email: string; role: 'user' | 'admin'; isActive: boolean } | null = null;

    for (const key of potentialKeys) {
      // Skip expired keys but still do the verification work
      const isExpired = key.expiresAt && key.expiresAt < new Date();

      const isValid = await verifyApiKey(apiKeyValue, key.keyHash);

      if (isValid && !isExpired && !validKey) {
        validKey = key;
        // Get user details only for valid key
        const user = await db.query.users.findFirst({
          where: eq(users.id, key.userId),
          columns: { id: true, email: true, role: true, isActive: true },
        });
        if (user && user.isActive) {
          validUser = user;
        }
      }
    }

    if (!validKey || !validUser) {
      return null;
    }

    // Clear rate limit on successful authentication
    clearRateLimit(`ip:${clientIP}`);
    clearRateLimit(`prefix:${keyPrefix}`);

    // Update last used timestamp only for active users
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, validKey.id));

    // Return payload with permissions
    return {
      payload: {
        userId: validUser.id,
        email: validUser.email,
        role: validUser.role,
        type: 'access',
      },
      permissions: validKey.permissions || [],
    };
  } catch (error) {
    console.error('[Auth] API key authentication error:', error);
    return null;
  }
}

/**
 * Wrapper that supports both JWT tokens and API keys
 * API keys start with 'sk_live_', JWTs are standard Bearer tokens
 */
export function withApiKeyAuth<T = unknown, C = RouteContext>(handler: AuthedHandler<T, C>): RouteHandler<T, C> {
  return async (request: NextRequest, context: C) => {
    const authHeader = request.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(new UnauthorizedError('Missing or invalid authorization header'));
    }

    const token = authHeader.substring(7);

    // Check if it's an API key
    if (isValidApiKeyFormat(token)) {
      const clientIP = getClientIP(request);
      const result = await authenticateWithApiKey(token, clientIP);
      if (!result) {
        return errorResponse(new UnauthorizedError('Invalid or expired API key'));
      }
      const authedRequest = request as AuthenticatedRequest;
      authedRequest.user = result.payload;
      authedRequest.apiKeyPermissions = result.permissions;
      return handler(authedRequest, context);
    }

    // Fall back to JWT authentication
    const payload = await verifyAccessToken(token);

    if (!payload) {
      return errorResponse(new UnauthorizedError('Invalid or expired token'));
    }

    // Verify user status from database
    const userStatus = await getUserStatus(payload.userId);

    if (!userStatus) {
      return errorResponse(new UnauthorizedError('User account not found'));
    }

    if (!userStatus.isActive) {
      return errorResponse(new ForbiddenError('Your account has been suspended'));
    }

    const updatedPayload: TokenPayload = {
      ...payload,
      role: userStatus.role,
    };

    (request as AuthenticatedRequest).user = updatedPayload;
    return handler(request as AuthenticatedRequest, context);
  };
}

/**
 * Available API key permission scopes
 */
export type ApiKeyScope =
  | 'read:agents'
  | 'write:agents'
  | 'read:sessions'
  | 'write:sessions'
  | 'read:tools'
  | 'read:skills'
  | 'read:messages'
  | 'write:messages'
  | 'read:schedules'
  | 'write:schedules'
  | 'admin';

/**
 * Wrapper that requires specific API key scopes
 * For JWT tokens, all scopes are implicitly granted
 * For API keys, the required scopes must be present
 */
export function withScopedApiKeyAuth<T = unknown, C = RouteContext>(
  requiredScopes: ApiKeyScope[],
  handler: AuthedHandler<T, C>
): RouteHandler<T, C> {
  return withApiKeyAuth<T, C>(async (request: AuthenticatedRequest, context: C) => {
    // JWT tokens have all permissions
    if (!request.apiKeyPermissions) {
      return handler(request, context);
    }

    // Check if API key has required scopes
    const permissions = request.apiKeyPermissions;

    // Admin permission grants all scopes
    if (permissions.includes('admin')) {
      return handler(request, context);
    }

    // Check each required scope
    const missingScopes = requiredScopes.filter(scope => !permissions.includes(scope));
    if (missingScopes.length > 0) {
      return errorResponse(
        new ForbiddenError(`API key missing required scopes: ${missingScopes.join(', ')}`)
      );
    }

    return handler(request, context);
  });
}
