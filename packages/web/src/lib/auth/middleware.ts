import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type TokenPayload } from './jwt';
import { ApiError, UnauthorizedError, ForbiddenError } from '../api/errors';
import { errorResponse } from '../api/response';

export interface AuthenticatedRequest extends NextRequest {
  user: TokenPayload;
}

type RouteHandler<T = unknown> = (
  request: AuthenticatedRequest,
  context?: { params: Record<string, string> }
) => Promise<NextResponse<T>>;

export function withAuth<T = unknown>(handler: RouteHandler<T>): RouteHandler<T> {
  return async (request: NextRequest, context) => {
    const authHeader = request.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(new UnauthorizedError('Missing or invalid authorization header'));
    }

    const token = authHeader.substring(7);
    const payload = await verifyAccessToken(token);

    if (!payload) {
      return errorResponse(new UnauthorizedError('Invalid or expired token'));
    }

    (request as AuthenticatedRequest).user = payload;
    return handler(request as AuthenticatedRequest, context);
  };
}

export function withAdminAuth<T = unknown>(handler: RouteHandler<T>): RouteHandler<T> {
  return withAuth(async (request: AuthenticatedRequest, context) => {
    if (request.user.role !== 'admin') {
      return errorResponse(new ForbiddenError('Admin access required'));
    }
    return handler(request, context);
  });
}

export async function getAuthUser(request: NextRequest): Promise<TokenPayload | null> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  return verifyAccessToken(token);
}
