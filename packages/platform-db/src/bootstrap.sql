-- Bootstrap de roles y base — lo corre UNA vez un superusuario (operaciones).
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--        -v owner_password="$OWNER_PW" -v app_password="$APP_PW" -v db_name=trust \
--        -f bootstrap.sql
--
-- trust_owner: dueño del esquema; corre las migraciones.
-- trust_app:   runtime de platform-api. Sin DDL, sin TRUNCATE, sin
--              UPDATE/DELETE sobre tablas inmutables ni sobre la auditoría.
--
-- IMPORTANTE: psql NO interpola :'variables' dentro de un bloque DO $$ … $$
-- (es un string con dollar-quoting). Por eso cada sentencia se arma con
-- format(%L / %I) fuera de cualquier bloque y se ejecuta con \gexec: así la
-- variable SÍ se sustituye y además se escapa (una comilla en la contraseña
-- no rompe nada). Idempotente: se puede correr dos veces.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE trust_owner LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'owner_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trust_owner') \gexec
SELECT format('CREATE ROLE trust_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trust_app') \gexec

SELECT format('CREATE DATABASE %I OWNER trust_owner', :'db_name')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO trust_app', :'db_name') \gexec

\connect :db_name
-- El esquema public nace del superusuario: pasa al owner y nadie más crea objetos.
ALTER SCHEMA public OWNER TO trust_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
