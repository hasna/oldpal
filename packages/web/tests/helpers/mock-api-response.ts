import { NextResponse } from 'next/server';
import {
  successResponse,
  paginatedResponse,
} from '../../src/lib/api/response';
import { ApiError, InternalServerError, ValidationError } from '../../src/lib/api/errors';
import { ZodError } from 'zod';

type ApiResponseMockOverrides = Record<string, unknown>;

export function createErrorResponseMock(error: unknown) {
  if (error instanceof ZodError || (error as { name?: string } | null)?.name === 'ZodError') {
    const issues = (error as ZodError | null)?.issues ?? [];
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) {
      const path = issue.path.join('.');
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: fieldErrors,
        },
      },
      { status: 422 }
    );
  }

  if (error instanceof ValidationError || (error as { name?: string } | null)?.name === 'ValidationError') {
    const err = error as ValidationError & { errors?: Record<string, string[]>; statusCode?: number; code?: string };
    return NextResponse.json(
      {
        success: false,
        error: {
          code: err.code ?? 'VALIDATION_ERROR',
          message: err.message,
          errors: err.errors,
        },
      },
      { status: err.statusCode ?? 422 }
    );
  }

  if (error instanceof ApiError || (error as { code?: string; statusCode?: number } | null)?.code) {
    const err = error as ApiError & { code?: string; statusCode?: number };
    return NextResponse.json(
      {
        success: false,
        error: {
          code: err.code ?? 'INTERNAL_SERVER_ERROR',
          message: err.message,
        },
      },
      { status: err.statusCode ?? 500 }
    );
  }

  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotFoundError') {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: (error as Error).message } },
      { status: 404 }
    );
  }
  if (name === 'BadRequestError') {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: (error as Error).message } },
      { status: 400 }
    );
  }
  if (name === 'UnauthorizedError') {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: (error as Error).message } },
      { status: 401 }
    );
  }
  if (name === 'ForbiddenError') {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: (error as Error).message } },
      { status: 403 }
    );
  }

  const internalError = new InternalServerError();
  return NextResponse.json(
    {
      success: false,
      error: {
        code: internalError.code,
        message: internalError.message,
      },
    },
    { status: internalError.statusCode }
  );
}

export function createApiResponseMock(overrides: ApiResponseMockOverrides = {}) {
  return {
    successResponse,
    errorResponse: createErrorResponseMock,
    paginatedResponse,
    ...overrides,
  };
}
