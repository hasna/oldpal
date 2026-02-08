import { NextRequest } from 'next/server';
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { nodeRuntime } from '@hasna/runtime-node';

if (!hasRuntime()) {
  setRuntime(nodeRuntime);
}

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import {
  createTelephonyManager,
  type TelephonyConfig,
} from '@hasna/assistants-core';

const DEFAULT_CONFIG: TelephonyConfig = {
  enabled: true,
  injection: { enabled: true, maxPerTurn: 5 },
  storage: { maxCallLogs: 5000, maxSmsLogs: 5000, maxAgeDays: 90 },
};

function getManager(userId: string) {
  return createTelephonyManager(userId, 'api-user', DEFAULT_CONFIG);
}

// GET /api/v1/telephony - Get telephony status
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const manager = getManager(request.user.userId);
    const status = manager.getStatus();
    return successResponse({ status });
  } catch (error) {
    return errorResponse(error);
  }
});
