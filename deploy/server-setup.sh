#!/usr/bin/env bash
# ----------------------------------------------------------------------------------------------
# BOOM OS -- one command from an empty Ubuntu/Debian server to a running, self-starting system.
#
# It installs what is missing (Node 20+, PostgreSQL), creates the database and its user, writes
# .env, builds the project, applies the migrations and registers a systemd service so the system
# comes back by itself after a reboot.
#
# Run it from the project directory, as root:
#
#     sudo bash deploy/server-setup.sh
#
# It is safe to run again: nothing already present is reinstalled, no value already in .env is
# overwritten, and the database is created only if it does not exist.
# ----------------------------------------------------------------------------------------------
set -euo pipefail

PORT="${BOOM_PORT:-3000}"
SERVICE_NAME="${BOOM_SERVICE:-boom-os}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

step() { printf '\n\033[1m[%s]\033[0m %s\n' "$1" "$2"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this as root: sudo bash deploy/server-setup.sh"
[ -f "$APP_DIR/package.json" ] || fail "package.json not found next to this script -- run it from the project directory."
command -v apt-get >/dev/null 2>&1 || fail "This script covers Ubuntu and Debian. On another system install Node 20+ and PostgreSQL 15+ by hand, then run: npm ci && npm run build && npx prisma migrate deploy"

# Reads a value out of .env. Written in node rather than sed because a generated password may
# contain characters that are special to sed.
get_env() { node -e '
  const fs=require("fs");
  const m=fs.readFileSync(".env","utf8").match(new RegExp("^"+process.argv[1]+"=(.*)$","m"));
  process.stdout.write(m?m[1].trim():"");' "$1"; }

set_env() { node -e '
  const fs=require("fs");
  const [key,value]=process.argv.slice(1);
  let s=fs.readFileSync(".env","utf8");
  const line=key+"="+value;
  s = new RegExp("^"+key+"=.*$","m").test(s) ? s.replace(new RegExp("^"+key+"=.*$","m"),line) : s.replace(/\n*$/,"\n")+line+"\n";
  fs.writeFileSync(".env",s);' "$1" "$2"; }

# ------------------------------------------------------------------ 1. Node
step 1/7 "Node.js"
node_major() { command -v node >/dev/null 2>&1 && node -p "process.versions.node.split('.')[0]" || echo 0; }
if [ "$(node_major)" -ge 20 ]; then
  echo "    already installed: $(node -v)"
else
  echo "    installing Node 20 from NodeSource"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  echo "    installed: $(node -v)"
fi

# ------------------------------------------------------------------ 2. PostgreSQL
step 2/7 "PostgreSQL"
if command -v psql >/dev/null 2>&1; then
  echo "    already installed: $(psql --version)"
else
  echo "    installing"
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib >/dev/null
  echo "    installed: $(psql --version)"
fi
# The cluster has to be up before the database can be created. systemd is the normal path; a
# container without it still has pg_ctlcluster.
if ! su - postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1; then
  systemctl start postgresql >/dev/null 2>&1 || pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start >/dev/null 2>&1 || true
  su - postgres -c "psql -tAc 'SELECT 1'" >/dev/null 2>&1 || fail "PostgreSQL is installed but not answering. Start it and run this again."
fi
echo "    server is answering"

# ------------------------------------------------------------------ 3. Configuration
step 3/7 "Configuration"
node scripts/setup-env.mjs
# Server-specific values. A server must listen on every interface, or the cashier's computer and
# the kitchen tablets cannot reach it.
set_env HOST 0.0.0.0
set_env NODE_ENV production
set_env PORT "$PORT"
set_env BOOM_OS_PORT "$PORT"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
set_env APP_URL "http://${IP:-localhost}:${PORT}"
DB_NAME="$(get_env POSTGRES_DB)"; DB_USER="$(get_env POSTGRES_USER)"; DB_PASS="$(get_env POSTGRES_PASSWORD)"
set_env DATABASE_URL "postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
echo "    .env ready: database ${DB_NAME}, user ${DB_USER}, port ${PORT}"

# ------------------------------------------------------------------ 4. Database and its user
step 4/7 "Database"
psql_as_postgres() { su - postgres -c "psql -v ON_ERROR_STOP=1 -tAc \"$1\""; }
if [ "$(psql_as_postgres "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" = "1" ]; then
  echo "    user ${DB_USER} exists -- updating its password to match .env"
  psql_as_postgres "ALTER ROLE \\\"${DB_USER}\\\" WITH LOGIN PASSWORD '${DB_PASS}'" >/dev/null
else
  psql_as_postgres "CREATE ROLE \\\"${DB_USER}\\\" WITH LOGIN PASSWORD '${DB_PASS}'" >/dev/null
  echo "    user ${DB_USER} created"
fi
if [ "$(psql_as_postgres "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" = "1" ]; then
  echo "    database ${DB_NAME} already exists -- keeping it and its data"
else
  psql_as_postgres "CREATE DATABASE \\\"${DB_NAME}\\\" OWNER \\\"${DB_USER}\\\"" >/dev/null
  echo "    database ${DB_NAME} created"
fi

# ------------------------------------------------------------------ 5. Build
step 5/7 "Dependencies, schema and build"
npm ci --no-audit --no-fund
npx prisma generate >/dev/null
npx prisma migrate deploy
npm run build >/dev/null
echo "    built"

# ------------------------------------------------------------------ 6. Service
step 6/7 "Autostart"
id -u boom >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin boom
chown -R boom:boom "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# The service runs as `boom`, so every directory on the way to the project has to be enterable by
# it. A project unpacked under /root, or under any directory with 0700 permissions, passes every
# step above and then fails at startup with a bare "Cannot find module .../dist/server.cjs" --
# which says nothing about permissions. Catch it here, where it can be explained.
if ! su boom -s /bin/bash -c "test -r '$APP_DIR/dist/server.cjs'"; then
  fail "The user 'boom' cannot read $APP_DIR/dist/server.cjs.
Usually the project sits under a directory nobody but root may enter (/root, or any 0700 path).
Move the project somewhere a service can reach, for example:

  mv '$APP_DIR' /opt/boom-os && cd /opt/boom-os && sudo bash deploy/server-setup.sh"
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=BOOM OS
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=boom
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v node) ${APP_DIR}/dist/server.cjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
echo "    /etc/systemd/system/${SERVICE_NAME}.service written"

# A container (Docker, LXC without systemd) has no init to register the service with. Say so
# instead of failing, and give a command that actually runs the system there.
SYSTEMD=0
[ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ] && SYSTEMD=1

if [ "$SYSTEMD" = "1" ]; then
  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}" >/dev/null
  echo "    service enabled and started"
else
  echo "    this machine does not run systemd (a container), so the service was not registered."
fi

# ------------------------------------------------------------------ 7. Check
step 7/7 "Checking"
if [ "$SYSTEMD" != "1" ]; then
  printf '\n\033[33mSetup finished. Start the system with:\033[0m\n\n'
  echo "  cd ${APP_DIR}"
  echo "  su boom -s /bin/bash -c 'set -a; . ./.env; set +a; node dist/server.cjs'"
  echo
  echo "  Then open http://${IP:-localhost}:${PORT} and sign in as"
  echo "  $(get_env BOOTSTRAP_OWNER_EMAIL) / $(get_env BOOTSTRAP_OWNER_PASSWORD)"
  exit 0
fi

OK=0
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done

if [ "$OK" = "1" ]; then
  printf '\n\033[32mBOOM OS is running.\033[0m\n'
  echo "  Address:   http://${IP:-localhost}:${PORT}"
  echo "  Sign in:   $(get_env BOOTSTRAP_OWNER_EMAIL) / $(get_env BOOTSTRAP_OWNER_PASSWORD)"
  echo
  echo "  Logs:      journalctl -u ${SERVICE_NAME} -f"
  echo "  Restart:   systemctl restart ${SERVICE_NAME}"
  echo "  Stop:      systemctl stop ${SERVICE_NAME}"
  echo
  echo "  If the address does not open from another computer, open the port:"
  echo "    ufw allow ${PORT}/tcp"
else
  printf '\n\033[31mThe server did not answer on port %s.\033[0m\n' "$PORT"
  echo "  What it reported:"
  journalctl -u "${SERVICE_NAME}" --no-pager -n 30 2>/dev/null || true
  exit 1
fi
