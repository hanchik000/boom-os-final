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

## Local development

1. Copy `.env.example` to `.env` and set real local values.
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
