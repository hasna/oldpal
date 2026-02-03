import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  successResponse,
  errorResponse,
  paginatedResponse,
} from '../src/lib/api/response';
import {
  ApiError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
} from '../src/lib/api/errors';

describe('successResponse', () => {
  test('returns success response with data', async () => {
    const response = successResponse({ id: '1', name: 'Test' });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({ id: '1', name: 'Test' });
  });

  test('accepts custom status code', async () => {
    const response = successResponse({ created: true }, 201);

    expect(response.status).toBe(201);
  });

  test('works with null data', async () => {
    const response = successResponse(null);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data).toBeNull();
  });

  test('works with array data', async () => {
    const response = successResponse([1, 2, 3]);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data).toEqual([1, 2, 3]);
  });

  test('works with string data', async () => {
    const response = successResponse('message');
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data).toBe('message');
  });
});

describe('errorResponse', () => {
  test('handles ApiError', async () => {
    const error = new NotFoundError('User not found');
    const response = errorResponse(error);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
    expect(data.error.message).toBe('User not found');
  });

  test('handles UnauthorizedError', async () => {
    const error = new UnauthorizedError('Invalid token');
    const response = errorResponse(error);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  test('handles ValidationError with field errors', async () => {
    const error = new ValidationError('Validation failed', {
      email: ['Invalid email'],
      password: ['Too short'],
    });
    const response = errorResponse(error);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.errors).toEqual({
      email: ['Invalid email'],
      password: ['Too short'],
    });
  });

  test('handles ZodError', async () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(18),
    });

    let zodError: z.ZodError | null = null;
    try {
      schema.parse({ email: 'invalid', age: 10 });
    } catch (e) {
      zodError = e as z.ZodError;
    }

    const response = errorResponse(zodError);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.errors).toBeDefined();
  });

  test('handles generic Error as InternalServerError', async () => {
    const error = new Error('Something went wrong');
    const response = errorResponse(error);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  test('handles unknown error types', async () => {
    const response = errorResponse('string error');
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  test('handles null error', async () => {
    const response = errorResponse(null);
    const data = await response.json();

    expect(response.status).toBe(500);
  });
});

describe('paginatedResponse', () => {
  test('returns paginated response with metadata', async () => {
    const items = [{ id: '1' }, { id: '2' }];
    const response = paginatedResponse(items, 100, 1, 10);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.items).toEqual(items);
    expect(data.data.total).toBe(100);
    expect(data.data.page).toBe(1);
    expect(data.data.limit).toBe(10);
    expect(data.data.totalPages).toBe(10);
  });

  test('calculates totalPages correctly', async () => {
    const response = paginatedResponse([], 25, 1, 10);
    const data = await response.json();

    expect(data.data.totalPages).toBe(3);
  });

  test('handles zero total', async () => {
    const response = paginatedResponse([], 0, 1, 10);
    const data = await response.json();

    expect(data.data.items).toEqual([]);
    expect(data.data.total).toBe(0);
    expect(data.data.totalPages).toBe(0);
  });

  test('handles exact page boundary', async () => {
    const response = paginatedResponse([], 20, 2, 10);
    const data = await response.json();

    expect(data.data.totalPages).toBe(2);
  });
});
