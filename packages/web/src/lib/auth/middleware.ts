import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, type TokenPayload } from './jwt';
import { ApiError, UnauthorizedError, ForbiddenError } from '../api/errors';
import { errorResponse, type ApiResponse } from '../api/response';

export interface AuthenticatedRequest extends NextRequest {
  user: TokenPayload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params?: any };

type AuthedHandler<T = unknown, C = RouteContext> = (
  request: AuthenticatedRequest,
  context: C
) => Promise<NextResponse<ApiResponse<T>>>;

type RouteHandler<T = unknown, C = RouteContext> = (
  request: NextRequest,
  context: C
) => Promise<NextResponse<ApiResponse<T>>>;

export function withAuth<T = unknown, C = RouteContext>(handler: AuthedHandler<T, C>): RouteHandler<T, C> {
  return async (request: NextRequest, context: C) => {
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

export function withAdminAuth<T = unknown, C = RouteContext>(handler: AuthedHandler<T, C>): RouteHandler<T, C> {
  return withAuth<T, C>(async (request: AuthenticatedRequest, context: C) => {
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
