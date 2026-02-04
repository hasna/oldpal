import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';
import { getUsageOverview } from '@/lib/usage';

// GET /api/v1/usage - Get current usage overview
export const GET = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const userId = request.user.userId;
    const overview = await getUsageOverview(userId);

    return successResponse({
      usage: overview,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
