import type { ApiError, ErrorCode } from '@forge/shared';
import type { FastifyInstance } from 'fastify';

type ErrorDetails = ApiError['error']['details'];

/** An expected failure with a status and code the client may rely on. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function body(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorDetails,
): ApiError {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}

// Fixed client-facing text: framework error messages can echo request content.
function fromFramework(statusCode: number): { code: ErrorCode; message: string } {
  switch (statusCode) {
    case 404:
      return { code: 'not_found', message: 'Not found.' };
    case 413:
      return { code: 'payload_too_large', message: 'The request body is too large.' };
    case 415:
      return { code: 'validation_failed', message: 'Unsupported content type.' };
    case 429:
      return { code: 'rate_limited', message: 'Too many requests.' };
    default:
      return { code: 'validation_failed', message: 'The request could not be understood.' };
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, 'request rejected');
      return reply
        .status(error.statusCode)
        .send(body(error.code, error.message, request.id, error.details));
    }

    const statusCode = error.statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      const { code, message } = fromFramework(statusCode);
      request.log.info({ code, statusCode }, 'request rejected');
      return reply.status(statusCode).send(body(code, message, request.id));
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(body('internal_error', 'Something went wrong on our side.', request.id));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(body('not_found', 'Not found.', request.id)),
  );
}
