export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request') {
    super(400, 'BAD_REQUEST', message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class ValidationError extends ApiError {
  constructor(
    message = 'Validation failed',
    public errors?: Record<string, string[]>
  ) {
    super(422, 'VALIDATION_ERROR', message);
  }
}

export class InternalServerError extends ApiError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_SERVER_ERROR', message);
  }
}

/**
 * UUID regex pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

/**
 * Validate that a parameter is a valid UUID, throw BadRequestError if not
 */
export function validateUUID(id: string, paramName = 'id'): void {
  if (!isValidUUID(id)) {
    throw new BadRequestError(`Invalid ${paramName}: must be a valid UUID`);
  }
}
