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

// GET /api/v1/stores - List stores
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);

    const stores = manager.listStores();

    manager.close();
    return successResponse({ stores });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/stores - Add store
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);
    const body = await request.json();

    const { name, url, category, notes } = body;

    if (!name || typeof name !== 'string') {
      manager.close();
      return errorResponse(new Error('name is required'));
    }

    const result = manager.addStore(name, {
      url,
      category,
      notes,
    });

    manager.close();

    if (!result.success) {
      return errorResponse(new Error(result.message));
    }

    return successResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
