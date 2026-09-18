#!/usr/bin/env bash
set -euo pipefail

echo "BOOM OS Stage 18.7 runtime harness"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"
: "${JWT_SECRET:?Set JWT_SECRET}"
: "${BOOTSTRAP_OWNER_PASSWORD:?Set BOOTSTRAP_OWNER_PASSWORD}"
# The seed provisions the bootstrap owner only when password, email and name are all supplied.
: "${BOOTSTRAP_OWNER_EMAIL:=owner@boom.local}"
: "${BOOTSTRAP_OWNER_NAME:=BOOM OS Owner}"
export BOOTSTRAP_OWNER_PASSWORD BOOTSTRAP_OWNER_EMAIL BOOTSTRAP_OWNER_NAME

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker is required for the bundled PostgreSQL/Redis runtime harness."
  exit 2
fi

docker compose up -d --build postgres redis
cleanup(){ docker compose down; }
trap cleanup EXIT

echo "Waiting for PostgreSQL and Redis..."
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-boom_admin}" -d "${POSTGRES_DB:-boom_os}" >/dev/null 2>&1 &&
     docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 2
  if [ "$i" = 60 ]; then echo "FAIL: infrastructure did not become ready"; exit 1; fi
done

export DATABASE_URL="postgresql://${POSTGRES_USER:-boom_admin}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-boom_os}?schema=public"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT:-6379}"
export PORT="${PORT:-3000}"
export HOST="127.0.0.1"

npx prisma migrate deploy
npm run prisma:generate
npm run lint
npm run build

NODE_ENV=production npm start >/tmp/boom-os-stage18.7.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; docker compose down' EXIT

for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/tmp/boom-health.json; then break; fi
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then cat /tmp/boom-os-stage18.7.log; exit 1; fi
  if [ "$i" = 60 ]; then cat /tmp/boom-os-stage18.7.log; exit 1; fi
done

echo "Health:"
cat /tmp/boom-health.json

echo "Runtime smoke checks"
curl -fsS "http://127.0.0.1:${PORT}/api/auth/bootstrap-status"
curl -fsS "http://127.0.0.1:${PORT}/api/public/menu" >/dev/null

echo "STAGE 18.7 RUNTIME SMOKE: PASS"
