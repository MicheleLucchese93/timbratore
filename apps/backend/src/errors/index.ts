export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;
  constructor(opts: { status: number; code: string; message: string; details?: unknown }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ status: 400, code: 'VALIDATION', message, details });
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super({ status: 401, code: 'UNAUTHORIZED', message });
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super({ status: 403, code, message });
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super({ status: 404, code: 'NOT_FOUND', message });
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super({ status: 409, code, message, details });
  }
}
export class ExternalServiceError extends AppError {
  constructor(message: string, code = 'EXTERNAL') {
    super({ status: 503, code, message });
  }
}
