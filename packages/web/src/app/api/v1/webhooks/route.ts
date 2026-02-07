import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { BadRequestError } from '@/lib/api/errors';
import {
  createWebhooksManager,
  type WebhooksConfig,
} from '@hasna/assistants-core';

const DEFAULT_CONFIG: WebhooksConfig = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxEvents: 1000, maxAgeDays: 30 },
  security: { maxTimestampAgeMs: 300_000, rateLimitPerMinute: 60 },
};

function getManager(userId: string) {
  return createWebhooksManager(userId, DEFAULT_CONFIG);
}

const createWebhookSchema = z.object({
  name: z.string().min(1).max(200),
  source: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  eventsFilter: z.array(z.string().max(200)).max(50).optional(),
});

// GET /api/v1/webhooks - List webhooks
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);
    await manager.initialize();
    const webhooks = await manager.list();

    return successResponse({ webhooks });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/webhooks - Create webhook
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const body = await request.json();
    const parsed = createWebhookSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse(
        new BadRequestError(
          parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        )
      );
    }

    const manager = getManager(request.user.userId);
    await manager.initialize();

    const result = await manager.create(parsed.data);

    if (!result.success) {
      return errorResponse(new BadRequestError(result.message));
    }

    return successResponse(
      {
        webhookId: result.webhookId,
        url: result.url,
        secret: result.secret,
        message: result.message,
      },
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
});
