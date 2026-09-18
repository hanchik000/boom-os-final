#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_PASSWORD:=boom_runtime_password_18_8}"
: "${JWT_SECRET:=boom-runtime-jwt-secret-18-8-change-me}"
: "${BOOTSTRAP_OWNER_PASSWORD:=BoomRuntimeOwner18_8!}"
export POSTGRES_PASSWORD JWT_SECRET
export POSTGRES_DB="${POSTGRES_DB:-boom_os_runtime_18_8}"
export POSTGRES_USER="${POSTGRES_USER:-boom_admin}"
export BOOM_OS_PORT="${BOOM_OS_PORT:-3000}"

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker is required for full runtime verification."
  exit 2
fi

cleanup(){ docker compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting isolated BOOM OS runtime..."
# This suite bootstraps the first OWNER through the API, so the container must start
# with no seeded owner. Blank the bootstrap vars explicitly in case the caller exports them.
BOOTSTRAP_OWNER_PASSWORD= BOOTSTRAP_OWNER_EMAIL= BOOTSTRAP_OWNER_NAME= BOOTSTRAP_OWNER_PHONE= \
  docker compose up -d --build

for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${BOOM_OS_PORT}/api/health" >/tmp/boom-os-health.json 2>/dev/null; then
    break
  fi
  if [ "$i" = 90 ]; then
    docker compose ps
    docker compose logs api --tail=200
    echo "FAIL: API did not become healthy"
    exit 1
  fi
  sleep 2
done

BOOTSTRAP_OWNER_PASSWORD="$BOOTSTRAP_OWNER_PASSWORD" node tests/stage18_8_full_runtime.mjs
