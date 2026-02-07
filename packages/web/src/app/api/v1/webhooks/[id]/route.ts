import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError, BadRequestError } from '@/lib/api/errors';
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

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  eventsFilter: z.array(z.string().max(200)).max(50).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

// GET /api/v1/webhooks/[id] - Get webhook details
export const GET = withAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);
    await manager.initialize();

    const webhook = await manager.get(id);
    if (!webhook) {
      return errorResponse(new NotFoundError('Webhook not found'));
    }

    return successResponse({ webhook });
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/webhooks/[id] - Update webhook
export const PATCH = withAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateWebhookSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse(
        new BadRequestError(
          parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        )
      );
    }

    const manager = getManager(request.user.userId);
    await manager.initialize();

    const result = await manager.update({ id, ...parsed.data });
    if (!result.success) {
      return errorResponse(new NotFoundError(result.message));
    }

    return successResponse({ message: result.message, webhookId: result.webhookId });
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/webhooks/[id] - Delete webhook
export const DELETE = withAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);
    await manager.initialize();

    const result = await manager.delete(id);
    if (!result.success) {
      return errorResponse(new NotFoundError(result.message));
    }

    return successResponse({ message: result.message });
  } catch (error) {
    return errorResponse(error);
  }
});
