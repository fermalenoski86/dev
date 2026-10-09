import { PlatformApiError } from '../lib/api';

/** Errores de la API anunciados a lectores de pantalla (BL-28: role="alert"). */
export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="error">
      {message}
    </p>
  );
}

/** Mensaje del servidor tal cual (la regla vive allá); nunca stack ni detalles internos. */
export function describeError(e: unknown): string {
  if (e instanceof PlatformApiError) return e.requestId ? `${e.message} (${e.code} · ${e.requestId})` : `${e.message} (${e.code})`;
  return 'Error inesperado.';
}
