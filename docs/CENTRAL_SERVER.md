# BOOM OS — Central Server & Local Network (Stage 1)

## Purpose

The central computer is the authoritative local BOOM OS node for a restaurant. POS terminals, kitchen displays, waiter devices and the manager workstation will connect to the BOOM OS API over the local network.

## Topology

```text
Router / Firewall
       │
       │ LAN
       ▼
Central BOOM OS Server
       │
       ├── BOOM OS API :3000
       ├── PostgreSQL   (private)
       └── Redis        (private)

Future LAN clients:
  POS ────────────────┐
  KDS ────────────────┤
  Waiter tablets ─────┤──► BOOM OS API
  Manager workstation ┘
```

## Network rules

- API binds to `0.0.0.0` so LAN devices can reach the central server.
- PostgreSQL and Redis are not published to the host network.
- Only the BOOM OS API port is exposed by Docker Compose.
- The router/firewall should allow port `3000` only from the trusted restaurant LAN.
- Remote HQ access will be added later through a secure VPN/zero-trust layer; PostgreSQL must never be exposed directly to the Internet.

## Persistence

- `postgres_data` stores PostgreSQL data.
- `redis_data` stores Redis persistence.
- These Docker volumes survive container restarts.
- Database backups will be implemented as a separate stage.

## Runtime responsibilities

- PostgreSQL: source of truth for application data.
- Redis: reserved infrastructure for cache, queues and coordination.
- API: single application gateway for all clients.
- Frontend: client only; it must not connect directly to PostgreSQL.

## Stage 1 acceptance

The stage is considered complete only when the central computer can start PostgreSQL, Redis and API together, and `/api/health` reports both dependencies as connected.
