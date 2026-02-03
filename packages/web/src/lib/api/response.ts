import { NextResponse } from 'next/server';
import { ApiError, InternalServerError, ValidationError } from './errors';
import { ZodError } from 'zod';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    errors?: Record<string, string[]>;
  };
}

export function successResponse<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  );
}

export function errorResponse<T = unknown>(error: unknown): NextResponse<ApiResponse<T>> {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
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

  if (error instanceof ValidationError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          errors: error.errors,
        },
      },
      { status: error.statusCode }
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.statusCode }
    );
  }

  console.error('Unhandled error:', error);

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

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): NextResponse<ApiResponse<{ items: T[]; total: number; page: number; limit: number; totalPages: number }>> {
  return successResponse({
    items: data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
