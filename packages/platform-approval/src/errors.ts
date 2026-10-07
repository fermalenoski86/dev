/**
 * Error de dominio de la aprobación. Lleva su status HTTP y un código estable;
 * el mensaje es público (no lleva SQL, paths ni datos internos). La API lo
 * traduce tal cual al contrato `{ code, message, details?, requestId }`.
 */
export type ApprovalErrorCode =
  | 'SHOW_VERSION_NOT_FOUND'
  | 'CONTRACT_NOT_FOUND'
  | 'EVIDENCE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'FOUR_EYES_VIOLATION'
  | 'INVALID_STATE_TRANSITION'
  | 'VERSION_HASH_MISMATCH'
  | 'EVIDENCE_REQUIRED'
  | 'REASON_REQUIRED'
  | 'EVIDENCE_EMPTY'
  | 'EVIDENCE_TOO_LARGE'
  | 'EVIDENCE_TYPE_MISMATCH'
  | 'EVIDENCE_UNSUPPORTED_CONTENT'
  | 'EVIDENCE_STORAGE_ERROR';

export class ApprovalError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: ApprovalErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Traduce los RAISE de los triggers (segunda barrera) al mismo error que da la
 * app cuando chequea primero. Devuelve null si no es uno de esos.
 */
export function fromDatabaseError(e: unknown): ApprovalError | null {
  const x = e as { code?: string; message?: string; constraint?: string };
  const msg = typeof x?.message === 'string' ? x.message : '';
  if (x?.code === 'P0001') {
    if (msg.startsWith('FOUR_EYES_VIOLATION')) return new ApprovalError(403, 'FOUR_EYES_VIOLATION', 'Quien envió la versión no puede aprobarla.');
    if (msg.startsWith('APPROVAL_HASH_MISMATCH')) return new ApprovalError(409, 'VERSION_HASH_MISMATCH', 'El hash no es el de la versión.');
    if (msg.startsWith('EVIDENCE_AFTER_DECISION')) return new ApprovalError(409, 'INVALID_STATE_TRANSITION', 'La versión ya tiene una decisión.');
    if (msg.startsWith('EVIDENCE_TYPE_MISMATCH')) return new ApprovalError(422, 'EVIDENCE_TYPE_MISMATCH', 'El contenido no corresponde al tipo de evidencia.');
  }
  // una decisión por versión (UNIQUE): la otra transacción ganó la carrera
  if (x?.code === '23505' && x.constraint === 'approvals_show_version_id_key') {
    return new ApprovalError(409, 'INVALID_STATE_TRANSITION', 'La versión ya tiene una decisión.');
  }
  if (x?.code === '23503' && x.constraint === 'approvals_evidence_same_version') {
    return new ApprovalError(422, 'EVIDENCE_NOT_FOUND', 'La evidencia no existe para esta versión.');
  }
  return null;
}
