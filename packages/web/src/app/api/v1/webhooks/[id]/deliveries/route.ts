import { NextRequest } from 'next/server';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { NotFoundError } from '@/lib/api/errors';
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

// GET /api/v1/webhooks/[id]/deliveries - List delivery history
export const GET = withAuth(async (
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(1, Number.parseInt(searchParams.get('limit') || '50', 10) || 50),
      200
    );

    const manager = getManager(request.user.userId);
    await manager.initialize();

    // Verify webhook exists
    const webhook = await manager.get(id);
    if (!webhook) {
      return errorResponse(new NotFoundError('Webhook not found'));
    }

    const deliveries = await manager.listDeliveries(id, { limit });

    return successResponse({ deliveries, total: deliveries.length });
  } catch (error) {
    return errorResponse(error);
  }
});
