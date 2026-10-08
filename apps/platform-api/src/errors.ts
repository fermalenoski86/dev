import { ApprovalError } from '@trust/platform-approval';
import { CampaignError } from '@trust/platform-campaigns';
import { IdempotencyKeyReusedError } from '@trust/platform-db';
import { InvalidSurfaceTypeError } from '@trust/platform-media';
import { ZodError } from 'zod';

/**
 * Contrato de error — M3A.1 Fase B §22:  { code, message, details?, requestId }.
 *
 * Nunca sale al cliente: stack, SQL, paths internos, stderr ni secretos. Lo
 * que no se reconoce es 500 INTERNAL_ERROR con un mensaje fijo; el detalle
 * queda solo en el log del servidor, atado al requestId.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}

const zodDetails = (e: ZodError) => ({
  issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
});

/** Traduce cualquier error a (status, cuerpo público). */
export function toErrorResponse(err: unknown, requestId: string): { status: number; body: ErrorBody } {
  const body = (status: number, code: string, message: string, details?: Record<string, unknown>) => ({
    status,
    body: { code, message, ...(details ? { details } : {}), requestId },
  });
  if (err instanceof ApiError) return body(err.statusCode, err.code, err.message, err.details);
  if (err instanceof ApprovalError) return body(err.httpStatus, err.code, err.message, err.details);
  if (err instanceof CampaignError) return body(err.httpStatus, err.code, err.message, err.details);
  if (err instanceof ZodError) return body(400, 'VALIDATION_ERROR', 'La solicitud no es válida.', zodDetails(err));
  if (err instanceof IdempotencyKeyReusedError) return body(409, err.code, 'La Idempotency-Key ya se usó con otra solicitud.');
  if (err instanceof InvalidSurfaceTypeError) return body(400, err.code, 'surfaceType no existe en las capacidades del edificio.');
  const fe = err as { code?: unknown; statusCode?: unknown };
  // Errores propios de Fastify/multipart con status 4xx: código y mensaje fijos, sin texto interno.
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    if (fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || fe.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      return body(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo tiene que ser multipart/form-data.');
    }
    if (fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || fe.statusCode === 413) {
      return body(413, 'PAYLOAD_TOO_LARGE', 'La solicitud supera el tamaño permitido.');
    }
    return body(fe.statusCode, 'BAD_REQUEST', 'La solicitud no es válida.');
  }
  return body(500, 'INTERNAL_ERROR', 'Error interno.');
}
