# BOOM OS Foundation

BOOM OS is the central operating system foundation for the BOOMBURGER restaurant network.

## Architecture

- Frontend: React + Vite + TypeScript
- API: Express + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Cache/queue layer: Redis (reserved for application services)
- Container runtime: Docker Compose

PostgreSQL is the only runtime application database. The distributable baseline contains no SQLite/JSON business-data backups and no demo-data importer.

## Quick start

One command, from a fresh clone to a running system. It writes `.env` with generated secrets
(never overwriting values that are already there), builds, applies migrations and starts the
stack:

```
./start.sh          # macOS / Linux
.\start.cmd         # Windows PowerShell (the default terminal in VS Code)
start.cmd           # Windows cmd.exe
```

PowerShell does not run a file from the current directory without the `.\` prefix; it reports
"is not recognized as the name of a cmdlet" and suggests the prefixed form.

PowerShell also refuses to run `npm` itself when script execution is disabled -- `npm` is the
script `npm.ps1`, and the error is "cannot be loaded because running scripts is disabled on this
system" (`PSSecurityException`). Either call `npm.cmd install` instead of `npm install`, or switch
the VS Code terminal to Command Prompt, where both work unchanged.

Both use Docker. Without Docker at all: install Node 20+ and PostgreSQL 15+ (the usual Windows installers),
then install, generate, migrate, build and start with

```
npm install
npm run up:local
```

Put the password chosen during the PostgreSQL setup into `DATABASE_URL` in `.env`. The database
itself does not need to be created by hand -- `prisma migrate deploy` creates it on first run,
verified on a clean server.

The command prints the owner e-mail and password it configured. Open http://localhost:3000.

Note: `dotenv` never overrides a variable that is already exported in your shell, so a leftover
`DATABASE_URL`, `JWT_SECRET` or `BOOTSTRAP_OWNER_PASSWORD` there would silently win over `.env`.
`npm run up:local` reports this and uses the file's values for the server it starts.

## Local development

1. Copy `.env.example` to `.env` and set real local values (or run `npm run setup`).
2. Start PostgreSQL and Redis.
3. Run `npm install`.
4. Run `npm run prisma:generate`.
5. Apply schema with `npm run db:migrate:deploy` (or create development migrations with Prisma Migrate).
6. On a clean database, no business data is seeded. Provision the first OWNER explicitly through the bootstrap flow or deployment bootstrap environment variables.
7. Start BOOM OS with `npm run dev`.

## Docker

Create a `.env` containing at minimum:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`

Then run:

`docker compose up --build`

The API is exposed on port `3000`. PostgreSQL and Redis are intentionally not published to the host; the API reaches them over the private Docker network.

The container runs `prisma migrate deploy` before starting the API.

## Health

`GET /api/health` performs a live PostgreSQL query and returns HTTP 503 when the database is unavailable.

## Security

Never commit `.env` or production secrets. `.env.example` contains placeholders only.

## Current scope

Foundation only: authentication, RBAC, users, roles, permissions, branches, franchises, audit, and system settings.

POS, Menu, Orders, KDS, CRM, Boomcard, Inventory, Finance and KPI are intentionally not activated yet.


## Phase 2 — Authentication & RBAC

Authentication is session-bound: JWTs reference a server-side auth session stored in PostgreSQL. Logout revokes that session, and middleware rejects revoked or expired sessions. RBAC resolves active roles, permissions, and branch access on every authenticated request. Bootstrap credentials are supplied only through `BOOTSTRAP_OWNER_PASSWORD`; no default password is embedded in the client or server seed.
