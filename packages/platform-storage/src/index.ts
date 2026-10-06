import { LocalDiskStorage } from './local-disk';
import { S3CompatibleStorage } from './s3';
import type { ObjectStorage } from './types';

export * from './keys';
export * from './types';
export * from './hashing';
export { LocalDiskStorage } from './local-disk';
export { S3CompatibleStorage, type S3Config } from './s3';

/** Construye el almacenamiento desde el entorno (STORAGE_DRIVER=local|s3). */
export async function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ObjectStorage> {
  const driver = env.STORAGE_DRIVER ?? 'local';
  if (driver === 'local') {
    if (!env.LOCAL_STORAGE_ROOT) throw new Error('falta LOCAL_STORAGE_ROOT');
    return LocalDiskStorage.open(env.LOCAL_STORAGE_ROOT);
  }
  if (driver === 's3') {
    const req = (k: string): string => {
      const v = env[k];
      if (!v) throw new Error(`falta ${k}`);
      return v;
    };
    return new S3CompatibleStorage({
      endpoint: env.S3_ENDPOINT || undefined,
      region: req('S3_REGION'),
      bucket: req('S3_BUCKET'),
      accessKeyId: req('S3_ACCESS_KEY'),
      secretAccessKey: req('S3_SECRET_KEY'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    });
  }
  throw new Error(`STORAGE_DRIVER desconocido: ${driver}`);
}
