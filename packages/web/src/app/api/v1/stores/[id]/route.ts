import { NextRequest } from 'next/server';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import {
  createOrdersManager,
  type OrdersConfig,
} from '@hasna/assistants-core';

const DEFAULT_CONFIG: OrdersConfig = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxOrders: 5000, maxAgeDays: 365 },
};

function getManager(userId: string) {
  return createOrdersManager(userId, 'api-user', DEFAULT_CONFIG);
}

// GET /api/v1/stores/[id] - Get store with orders
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);

    const result = manager.getStoreDetails(id);

    manager.close();

    if (!result) {
      return errorResponse(new Error('Store not found'));
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/stores/[id] - Update store
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.url !== undefined) updates.url = body.url;
    if (body.category !== undefined) updates.category = body.category;
    if (body.notes !== undefined) updates.notes = body.notes;

    const result = manager.updateStore(id, updates);

    manager.close();

    if (!result.success) {
      return errorResponse(new Error(result.message));
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});
