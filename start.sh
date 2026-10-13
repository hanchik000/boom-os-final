#!/usr/bin/env bash
# One command from a fresh clone to a running BOOM OS (macOS / Linux).
# Equivalent for Windows: start.cmd
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH: https://docs.docker.com/get-docker/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start Docker Desktop and run this again." >&2
  exit 1
fi

echo "[1/3] Configuration"
node scripts/setup-env.mjs

echo
echo "[2/3] Build and start (first run downloads images and compiles -- several minutes)"
docker compose up -d --build

PORT="$(grep -E '^BOOM_OS_PORT=' .env | cut -d= -f2 | tr -d '\r')"
PORT="${PORT:-3000}"

echo
echo "[3/3] Waiting for the server to answer on port ${PORT}"
for i in $(seq 1 120); do
  if curl -fsS -m 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo
    echo "BOOM OS is running: http://localhost:${PORT}"
    grep -E '^BOOTSTRAP_OWNER_(EMAIL|PASSWORD)=' .env | sed 's/^/  /'
    echo
    echo "  Logs:  docker compose logs -f api"
    echo "  Stop:  docker compose down            (data is kept)"
    echo "  Reset: docker compose down -v         (database erased)"
    exit 0
  fi
  sleep 2
done

echo "The server did not answer within four minutes. What it reported:" >&2
docker compose logs --tail 40 api >&2
exit 1
