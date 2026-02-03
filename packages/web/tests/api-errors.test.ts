import { describe, expect, test } from 'bun:test';
import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError,
} from '../src/lib/api/errors';

describe('ApiError', () => {
  test('creates error with statusCode, code, and message', () => {
    const error = new ApiError(418, 'TEAPOT', "I'm a teapot");

    expect(error.statusCode).toBe(418);
    expect(error.code).toBe('TEAPOT');
    expect(error.message).toBe("I'm a teapot");
    expect(error.name).toBe('ApiError');
  });

  test('extends Error', () => {
    const error = new ApiError(500, 'TEST', 'Test error');
    expect(error instanceof Error).toBe(true);
  });
});

describe('BadRequestError', () => {
  test('has 400 status code and BAD_REQUEST code', () => {
    const error = new BadRequestError();

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('Bad request');
  });

  test('accepts custom message', () => {
    const error = new BadRequestError('Invalid input format');
    expect(error.message).toBe('Invalid input format');
  });

  test('extends ApiError', () => {
    const error = new BadRequestError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('UnauthorizedError', () => {
  test('has 401 status code and UNAUTHORIZED code', () => {
    const error = new UnauthorizedError();

    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toBe('Unauthorized');
  });

  test('accepts custom message', () => {
    const error = new UnauthorizedError('Invalid credentials');
    expect(error.message).toBe('Invalid credentials');
  });

  test('extends ApiError', () => {
    const error = new UnauthorizedError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('ForbiddenError', () => {
  test('has 403 status code and FORBIDDEN code', () => {
    const error = new ForbiddenError();

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toBe('Forbidden');
  });

  test('accepts custom message', () => {
    const error = new ForbiddenError('Access denied');
    expect(error.message).toBe('Access denied');
  });

  test('extends ApiError', () => {
    const error = new ForbiddenError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('NotFoundError', () => {
  test('has 404 status code and NOT_FOUND code', () => {
    const error = new NotFoundError();

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Not found');
  });

  test('accepts custom message', () => {
    const error = new NotFoundError('User not found');
    expect(error.message).toBe('User not found');
  });

  test('extends ApiError', () => {
    const error = new NotFoundError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('ConflictError', () => {
  test('has 409 status code and CONFLICT code', () => {
    const error = new ConflictError();

    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('Conflict');
  });

  test('accepts custom message', () => {
    const error = new ConflictError('Email already registered');
    expect(error.message).toBe('Email already registered');
  });

  test('extends ApiError', () => {
    const error = new ConflictError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('ValidationError', () => {
  test('has 422 status code and VALIDATION_ERROR code', () => {
    const error = new ValidationError();

    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Validation failed');
  });

  test('accepts custom message', () => {
    const error = new ValidationError('Invalid email format');
    expect(error.message).toBe('Invalid email format');
  });

  test('accepts field errors', () => {
    const error = new ValidationError('Validation failed', {
      email: ['Invalid email format'],
      password: ['Password too short', 'Password needs uppercase'],
    });

    expect(error.errors).toBeDefined();
    expect(error.errors!.email).toEqual(['Invalid email format']);
    expect(error.errors!.password).toEqual(['Password too short', 'Password needs uppercase']);
  });

  test('extends ApiError', () => {
    const error = new ValidationError();
    expect(error instanceof ApiError).toBe(true);
  });
});

describe('InternalServerError', () => {
  test('has 500 status code and INTERNAL_SERVER_ERROR code', () => {
    const error = new InternalServerError();

    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('Internal server error');
  });

  test('accepts custom message', () => {
    const error = new InternalServerError('Database connection failed');
    expect(error.message).toBe('Database connection failed');
  });

  test('extends ApiError', () => {
    const error = new InternalServerError();
    expect(error instanceof ApiError).toBe(true);
  });
});
