# BOOM OS Foundation — Runtime Architecture

## Source of truth

PostgreSQL is the only runtime application database. Prisma owns schema migrations.

Redis is a separate infrastructure service reserved for caching, queues and distributed coordination.

The preserved SQLite database and JSON export are legacy migration artifacts only.

## Container topology

```text
BOOM OS central computer
└── Docker Compose
    ├── postgres  (private Docker network + persistent volume)
    ├── redis     (private Docker network + persistent volume)
    └── api       (port 3000)
```

PostgreSQL and Redis are not published to the host. The API connects to the service names `postgres` and `redis` over the Docker network.

## Schema lifecycle

```text
Prisma schema
      ↓
Prisma migration files
      ↓
prisma migrate deploy
      ↓
PostgreSQL
```

Legacy data import is separate:

```text
legacy SQLite/JSON backup
      ↓
server/migrate_data.ts
      ↓
existing PostgreSQL schema
```

The importer never creates the schema, drops tables, truncates data, or runs automatically during API startup.


## Implementation sequence

The system is built one vertical foundation stage at a time. Each stage must pass its acceptance checks before the next module is implemented.

1. Central server, local network, PostgreSQL, Redis, configuration and health.
2. Authentication and RBAC hardening.
3. Franchise, branch and employee management.
4. Menu and product catalog.
5. POS and order engine.
6. Kitchen display system (KDS).
7. Waiter application.
8. CRM and customer identity.
9. Boomcard / Boomcoin.
10. Inventory and recipes.
11. Finance and cash control.
12. KPI, service evaluation and analytics.
13. Remote HQ, backup, monitoring and disaster recovery.

The frontend visual design is intentionally decoupled from the domain/API layer so it can be redesigned later without changing the database model.
