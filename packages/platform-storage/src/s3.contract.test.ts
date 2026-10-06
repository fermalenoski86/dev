import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, it } from 'vitest';
import { objectStorageContract, sha } from './contract';
import { S3CompatibleStorage } from './s3';

/**
 * El MISMO contrato contra S3/MinIO, con los mismos ganchos adversariales.
 * Corre solo con S3_TEST_ENDPOINT (CI con docker-compose + MinIO).
 * NO se declara aprobado hasta ejecutarlo realmente ahí.
 */
const env = process.env;
const hayS3 = Boolean(env.S3_TEST_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);

if (hayS3) {
  objectStorageContract('S3CompatibleStorage (MinIO/S3 real)', async () => {
    const storage = new S3CompatibleStorage({
      endpoint: env.S3_TEST_ENDPOINT, region: env.S3_REGION ?? 'us-east-1', bucket: env.S3_BUCKET ?? '',
      accessKeyId: env.S3_ACCESS_KEY ?? '', secretAccessKey: env.S3_SECRET_KEY ?? '', forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    });
    const put = (Key: string, Body: Buffer | string) => storage.client.send(new PutObjectCommand({ Bucket: storage.cfg.bucket, Key, Body }));
    return {
      storage,
      async plantFinal(key, bytes) {
        await storage.client.send(new DeleteObjectsCommand({ Bucket: storage.cfg.bucket, Delete: { Objects: [{ Key: key }], Quiet: true } }));
        await put(key, bytes);
      },
      async plantPartialTemp(id, kind) {
        const p = `tmp/${id}/`;
        await put(`${p}reservation`, '');
        const meta = JSON.stringify({ tempId: id, sizeBytes: 3, sha256: sha('xyz'), createdAt: new Date().toISOString() });
        if (kind === 'data-without-meta') await put(`${p}data`, 'xyz');
        if (kind === 'meta-without-data') await put(`${p}meta.json`, meta);
        if (kind === 'corrupt-meta') { await put(`${p}data`, 'xyz'); await put(`${p}meta.json`, '{ no es json'); }
        // 'part-abandoned': solo la reserva (una subida multipart que nunca se completó)
      },
    };
  });
} else {
  describe('ObjectStorage contract — S3CompatibleStorage', () => {
    it.skip('requiere MinIO/S3 (S3_TEST_ENDPOINT): corre en CI con docker-compose; NO ejecutado en este entorno', () => {});
  });
}
