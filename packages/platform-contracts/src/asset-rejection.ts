import { z } from 'zod';

/**
 * Códigos de rechazo de Asset — M3A.1 Fase B (lista general) y B2.
 * Un rechazo SIEMPRE lleva código; nunca solo texto libre.
 */
export const AssetRejectionCodeSchema = z.enum([
  'ASSET_TOO_LARGE',
  'ASSET_EMPTY',
  'ASSET_BAD_CONTAINER',
  'ASSET_BAD_CODEC',
  'ASSET_BAD_RESOLUTION',
  'ASSET_BAD_FPS',
  'ASSET_TOO_SHORT',
  'ASSET_NO_VIDEO',
  'ASSET_MULTIPLE_VIDEO_STREAMS',
  'ASSET_CORRUPT',
  'ASSET_INSPECTION_TIMEOUT',
  'ASSET_STORAGE_ERROR',
]);
export type AssetRejectionCode = z.infer<typeof AssetRejectionCodeSchema>;

/** Lo que ve el cliente: código, mensaje y detalle estructurado. Sin stderr, sin paths. */
export const AssetRejectionSchema = z.object({
  code: AssetRejectionCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AssetRejection = z.infer<typeof AssetRejectionSchema>;
