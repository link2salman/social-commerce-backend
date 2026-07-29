# Deploying IOVibe to the shared InterServer VPS

IOVibe is the **third** application on this box. TradeToBuild was here first and
provisioned the shared parts — nginx, certbot, ufw, Node 24, a 2 GB swap file
and a PostgreSQL 16 cluster. DocBuddy came second and added a PostgreSQL 17
cluster of its own. What IOVibe owns is its own PostgreSQL 17 cluster, its own
service user, one systemd unit and one nginx site. Nothing here re-does any of
the shared work.

**No containers**, matching both neighbours: PostgreSQL is an apt package from
PGDG with a cluster made by `pg_createcluster`, and the API runs as a systemd
unit executing `/usr/bin/node` directly. The `docker-compose.yml` at the
repository root is a local development convenience — it ships in the checkout
and is never invoked on the server.

That co-tenancy is why this directory is not a copy of DocBuddy's. Read
[Sharing the box](#sharing-the-box) before running anything.

**Sizing.** An InterServer 4-slice KVM VPS is **2 cores** / 8 GB RAM / 160 GB
SSD. Adding IOVibe brings the box to four Node processes and three PostgreSQL
clusters, roughly 3–3.5 GB. RAM is not the constraint; **CPU is**, and the spike
is still TradeToBuild's `next build`, which the swap file already exists for.
IOVibe's `tsc` build adds no new pressure.

## The target

| | |
| --- | --- |
| Host | InterServer `vps3519870` (KVM555), 4 slices |
| IP | `162.35.186.254` |
| OS | Ubuntu 24.04 LTS |
| Node | 24, already installed by TradeToBuild's provisioning (IOVibe needs ≥ 20) |
| API | **`http://162.35.186.254/v1`** — no domain yet, see [No domain, no TLS](#no-domain-no-tls) |
| Repo | `git@github.com:link2salman/iovibe-backend.git` |

### Who listens where

| | Port | Reachable from |
| --- | --- | --- |
| nginx | 80, 443 | the internet |
| TradeToBuild Next.js | 3000 | `127.0.0.1` |
| TradeToBuild Express | 5000 | `0.0.0.0` — `ufw` is the only thing keeping it private |
| TradeToBuild PostgreSQL 16 | 5432 | loopback |
| DocBuddy API | 5100 | `127.0.0.1` |
| DocBuddy PostgreSQL 17 (`17/main`) | 5433 | loopback |
| **IOVibe API** | **5200** | **`127.0.0.1`** |
| **IOVibe PostgreSQL 17 (`17/iovibe`)** | **5434** | **loopback** |

The IOVibe API binds loopback explicitly (`HOST=127.0.0.1` in `api.env`) rather
than trusting the firewall — `src/server.ts` reads `HOST` and defaults to
`0.0.0.0`, which is what local development wants and production must not have.

`provision.sh` refuses to run if 5200 or 5434 is already held by something that
isn't ours, rather than letting a service fail to bind and turn into a 502
someone debugs against the wrong app.

## No domain, no TLS

There is no domain for IOVibe yet, so **the API is served over plain HTTP on the
server's IP**. Let's Encrypt does not issue certificates for bare IP addresses,
so this is not an oversight that a certbot run would fix.

Two consequences worth being explicit about:

1. **Traffic is unencrypted.** Access tokens, passwords and message bodies cross
   the network in the clear. That is acceptable for the current stage — testing
   a release build on your own phone — and is not acceptable for real users.
   Getting a domain and running certbot is the fix, and it is a ten-minute job
   once the DNS record exists.
2. **The Android app needs an explicit exception to talk to it.** Release builds
   set `usesCleartextTraffic="false"`, so a release APK would fail every request
   with no useful error. The app generates a network-security-config from its
   own `.env` that permits cleartext for exactly the host in `API_URL` — see the
   app repo's `ARCHITECTURE.md` § "Release builds".

The nginx site is keyed on the IP: a request to `http://162.35.186.254/`
carries `Host: 162.35.186.254`, which matches `server_name` exactly, and an
exact match beats whichever neighbouring site is `default_server`.

**When you do get a domain**, this is the whole change:

```bash
# 1. A record  api.iovibe.app -> 162.35.186.254, then on the box:
sed -i 's/server_name .*/server_name api.iovibe.app 162.35.186.254;/' \
  /etc/nginx/sites-available/iovibe.conf
nginx -t && systemctl reload nginx
certbot --nginx -d api.iovibe.app --agree-tos -m hey2salman@gmail.com --redirect
```

Name **only** IOVibe's domain. Folding it into a neighbour's `-d` list makes one
certificate that two apps' renewals contend over, and a rename on either side
then breaks the other. Then repoint the app's `.env` at `https://…` / `wss://…`
and rebuild — at which point the cleartext exception disappears on its own,
because it is derived from the URL.

## Sharing the box

Four things are genuinely shared, and each has a rule.

**nginx.** IOVibe installs one site file, `iovibe.conf`, for one `server_name`.
It **does** define a `map` for websocket upgrades — IOVibe has a realtime
surface, unlike DocBuddy — but names the variable
**`$iovibe_connection_upgrade`**, not `$connection_upgrade`. TradeToBuild
already defines the latter in the http context
(`/etc/nginx/conf.d/tradetobuild-upgrade-map.conf`), and a second map of the
same name is a duplicate-directive error that fails `nginx -t` and takes **all
three** sites down on the next reload. The distinct name also means IOVibe does
not silently depend on a neighbour's drop-in continuing to exist.

**certbot.** Nothing to do while there is no domain. When there is one, issue a
certificate naming only IOVibe's domain.

**PostgreSQL.** Three clusters side by side, which is what Debian's packaging is
built for. IOVibe's is 17, reusing the PGDG packages DocBuddy already installed,
but a **separate cluster named `iovibe` on port 5434** — not a database inside
DocBuddy's cluster. A shared cluster would mean a `pg_ctlcluster` restart for
one app stops the other, and one app's backup script deciding the other's
retention.

### Collation: `C`, not the system locale

The cluster is created with `--lc-collate=C --lc-ctype=C` (encoding stays UTF8).
This matches `docker-compose.yml`, which initialises the development database
with `--locale=C` explicitly "so index/ORDER BY behaviour matches production" —
this cluster is the production that comment refers to.

`C` sorts by byte value, so `'Zoe'` < `'anna'`; a UTF-8 locale sorts
case-insensitively, so `'anna'` < `'Zoe'`. Every `ORDER BY` on a username,
product title or tag flips between them — silently, and only in production.

(DocBuddy's cluster on this same box is deliberately `en_US.UTF-8`, for the
opposite reason: it inherited data from a Supabase project that ran that way.
Collation is a property of the data, not a house style.)

**ufw.** Already enabled, already allowing OpenSSH and Nginx Full, which is
everything IOVibe needs — its API and database are both loopback-bound. It opens
no new rules. Do not disable ufw on this box: the *first* neighbour's API is on
`0.0.0.0:5000` and the firewall is all that stands between it and the internet.

## One database identity, not two

DocBuddy splits migrations (superuser `postgres`) from runtime (a
privilege-free `authenticator` role). **IOVibe deliberately does not copy that.**

That split exists because DocBuddy's schema is governed by ~73 row-level-security
policies, and RLS exempts a table's owner — an app connecting as the owner would
silently bypass every policy while appearing to work. IOVibe has no RLS;
authorisation lives in the service layer. A second role would buy nothing and
cost a grant-maintenance burden on every migration that adds a table.

So the `iovibe` role owns the database and runs both migrations and the app.

**The one thing that needs a superuser** is `CREATE EXTENSION`, which two
migrations issue for `pg_trgm`
(`20260722020000-user-search-trgm`, `20260723000000-search-indexes`).
`provision.sh` installs that extension as `postgres` when it creates the
database. The migrations still run their `CREATE EXTENSION IF NOT EXISTS` and
still succeed as a non-superuser: when the extension already exists PostgreSQL
short-circuits on the existence check and never reaches the privilege check.
That was **measured against a real PostgreSQL**, not inferred — and it is the
opposite of how `CREATE SCHEMA IF NOT EXISTS` behaves, which checks privileges
first.

> **If you write a migration that introduces a NEW extension**, it will fail on
> this box with `permission denied to create extension`. Add it to the
> `create extension` line in `provision.sh` and re-run that script (it is safe to
> re-run) *before* deploying the migration.

## 1. Give the server read access to this repo

The repo is private and `deploy.sh` fetches from it on every release, so this
needs durable access. The neighbours' deploy keys are scoped to their own
repositories and cannot read this one.

The key must belong to **`iovibe`, not root**: `deploy.sh` runs every git command
as the service user, and a key in `/root/.ssh` is unreadable to it. The failure
mode is a confusing `Host key verification failed` on a box where
`ssh -T git@github.com` works fine as root.

Run this **after** `provision.sh` has created the user:

```bash
install -d -m 700 -o iovibe -g iovibe /srv/iovibe/.ssh
sudo -H -u iovibe ssh-keygen -t ed25519 -N "" \
  -C "iovibe-deploy@$(hostname)" -f /srv/iovibe/.ssh/iovibe_deploy
printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile /srv/iovibe/.ssh/iovibe_deploy\n  IdentitiesOnly yes\n' \
  > /srv/iovibe/.ssh/config
chown iovibe:iovibe /srv/iovibe/.ssh/config && chmod 600 /srv/iovibe/.ssh/config
cat /srv/iovibe/.ssh/iovibe_deploy.pub
```

Add that key at
**https://github.com/link2salman/iovibe-backend/settings/keys** → *Add deploy
key*. **Leave "Allow write access" unchecked** — the server only ever reads.

Pin GitHub's host key rather than accepting whatever answers first:

```bash
ssh-keyscan -t ed25519 github.com > /srv/iovibe/.ssh/known_hosts
chown iovibe:iovibe /srv/iovibe/.ssh/known_hosts
ssh-keygen -lf /srv/iovibe/.ssh/known_hosts
# must print: SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU

sudo -H -u iovibe ssh -T git@github.com     # root succeeding proves nothing
```

## 2. Provision

The path matters: the systemd unit references `/srv/iovibe/app` literally, and
`provision.sh` refuses to run from anywhere else.

```bash
mkdir -p /srv/iovibe
git clone git@github.com:link2salman/iovibe-backend.git /srv/iovibe/app
cd /srv/iovibe/app

bash deploy/provision.sh
```

This creates the PostgreSQL 17 cluster `iovibe` on 5434 (UTF8 / collation `C`),
the `iovibe` user, the database, the `pg_trgm` extension, `/etc/iovibe/api.env`
with a generated `JWT_SECRET`, the nginx site and the systemd unit.

Re-running is safe. It will **not** overwrite an existing `api.env` —
regenerating `JWT_SECRET` logs out every user holding a live token.

## 3. Build and start

```bash
bash /srv/iovibe/app/deploy/deploy.sh
```

Installs dependencies, compiles, runs migrations, restarts the service, and
refuses to report success until `/live` **and** `/health` both answer and the
unit has stopped restarting.

Verify from your laptop:

```bash
curl -i http://162.35.186.254/health
curl -i http://162.35.186.254/v1/auth/login -X POST \
  -H 'Content-Type: application/json' -d '{"email":"x@y.z","password":"nope"}'
# expect 401 with {"success":false,...,"code":"INVALID_CREDENTIALS"}
```

## 4. Media, before the app is usable

`provision.sh` leaves every integration blank, and each degrades rather than
crashing. One of them is not really optional:

**Without `S3_BUCKET`, video publishing, avatar upload and chat images all
return 503** — which is most of what this app does. Fill in the S3 block in
`/etc/iovibe/api.env`, then `systemctl restart iovibe-api`. Any S3-compatible
bucket works (AWS, Cloudflare R2, DigitalOcean Spaces); INTEGRATIONS.md has the
bucket policy, CORS and IAM policy it needs.

The others (`STRIPE_*`, `FCM_SERVICE_ACCOUNT_BASE64`, `SMTP_*`,
`GOOGLE_MAPS_API_KEY`, `TURN_*`) each disable exactly one feature with a clean
503 or no-op.

> `GOOGLE_MAPS_API_KEY` here is **not** the key in the app's `.env`. The app's
> key is restricted to an Android package name and SHA-1 and will be rejected
> for server-side Geocoding calls. Make a separate key with the Geocoding API
> enabled.

## Seeding demo data

`npm run seed` is a **full reset**: it TRUNCATEs users CASCADE and re-inserts.
It is not part of `deploy.sh` and must never be. If you want the demo content on
the server for testing, run it deliberately:

```bash
cd /srv/iovibe/app
sudo -H -u iovibe sh -c 'set -a; . /etc/iovibe/api.env; set +a; npx ts-node -r tsconfig-paths/register src/seeders/seedAll.ts'
```

Every seeded account is `{username}@demo.social` with the password
`password123` (`src/seeders/seedAll.ts`). Do not leave that data — or those
credentials — in place once real users exist.

## Every deploy after that

From your own machine, after merging:

```bash
npm run deploy
```

| Command | Does |
| --- | --- |
| `npm run deploy` | Fetch the tracked branch, build, migrate, restart, health-check |
| `npm run deploy:quick` | Same, skipping migrations — code-only releases |
| `npm run deploy:branch` | Deploy the branch you currently have checked out |
| `npm run deploy:status` | `iovibe-api`, the Postgres cluster and nginx, live `/health`, and the deployed commit |
| `npm run deploy:logs` | Tail the journal |
| `npm run deploy:ssh` | Shell on the box |

All target `root@162.35.186.254`. The whole `user@host` is the variable, so a
different login works too:

```bash
IOVIBE_HOST=me@162.35.186.254 npm run deploy:status
```

`deploy:status` reads the commit with `sudo -H -u iovibe git -C …` rather than a
bare `git log`: the checkout belongs to the service user, and git refuses to
report on a tree it considers someone else's ("dubious ownership") even for root.

`deploy:logs` and `deploy:ssh` pass `ssh -t` to allocate a terminal — without it
`journalctl -f` and an interactive shell come up with no line editing and no
working Ctrl-C.

Backups are not an npm script: `backup.sh` runs from cron on the box (see
[Backups](#backups)), where a laptop being asleep cannot skip a night.

### Two things that bite

`deploy.sh` runs `git reset --hard`, so **uncommitted edits under
`/srv/iovibe/app` are destroyed**. Configuration lives in `/etc/iovibe/`,
outside the repo, precisely so a deploy cannot touch it.

**Nothing runs the test suite before deploying.** `deploy.sh` will happily ship
a build that fails CI. Merging only after checks pass is what protects this.

### Rolling back

```bash
npm run deploy:ssh
cd /srv/iovibe/app
sudo -H -u iovibe git reset --hard <last-good-commit>
bash deploy/deploy.sh --no-pull
```

Migrations do not roll back with the code. `sequelize-cli` tracks applied
migrations in `SequelizeMeta`; reverting code whose migration has already been
applied leaves the schema ahead of the app, which is usually harmless and
occasionally not. Check `npm run migrate:status` before assuming.

## Backups

```bash
bash /srv/iovibe/app/deploy/backup.sh
( crontab -l 2>/dev/null; echo '10 4 * * * /srv/iovibe/app/deploy/backup.sh >> /var/log/iovibe-backup.log 2>&1' ) | crontab -
```

04:10, not 03:15 or 03:40 — those are the neighbours' backup windows and this
box has two cores.

Dumps the database and copies `api.env`, which holds the only copy of
`JWT_SECRET`. There is no upload directory to archive: media goes straight from
the phone to S3 and never touches this disk.

Archives land in `/var/backups/iovibe` on the same disk they protect. That
covers a bad migration; it does not cover losing the VPS. Copy them off the box.

## Operating it

```bash
systemctl status iovibe-api
journalctl -u iovibe-api -f                # pino JSON
systemctl restart iovibe-api               # after editing /etc/iovibe/api.env
nginx -t && systemctl reload nginx         # affects ALL THREE sites — always -t first
sudo -u postgres psql -p 5434 iovibe       # IOVibe's database
sudo -u postgres psql -p 5433 docbuddy     # DocBuddy's — note the port
sudo -u postgres psql -p 5432 tradetobuild # TradeToBuild's
```

Getting the port wrong is the easiest mistake on this box. `psql iovibe` with no
`-p` goes to the PostgreSQL **16** cluster and reports that no such database
exists, which reads like data loss and isn't.

**Which change needs what:**

| Changed | Needed |
| --- | --- |
| Anything in `/etc/iovibe/api.env` | `systemctl restart iovibe-api` |
| Application code | `deploy.sh` |
| A migration | `deploy.sh` (not `--skip-migrate`) |
| The nginx site | `nginx -t && systemctl reload nginx` |

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `502 Bad Gateway` from `http://162.35.186.254/` | the API is down — `journalctl -u iovibe-api -n 50` |
| **A neighbour's site also 502s** | you reloaded nginx with a broken config. `nginx -t` names the file and line; a duplicate `map` variable is the likely cause |
| API exits at boot: `Refusing to connect in production without TLS certificate verification` | `DB_SSL` is not `false` in `api.env`. Postgres here is loopback and speaks plaintext; `src/config/db.ts` turns SSL on by default in production |
| API exits at boot: `JWT_SECRET must be at least 32 characters` | `assertBootConfig()` rejected the secret. Regenerate with `openssl rand -base64 48` — and note it logs everyone out |
| `/live` OK but `/health` 503 | the process is up but the database is not reachable. `systemctl status postgresql@17-iovibe` |
| Migration fails: `permission denied to create extension` | a migration introduced a new extension. Add it to `provision.sh` and re-run that script — see [One database identity](#one-database-identity-not-two) |
| `psql: database "iovibe" does not exist` | wrong cluster. Add `-p 5434` |
| `pg_dump: server version mismatch` | `/usr/bin/pg_dump` is the 16 client. Use `/usr/lib/postgresql/17/bin/pg_dump`, as `backup.sh` does |
| App gets network errors against a **release** APK but the debug build works | the cleartext exception. The release APK permits cleartext only for the host in the `.env` it was built with — rebuild after changing `API_URL` |
| S3 `PUT` returns `301 PermanentRedirect` | `S3_REGION` does not match the bucket's actual region. The error body names the right endpoint; copy the region out of it |
| Uploads succeed but media never displays | the bucket has no public-read policy. Playback URLs are persisted on rows and fetched anonymously — see INTEGRATIONS.md for the policy, or put CloudFront in front and set `S3_PUBLIC_BASE_URL` |
| `/socket.io/…transport=websocket` returns `400` in the access log | *not* nginx if a `curl` upgrade returns `101` — check that first, then the client. A `socket.io-client` with the same options from Node is the fastest way to separate the two |
| Rate limiting seems to apply globally | `X-Forwarded-For` is not reaching Express, so every request buckets under nginx's own IP |
