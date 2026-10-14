# BOOM OS

Operating system for the BOOMBURGER restaurant network: floor, till, kitchen, stock, recipes,
food cost, staff, permissions, analytics, guest menu by QR.

- Frontend: React 19 + Vite + TypeScript
- Server: Express + TypeScript, bundled by esbuild into `dist/server.cjs`
- Database: PostgreSQL 15+ through Prisma (41 migrations, 78 tables)
- Auth: JWT + bcrypt, RBAC over 112 permissions

Redis is optional: it is probed only for the status line on `/api/health`. PostgreSQL is the
required system of record.

## Health Stack

- typecheck: npx tsc --noEmit
- test: for f in tests/*_static.mjs; do node "$f"; done
- e2e: for f in tests/*_e2e.mjs; do node "$f"; done   (each needs a fresh database — see below)
- lint: none configured (the type checker is the lint step)
- deadcode: not configured
- shell: not configured

Tests come in two sets and both count:

- **63 static suites** (`tests/*_static.mjs`) — source guards: permissions, money, kitchen rules,
  layout, startup. Seconds to run, no database needed.
- **36 end-to-end suites** (`tests/*_e2e.mjs`) — each drops and recreates the database, applies all
  migrations, boots the server and drives it over real HTTP. Around forty minutes for the set, and
  a running PostgreSQL is required.

One end-to-end suite runs as:

```
psql -U <user> -d postgres -c "DROP DATABASE IF EXISTS boom_os_runtime"
psql -U <user> -d postgres -c "CREATE DATABASE boom_os_runtime"
npx prisma migrate deploy
node dist/server.cjs &          # needs .env with DATABASE_URL and JWT_SECRET
node tests/<suite>_e2e.mjs
```

Each end-to-end suite creates the first OWNER itself through `/api/auth/bootstrap`, so the server
must start without the bootstrap-owner variables. When `.env` carries `BOOTSTRAP_OWNER_*` (the
local and Windows launchers write them), `server/seed.ts` creates that owner at boot and every
suite then fails with `409 !== 201` on its very first call. Clear the four variables for the test
run — exporting them empty is enough, since dotenv does not override what is already set:

```
BOOTSTRAP_OWNER_PASSWORD= BOOTSTRAP_OWNER_EMAIL= BOOTSTRAP_OWNER_NAME= BOOTSTRAP_OWNER_PHONE= \
  node dist/server.cjs &
```

No linter beyond the type checker is configured (no biome, no eslint), and knip and shellcheck are
not installed, so those categories are skipped rather than scored.

## Running the system

- Local, Docker: `./start.sh` (macOS/Linux) or `.\start.cmd` (Windows)
- Local, no Docker: `npm run up:local`
- Server (Ubuntu/Debian): `sudo bash deploy/server-setup.sh`

The database schema can also be applied from one file instead of the Prisma CLI; the deployment
notes are in `docs/DEPLOY-SERVER.md`.
