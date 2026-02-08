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
  type OrderStatus,
} from '@hasna/assistants-core';

const DEFAULT_CONFIG: OrdersConfig = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxOrders: 5000, maxAgeDays: 365 },
};

function getManager(userId: string) {
  return createOrdersManager(userId, 'api-user', DEFAULT_CONFIG);
}

// GET /api/v1/orders - List orders
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') as OrderStatus | null;
    const store = searchParams.get('store');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const orders = manager.listOrders({
      status: status || undefined,
      store: store || undefined,
      limit,
    });

    manager.close();
    return successResponse({ orders });
  } catch (error) {
    return errorResponse(error);
  }
});

// POST /api/v1/orders - Create order
export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);
    const body = await request.json();

    const { store, description, order_number, total_amount, currency, shipping_address, payment_method, notes } = body;

    if (!store || typeof store !== 'string') {
      manager.close();
      return errorResponse(new Error('store is required'));
    }

    const result = manager.createOrder(store, {
      description,
      orderNumber: order_number,
      totalAmount: total_amount,
      currency,
      shippingAddress: shipping_address,
      paymentMethod: payment_method,
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
