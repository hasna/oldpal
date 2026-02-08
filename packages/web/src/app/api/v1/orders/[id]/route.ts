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

// GET /api/v1/orders/[id] - Get order with items
export const GET = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);

    const result = manager.getOrder(id);

    manager.close();

    if (!result) {
      return errorResponse(new Error('Order not found'));
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});

// PATCH /api/v1/orders/[id] - Update order
export const PATCH = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.order_number !== undefined) updates.orderNumber = body.order_number;
    if (body.description !== undefined) updates.description = body.description;
    if (body.total_amount !== undefined) updates.totalAmount = body.total_amount;
    if (body.currency !== undefined) updates.currency = body.currency;
    if (body.shipping_address !== undefined) updates.shippingAddress = body.shipping_address;
    if (body.payment_method !== undefined) updates.paymentMethod = body.payment_method;
    if (body.tracking_number !== undefined) updates.trackingNumber = body.tracking_number;
    if (body.tracking_url !== undefined) updates.trackingUrl = body.tracking_url;
    if (body.notes !== undefined) updates.notes = body.notes;

    const result = manager.updateOrder(id, updates);

    manager.close();

    if (!result.success) {
      return errorResponse(new Error(result.message));
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});

// DELETE /api/v1/orders/[id] - Cancel order
export const DELETE = withAuth(async (request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const { id } = await params;
    const manager = getManager(request.user.userId);

    const result = manager.cancelOrder(id);

    manager.close();

    if (!result.success) {
      return errorResponse(new Error(result.message));
    }

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});
