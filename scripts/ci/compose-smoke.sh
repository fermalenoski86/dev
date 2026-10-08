#!/bin/bash
# E1 · §35 — smoke REAL de `docker compose up` (job compose-smoke de CI).
#
#   1. genera un .env descartable desde .env.example (contraseñas aleatorias;
#      nunca pisa un .env existente);
#   2. baja las imágenes e imprime su digest; exige que estén fijadas por digest;
#   3. levanta postgres + minio, corre bootstrap.sql con psql (el camino de
#      operaciones), crea el bucket y migra como trust_owner (`pnpm db:migrate`);
#   4. corre el contrato S3 (packages/platform-storage) contra ese MinIO;
#   5. levanta platform-api desde el compose y exige /ready = ready con
#      database, storage (S3 → MinIO) y media en ok.
#
# Requiere docker compose v2, aws CLI, node 22 y pnpm instalados en el host.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -e .env ]; then
  echo "compose-smoke: ya existe .env; este smoke genera uno descartable y no lo pisa." >&2
  exit 2
fi

OWNER_PW=$(openssl rand -hex 16)
APP_PW=$(openssl rand -hex 16)
S3_USER=CHANGE_ME        # = MINIO_ROOT_USER del compose (valores de ejemplo, sin secretos reales)
S3_PASS=CHANGE_ME_TOO    # = MINIO_ROOT_PASSWORD del compose
BUCKET=trust-assets

# .env.example sin comentarios en línea, con los valores del smoke
sed -E 's/[[:space:]]+#.*$//' .env.example | grep -E '^[A-Z]' \
  | grep -vE '^(DATABASE_URL|STORAGE_DRIVER|S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY|S3_BUCKET|LOCAL_STORAGE_ROOT|MEDIA_SCRATCH_DIR|TRUST_PG_[A-Z_]+|S3_TEST_ENDPOINT)=' > .env
cat >> .env <<EOF
DATABASE_URL=postgres://trust_app:${APP_PW}@postgres:5432/trust
STORAGE_DRIVER=s3
S3_ENDPOINT=http://minio:9000
S3_BUCKET=${BUCKET}
S3_ACCESS_KEY=${S3_USER}
S3_SECRET_KEY=${S3_PASS}
LOCAL_STORAGE_ROOT=/tmp/trust-storage
MEDIA_SCRATCH_DIR=/tmp/trust-media-scratch
EOF

limpiar() {
  set +e
  docker compose logs --no-color > compose-smoke.log 2>&1
  docker compose down -v --remove-orphans > /dev/null 2>&1
  rm -f .env
}
trap limpiar EXIT

echo "== imágenes"
docker compose pull -q postgres minio
SIN_DIGEST=0
DIGESTS=""
for svc in postgres minio; do
  img=$(docker compose config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).services[process.argv[1]].image))" "$svc")
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$img")
  echo "$svc: declarada=$img resuelta=$digest"
  DIGESTS="$DIGESTS
GATE imagen $svc: $digest"
  case "$img" in *@sha256:*) ;; *) echo "   ✗ $svc NO está fijada por digest"; SIN_DIGEST=1 ;; esac
done
docker compose run --rm --no-deps --entrypoint minio minio --version | head -1

echo "== postgres + minio"
docker compose up -d --wait postgres minio

echo "== bootstrap.sql (psql, dos veces: idempotente)"
for _ in 1 2; do
  docker compose exec -T postgres psql -U postgres -q -v ON_ERROR_STOP=1 \
    -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v db_name=trust < packages/platform-db/src/bootstrap.sql
done

echo "== bucket"
export AWS_ACCESS_KEY_ID=$S3_USER AWS_SECRET_ACCESS_KEY=$S3_PASS AWS_DEFAULT_REGION=us-east-1
for i in $(seq 1 30); do aws --endpoint-url http://127.0.0.1:9000 s3api list-buckets > /dev/null 2>&1 && break; sleep 1; done
aws --endpoint-url http://127.0.0.1:9000 s3 mb "s3://$BUCKET"

echo "== migraciones (trust_owner)"
TRUST_MIGRATION_DATABASE_URL="postgres://trust_owner:${OWNER_PW}@127.0.0.1:5433/trust" pnpm db:migrate

echo "== contrato S3 contra MinIO"
S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_BUCKET=$BUCKET S3_ACCESS_KEY=$S3_USER S3_SECRET_KEY=$S3_PASS S3_FORCE_PATH_STYLE=true \
  npx vitest run packages/platform-storage/src/s3.contract.test.ts

echo "== platform-api (compose)"
# el contenedor instala sus propias dependencias sobre el repo montado: sin los
# node_modules del host (otro store de pnpm) no hay purga interactiva
find . -name node_modules -type d -prune -exec rm -rf {} +
docker compose up -d platform-api
READY=""
for i in $(seq 1 120); do
  READY=$(curl -s http://127.0.0.1:4000/ready || true)
  case "$READY" in *'"status":"ready"'*) break ;; esac
  sleep 5
done
echo "/health: $(curl -s http://127.0.0.1:4000/health)"
echo "/ready:  $READY"
node -e '
const r = JSON.parse(process.argv[1] || "{}");
const ok = r.status === "ready" && r.checks && Object.values(r.checks).every((v) => v === "ok");
if (!ok) { console.error("✗ /ready no está ready con todo en ok"); process.exit(1); }
console.log("✓ /ready: database, storage (MinIO) y media ok");' "$READY"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"email":"nadie@ejemplo.com","password":"incorrecta-123"}' http://127.0.0.1:4000/api/v1/auth/login)
echo "login con usuario inexistente: HTTP $CODE (esperado 401: trust_app consulta la base)"
[ "$CODE" = 401 ]

echo "$DIGESTS"
if [ "$SIN_DIGEST" = 1 ]; then
  echo "✗ smoke OK pero hay imágenes sin digest: fijarlas en docker-compose.yml con los digests de arriba" >&2
  exit 1
fi
echo "✓ compose-smoke completo"
