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

// POST /api/v1/orders/[id]/items - Add item to order
export const POST = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);
    const body = await request.json();

    const { name, description, quantity, unit_price, sku, url } = body;

    if (!name || typeof name !== 'string') {
      manager.close();
      return errorResponse(new Error('name is required'));
    }

    const result = manager.addItem(id, name, {
      description,
      quantity,
      unitPrice: unit_price,
      sku,
      url,
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
