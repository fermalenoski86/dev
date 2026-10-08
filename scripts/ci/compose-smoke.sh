#!/bin/bash
# E1 · §35 — smoke REAL de `docker compose up` (job compose-smoke de CI).
#
#   1. genera un .env descartable desde .env.example (contraseñas aleatorias;
#      nunca pisa un .env existente);
#   2. baja las imágenes del `docker compose up` por defecto, imprime su digest
#      y exige que estén fijadas por digest;
#   3. levanta postgres, corre bootstrap.sql con psql (el camino de
#      operaciones, dos veces: idempotente) y migra como trust_owner
#      (`pnpm db:migrate`, dos veces: la segunda no aplica nada);
#   4. levanta platform-api desde el compose y exige /ready = ready con
#      database, storage y media en ok, y un login inválido = 401;
#   5. sondea (solo informa) qué imágenes S3 se pueden bajar sin login, como
#      evidencia para la decisión de producto sobre el reemplazo de MinIO.
#
# Requiere docker compose v2, node 22 y pnpm instalados en el host.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ -e .env ]; then
  echo "compose-smoke: ya existe .env; este smoke genera uno descartable y no lo pisa." >&2
  exit 2
fi

OWNER_PW=$(openssl rand -hex 16)
APP_PW=$(openssl rand -hex 16)

# .env.example sin comentarios en línea, con los valores del smoke
sed -E 's/[[:space:]]+#.*$//' .env.example | grep -E '^[A-Z]' \
  | grep -vE '^(DATABASE_URL|STORAGE_DRIVER|LOCAL_STORAGE_ROOT|MEDIA_SCRATCH_DIR|TRUST_PG_[A-Z_]+|S3_[A-Z_]+)=' > .env
cat >> .env <<EOF
DATABASE_URL=postgres://trust_app:${APP_PW}@postgres:5432/trust
STORAGE_DRIVER=local
LOCAL_STORAGE_ROOT=/var/lib/trust/storage
MEDIA_SCRATCH_DIR=/var/lib/trust/media-scratch
EOF

limpiar() {
  set +e
  docker compose logs --no-color > compose-smoke.log 2>&1
  docker compose down -v --remove-orphans > /dev/null 2>&1
  rm -f .env
}
trap limpiar EXIT

echo "== imágenes de \`docker compose up\`"
docker compose pull -q postgres platform-api
SIN_DIGEST=0
DIGESTS=""
for svc in postgres platform-api; do
  img=$(docker compose config --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).services[process.argv[1]].image))" "$svc")
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$img")
  echo "$svc: declarada=$img resuelta=$digest"
  DIGESTS="$DIGESTS
GATE imagen $svc: $digest"
  case "$img" in *@sha256:*) ;; *) echo "   ✗ $svc NO está fijada por digest"; SIN_DIGEST=1 ;; esac
done

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

echo "== platform-api (compose)"
# el contenedor instala sus propias dependencias sobre el repo montado: sin los
# node_modules del host (otro store de pnpm) no hay purga interactiva
find . -name node_modules -type d -prune -exec rm -rf {} +
docker compose up -d platform-api
READY=""
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
if (!ok) { console.error("✗ /ready no está ready con todo en ok"); process.exit(1); }
console.log("GATE compose-smoke: /ready con database, storage y media ok");' "$READY"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"email":"nadie@ejemplo.com","password":"incorrecta-123"}' http://127.0.0.1:4000/api/v1/auth/login)
echo "GATE compose-smoke: login con usuario inexistente HTTP $CODE (esperado 401: trust_app consulta la base)"
[ "$CODE" = 401 ]

echo "== sondeo S3 (informativo, no falla el smoke)"
for cand in minio/minio:latest quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z chrislusf/seaweedfs:latest rustfs/rustfs:latest dxflrs/garage:v2.1.0; do
  if docker pull -q "$cand" > /dev/null 2>&1; then
    echo "GATE sondeo S3: $cand → $(docker image inspect --format '{{index .RepoDigests 0}}' "$cand")"
  else
    echo "GATE sondeo S3: $cand → NO se puede bajar sin login"
  fi
done

echo "$DIGESTS"
if [ "$SIN_DIGEST" = 1 ]; then
  echo "✗ smoke OK pero hay imágenes sin digest: fijarlas en docker-compose.yml con los digests de arriba" >&2
  exit 1
fi
echo "GATE compose-smoke completo"
