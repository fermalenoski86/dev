#!/bin/bash
# E1 · §35 — smoke REAL de `docker compose up` (job compose-smoke de CI).
#
#   1. genera un .env descartable desde .env.example (contraseñas aleatorias;
#      nunca pisa un .env existente);
#   2. baja TODAS las imágenes del compose (incluido el perfil s3), imprime su
#      digest y falla si alguna no está fijada por digest;
#   3. S3 de dev/CI (SeaweedFS, #22): lo levanta, crea el bucket y corre el
#      contrato S3 completo (packages/platform-storage/src/s3.contract.test.ts);
#   4. postgres: bootstrap.sql con psql (dos veces: idempotente) y
#      `pnpm db:migrate` como trust_owner (dos veces: la segunda no aplica nada);
#   5. platform-api desde el compose con STORAGE_DRIVER=local y después con
#      STORAGE_DRIVER=s3 contra SeaweedFS: /ready = ready con database, storage
#      y media en ok, y un login inválido = 401, en los dos.
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
S3_KEY=CHANGE_ME      # = docker/seaweedfs/s3.json (valores de ejemplo, sin secretos reales)
S3_SECRET=CHANGE_ME
BUCKET=trust-assets

escribir_env() { # $1 = local | s3
  sed -E 's/[[:space:]]+#.*$//' .env.example | grep -E '^[A-Z]' \
    | grep -vE '^(DATABASE_URL|STORAGE_DRIVER|LOCAL_STORAGE_ROOT|MEDIA_SCRATCH_DIR|TRUST_PG_[A-Z_]+|S3_[A-Z_]+)=' > .env
  cat >> .env <<EOF
DATABASE_URL=postgres://trust_app:${APP_PW}@postgres:5432/trust
STORAGE_DRIVER=$1
LOCAL_STORAGE_ROOT=/var/lib/trust/storage
MEDIA_SCRATCH_DIR=/var/lib/trust/media-scratch
S3_ENDPOINT=http://seaweedfs:8333
S3_REGION=us-east-1
S3_BUCKET=${BUCKET}
S3_ACCESS_KEY=${S3_KEY}
S3_SECRET_KEY=${S3_SECRET}
S3_FORCE_PATH_STYLE=true
EOF
}
escribir_env local

limpiar() {
  set +e
  docker compose --profile s3 logs --no-color > compose-smoke.log 2>&1
  docker compose --profile s3 down -v --remove-orphans > /dev/null 2>&1
  rm -f .env
}
trap limpiar EXIT

echo "== imágenes (todas, perfil s3 incluido)"
docker compose --profile s3 pull -q
SIN_DIGEST=0
DIGESTS=""
for svc in postgres platform-api seaweedfs; do
  img=$(docker compose --profile s3 config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).services[process.argv[1]].image))" "$svc")
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$img")
  echo "$svc: declarada=$img resuelta=$digest"
  DIGESTS="$DIGESTS
GATE imagen $svc: $digest"
  case "$img" in *@sha256:*) ;; *) echo "   ✗ $svc NO está fijada por digest"; SIN_DIGEST=1 ;; esac
done
echo "GATE seaweedfs version: $(docker compose --profile s3 run --rm --no-deps seaweedfs version 2>/dev/null | tr -s '\n' ' ')"

echo "== S3 de dev/CI (SeaweedFS)"
docker compose --profile s3 up -d seaweedfs
export AWS_ACCESS_KEY_ID=$S3_KEY AWS_SECRET_ACCESS_KEY=$S3_SECRET AWS_DEFAULT_REGION=us-east-1
OK=""
for _ in $(seq 1 60); do
  if aws --endpoint-url http://127.0.0.1:9000 s3api list-buckets > /dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
[ -n "$OK" ] || { echo "✗ el S3 de SeaweedFS no respondió en 120 s" >&2; exit 1; }
aws --endpoint-url http://127.0.0.1:9000 s3api create-bucket --bucket "$BUCKET"
aws --endpoint-url http://127.0.0.1:9000 s3api head-bucket --bucket "$BUCKET"
echo "GATE compose-smoke: bucket $BUCKET creado en SeaweedFS"

echo "== contrato S3 (packages/platform-storage) contra SeaweedFS"
S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_REGION=us-east-1 S3_BUCKET=$BUCKET S3_ACCESS_KEY=$S3_KEY S3_SECRET_KEY=$S3_SECRET S3_FORCE_PATH_STYLE=true \
  npx vitest run packages/platform-storage/src/s3.contract.test.ts --reporter=verbose

echo "== postgres"
docker compose up -d --wait postgres
docker compose exec -T postgres postgres --version

echo "== bootstrap.sql (psql, dos veces: idempotente)"
for _ in 1 2; do
  docker compose exec -T postgres psql -U postgres -q -v ON_ERROR_STOP=1 \
    -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v db_name=trust < packages/platform-db/src/bootstrap.sql
done
echo "roles: $(docker compose exec -T postgres psql -U postgres -tAc "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'trust_%'")"

echo "== migraciones (trust_owner, dos veces)"
for _ in 1 2; do
  TRUST_MIGRATION_DATABASE_URL="postgres://trust_owner:${OWNER_PW}@127.0.0.1:5433/trust" pnpm db:migrate | tail -1
done

esperar_ready() { # $1 = etiqueta
  local READY=""
  for _ in $(seq 1 120); do
    READY=$(curl -s http://127.0.0.1:4000/ready || true)
    case "$READY" in *'"status":"ready"'*) break ;; esac
    sleep 5
  done
  echo "/health: $(curl -s http://127.0.0.1:4000/health)"
  echo "/ready:  $READY"
  node -e '
const r = JSON.parse(process.argv[1] || "{}");
const ok = r.status === "ready" && r.checks && Object.values(r.checks).every((v) => v === "ok");
if (!ok) { console.error("✗ /ready no está ready con todo en ok (" + process.argv[2] + ")"); process.exit(1); }
console.log("GATE compose-smoke (" + process.argv[2] + "): /ready con database, storage y media ok");' "$READY" "$1"
  local CODE
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"email":"nadie@ejemplo.com","password":"incorrecta-123"}' http://127.0.0.1:4000/api/v1/auth/login)
  echo "GATE compose-smoke ($1): login con usuario inexistente HTTP $CODE (esperado 401)"
  [ "$CODE" = 401 ]
}

echo "== platform-api (compose, STORAGE_DRIVER=local)"
# el contenedor instala sus propias dependencias sobre el repo montado: sin los
# node_modules del host (otro store de pnpm) no hay purga interactiva
find . -name node_modules -type d -prune -exec rm -rf {} +
docker compose up -d platform-api
esperar_ready storage-local

echo "== platform-api (compose, STORAGE_DRIVER=s3 → SeaweedFS)"
escribir_env s3
docker compose --profile s3 up -d --force-recreate --no-deps platform-api
sleep 3
esperar_ready storage-s3

echo "$DIGESTS"
if [ "$SIN_DIGEST" = 1 ]; then
  echo "✗ hay imágenes sin digest: fijarlas en docker-compose.yml con los digests de arriba" >&2
  exit 1
fi
echo "GATE compose-smoke completo"
