import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { BadRequestError } from '@/lib/api/errors';
import { generateApiKey, hashApiKey } from '@/lib/auth/api-key';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

// GET /api/v1/users/me/api-keys - List user's API keys
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;

    // Get all non-revoked API keys
    const keys = await db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt)
      ),
      orderBy: [desc(apiKeys.createdAt)],
    });

    // Don't return the hash, format response for display
    const formattedKeys = keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      permissions: key.permissions,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    }));

    return successResponse({
      keys: formattedKeys,
      count: formattedKeys.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/users/me/api-keys - Create a new API key
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const body = await request.json();
    const { name, expiresAt } = createApiKeySchema.parse(body);

    // Check if user has too many keys (limit to 10)
    const existingKeys = await db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt)
      ),
    });

    if (existingKeys.length >= 10) {
      throw new BadRequestError('Maximum of 10 API keys allowed. Please revoke an existing key first.');
    }

    // Generate a new API key
    const { fullKey, keyPrefix } = generateApiKey();
    const keyHash = await hashApiKey(fullKey);

    // Insert the new key
    const [newKey] = await db.insert(apiKeys).values({
      userId,
      name,
      keyPrefix,
      keyHash,
      permissions: [],
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    }).returning();

    // Return the full key ONCE - this is the only time it will be shown
    return successResponse({
      key: {
        id: newKey.id,
        name: newKey.name,
        keyPrefix: newKey.keyPrefix,
        fullKey, // Only returned on creation
        permissions: newKey.permissions,
        expiresAt: newKey.expiresAt,
        createdAt: newKey.createdAt,
      },
      message: 'API key created. Please copy it now - it will not be shown again.',
    });
  } catch (error) {
    return errorResponse(error);
  }
});
