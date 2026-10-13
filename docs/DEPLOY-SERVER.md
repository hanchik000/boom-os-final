# Putting BOOM OS on a server

The system needs two things on the machine: **Node 20+** and **PostgreSQL 15+**. Nothing else.
An empty server is the normal starting point — `deploy/server-setup.sh` installs what is missing.

## One command

Copy the project to the server (for example to `/opt/boom-os`), then:

```
cd /opt/boom-os
sudo bash deploy/server-setup.sh
```

It performs, in order:

1. **Node** — installs 20.x from NodeSource if the machine has none or an older one.
2. **PostgreSQL** — installs it, and starts the cluster if it is not already answering.
3. **Configuration** — writes `.env` with generated secrets, then sets the values a server needs:
   `HOST=0.0.0.0` (so the cashier's computer and the kitchen tablets can reach it),
   `NODE_ENV=production`, and `APP_URL` with the machine's own address.
4. **Database** — creates the role and the database named in `.env`. An existing database is kept
   with its data; only the role's password is re-synchronised with `.env`.
5. **Build** — `npm ci`, `prisma generate`, `prisma migrate deploy`, `npm run build`.
6. **Autostart** — creates the `boom` system user, hands it the directory, and registers
   `/etc/systemd/system/boom-os.service` so the system starts on boot and restarts if it stops.
7. **Check** — waits for `/api/health` and prints the address and the owner's credentials.

Running it again is safe: nothing already installed is reinstalled, no value already in `.env` is
overwritten, and the database is not recreated.

## Afterwards

```
journalctl -u boom-os -f        # logs
systemctl restart boom-os       # restart
systemctl stop boom-os          # stop
ufw allow 3000/tcp              # open the port, if a firewall is on
```

The owner's e-mail and password are in `.env` (`BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`).
That account is created once, on an empty database.

## Where the project may live

The service runs as the unprivileged `boom` user, so every directory on the way to the project
must be enterable by it. `/opt/boom-os` or `/srv/boom-os` are fine; `/root/...` is not — the script
checks this and says so instead of failing later with a missing-module error.

## What is NOT covered here

* **TLS and a domain.** The system answers plain HTTP on port 3000. For access from outside the
  restaurant's own network, put nginx or Caddy in front of it with a certificate.
* **Backups.** Nothing is backed up automatically. The data is one PostgreSQL database:
  `pg_dump boom_os > backup.sql` on a schedule is the minimum.
* **Another distribution.** The script covers Ubuntu and Debian (`apt-get`). On RHEL/Alma/Rocky
  install Node 20+ and PostgreSQL 15+ with `dnf`, then run `npm ci && npx prisma migrate deploy &&
  npm run build` and copy the service file from step 6 by hand.

## What was actually tested

On Ubuntu 24.04 with PostgreSQL 16, from a clean copy of the repository:

* first run — role and database created, **41 migrations applied**, project built, service file
  written, permissions set;
* second run — database and its data kept, no migration re-applied, finished without error;
* the server started as the `boom` user, listened on `0.0.0.0:3000`, `/api/health` reported
  `HEALTHY` with `database_status: CONNECTED`, `POST /api/auth/login` with the generated password
  returned **200** and a token, and the interface was served;
* the generated unit file passes `systemd-analyze verify`.

Two steps could not be exercised on that machine and are therefore **unverified**: the fresh
`apt-get install` of Node and PostgreSQL (both were already present), and `systemctl enable --now`
(the test machine runs no systemd, so the script detects this, writes the unit file, and prints the
command to start the system by hand instead).
