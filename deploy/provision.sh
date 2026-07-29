#!/usr/bin/env bash
#
# IOVibe API — one-time provisioning for the shared InterServer VPS.
#
# This box already runs TWO other applications: TradeToBuild (nginx, Node 24,
# PostgreSQL 16 on 5432, an Express API on 5000) and DocBuddy (an API on 5100,
# PostgreSQL 17 on 5433). IOVibe is the THIRD tenant, so this script is narrow
# by design: it never touches nginx's global config, never runs certbot, never
# edits the firewall, and never goes near the neighbours' clusters or units.
#
# What it owns:
#   * a PostgreSQL 17 cluster named `iovibe` on port 5434, alongside 16/main
#     (5432) and 17/main (5433)
#   * the `iovibe` service user, /srv/iovibe and /etc/iovibe
#   * the database and the `iovibe` login role that owns it
#   * /etc/iovibe/api.env
#   * one nginx site and one systemd unit
#
# Run once, as root, from the checkout at /srv/iovibe/app:
#
#   bash deploy/provision.sh
#
# There is no domain yet, so the nginx site is keyed on the server's IP and is
# plain HTTP. Override if that changes:
#
#   SERVER_NAME=api.iovibe.app bash deploy/provision.sh
#
# Safe to re-run: every step checks before it acts, and it will never overwrite
# an existing /etc/iovibe/api.env — regenerating JWT_SECRET logs out every user
# whose phone is holding a live token.
set -euo pipefail

# The nginx `server_name`. Defaults to this box's public IP because IOVibe has
# no domain yet: a request to http://<ip>/ carries `Host: <ip>`, which matches
# exactly and beats whichever neighbouring site is default_server.
SERVER_NAME="${SERVER_NAME:-162.35.186.254}"

APP_USER="${APP_USER:-iovibe}"
APP_DIR="${APP_DIR:-/srv/iovibe/app}"
CONFIG_DIR="${CONFIG_DIR:-/etc/iovibe}"
DB_NAME="${DB_NAME:-iovibe}"
DB_USER="${DB_USER:-iovibe}"
DB_PORT="${DB_PORT:-5434}"
PG_MAJOR="${PG_MAJOR:-17}"
# NOT `main` — DocBuddy already owns 17/main on 5433. A same-named cluster in
# the same major is what pg_createcluster refuses, and rightly.
PG_CLUSTER="${PG_CLUSTER:-iovibe}"
API_PORT="${API_PORT:-5200}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[x]\033[0m %s\n' "$*"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root (sudo bash deploy/provision.sh)"

# The systemd unit references this path literally, so a checkout anywhere else
# installs a unit pointing at nothing.
if [[ "$REPO_DIR" != "$APP_DIR" ]]; then
  fail "This repo is at $REPO_DIR but the systemd unit expects $APP_DIR.
  Move it:  mkdir -p $(dirname "$APP_DIR") && mv $REPO_DIR $APP_DIR"
fi

psql_su() { sudo -u postgres psql -p "$DB_PORT" -v ON_ERROR_STOP=1 -q "$@"; }

# ─── Don't disturb the neighbours ─────────────────────────────────────────────
# 3000/5000/5432 are TradeToBuild's, 5100/5433 are DocBuddy's. Refusing here
# beats discovering the collision when a service quietly fails to bind and
# someone debugs the resulting 502 against the wrong application.
log "Checking for port collisions"
for port in "$API_PORT" "$DB_PORT"; do
  if ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
    owner="$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -o 'users:.*' || true)"
    case "$owner" in
      # Ours already listening is expected on a re-run; anything else is not.
      *iovibe*|*postgres*) warn "port $port already held by $owner — assuming this is a re-run" ;;
      *) fail "port $port is in use by $owner. Set API_PORT/DB_PORT to something free." ;;
    esac
  fi
done

# ─── System packages ──────────────────────────────────────────────────────────
log "Checking system packages"
export DEBIAN_FRONTEND=noninteractive

# PostgreSQL 17 from PGDG. DocBuddy's provisioning already added that repository
# and installed these packages, so this is normally a no-op — it exists for the
# case where IOVibe lands on a box without that history.
if ! command -v "/usr/lib/postgresql/${PG_MAJOR}/bin/postgres" >/dev/null 2>&1; then
  log "Adding the PGDG repository and installing PostgreSQL ${PG_MAJOR}"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  install -d -m 0755 /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}"
else
  log "PostgreSQL ${PG_MAJOR} already installed"
fi

# Node: whatever the box already has, provided it is new enough. Upgrading the
# runtime that two other applications are running on is not this script's
# business.
node_major() { command -v node >/dev/null 2>&1 && node -v | sed 's/^v\([0-9]*\).*/\1/' || echo 0; }
if [[ "$(node_major)" -lt 20 ]]; then
  fail "Node $(node -v 2>/dev/null || echo 'not installed') is too old; IOVibe needs >= 20.
  This box is shared — install a newer Node deliberately (NodeSource) and re-run,
  rather than letting this script upgrade a runtime two other apps depend on."
fi
log "Using Node $(node -v), npm $(npm -v)"

# ─── The PostgreSQL cluster ───────────────────────────────────────────────────
#
# Collation is `C`, matching docker-compose.yml, which initialises the
# development database with --locale=C "so index/ORDER BY behaviour matches
# production". This is the cluster that comment is talking about — if it were
# created with the system locale instead, every ORDER BY on a username, product
# title or tag would sort differently here than on every developer's machine.
# `C` sorts by byte value ('Zoe' < 'anna'); en_US.UTF-8 sorts case-insensitively
# ('anna' < 'Zoe'), and nothing in the app would report the discrepancy.
#
# Encoding stays UTF8 — only the collation and ctype are C.
#
# (DocBuddy's cluster on this same box is deliberately en_US.UTF-8 for the
# opposite reason: it inherited data from a Supabase project that ran that way.
# Collation is a property of the data, not a house style.)
log "Preparing the PostgreSQL ${PG_MAJOR} cluster '${PG_CLUSTER}' on port ${DB_PORT}"

cluster_exists() { pg_lsclusters -h 2>/dev/null | awk '{print $1"/"$2}' | grep -qx "${PG_MAJOR}/${PG_CLUSTER}"; }

if cluster_exists; then
  existing_port="$(pg_lsclusters -h | awk -v c="${PG_MAJOR}/${PG_CLUSTER}" '$1"/"$2==c {print $3}')"
  if [[ "$existing_port" != "$DB_PORT" ]]; then
    warn "cluster ${PG_MAJOR}/${PG_CLUSTER} is on port ${existing_port}, not ${DB_PORT} — using ${existing_port}"
    DB_PORT="$existing_port"
  fi
  # Read this from pg_database, NOT `show lc_collate` — PostgreSQL 17 removed
  # that GUC, so the older form errors out and every re-run would warn about a
  # collation mismatch that isn't there.
  existing_collate="$(sudo -u postgres psql -p "$DB_PORT" -tAc \
    "select datcollate from pg_database where datname = 'template1'" 2>/dev/null || echo unknown)"
  if [[ "$existing_collate" != "C" ]]; then
    warn "cluster collation is '${existing_collate}', not 'C' — text will sort differently
    here than in development. Recreating a cluster destroys its data, so this is
    left alone deliberately. See deploy/README.md."
  fi
  log "Cluster ${PG_MAJOR}/${PG_CLUSTER} already exists on port ${DB_PORT}, collation ${existing_collate}"
else
  log "Creating cluster ${PG_MAJOR}/${PG_CLUSTER} (encoding UTF8, collation C)"
  pg_createcluster "${PG_MAJOR}" "${PG_CLUSTER}" --port "${DB_PORT}" -- \
    --encoding=UTF8 --lc-collate=C --lc-ctype=C --data-checksums
fi

pg_ctlcluster "${PG_MAJOR}" "${PG_CLUSTER}" start 2>/dev/null || true
systemctl enable "postgresql@${PG_MAJOR}-${PG_CLUSTER}" >/dev/null 2>&1 || true

# Loopback only. This cluster is never reached from off the box, and the
# firewall should not be the only reason that is true.
CONF="/etc/postgresql/${PG_MAJOR}/${PG_CLUSTER}/postgresql.conf"
if ! grep -qE "^listen_addresses\s*=\s*'localhost'" "$CONF"; then
  sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$CONF"
  pg_ctlcluster "${PG_MAJOR}" "${PG_CLUSTER}" restart
fi

sudo -u postgres psql -p "$DB_PORT" -tAc 'select version()' | sed 's/^/    /'

# ─── Service user and directories ─────────────────────────────────────────────
log "Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || \
  useradd --system --create-home --home-dir /srv/iovibe --shell /usr/sbin/nologin "$APP_USER"

mkdir -p "$APP_DIR" "$CONFIG_DIR"
chown -R "$APP_USER:$APP_USER" /srv/iovibe

# Holds JWT_SECRET and the database password: readable by the service user,
# writable by nobody but root.
chown root:"$APP_USER" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"

# ─── Database and role ────────────────────────────────────────────────────────
#
# ONE identity, not two. DocBuddy on this box splits migrations (superuser) from
# runtime (a privilege-free `authenticator` role) because its schema is governed
# by ~73 row-level-security policies, and RLS exempts a table's owner — an app
# connecting as the owner would silently bypass every policy. IOVibe has no RLS:
# authorisation is enforced in the service layer, so a second role would buy
# nothing and cost a grant-maintenance burden on every migration.
#
# So `iovibe` owns the database and runs both the migrations and the app.
log "Creating the database and role"

DB_PASSWORD_FILE="$CONFIG_DIR/.dbpass"
if [[ ! -f "$DB_PASSWORD_FILE" ]]; then
  # hex only: this password goes into a URL, where a '@' or '/' would silently
  # truncate the connection string.
  openssl rand -hex 24 > "$DB_PASSWORD_FILE"
  chown root:root "$DB_PASSWORD_FILE"
  chmod 600 "$DB_PASSWORD_FILE"
fi
DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"

psql_su -d postgres <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = '${DB_USER}') then
    create role ${DB_USER} login password '${DB_PASSWORD}';
  else
    alter role ${DB_USER} with login password '${DB_PASSWORD}';
  end if;
end
\$\$;
SQL

if ! sudo -u postgres psql -p "$DB_PORT" -tAc "select 1 from pg_database where datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -p "$DB_PORT" -O "$DB_USER" "$DB_NAME"
fi

# pg_trgm, installed HERE as the superuser because CREATE EXTENSION is a
# superuser operation and the migrations that need it
# (20260722020000-user-search-trgm, 20260723000000-search-indexes) run as the
# app role.
#
# Those migrations still issue `CREATE EXTENSION IF NOT EXISTS pg_trgm` and that
# is fine: when the extension already exists PostgreSQL short-circuits on the
# existence check and never reaches the privilege check, so a non-superuser gets
# a "already exists, skipping" notice rather than a permission error. Measured
# against a real PostgreSQL, not assumed.
#
# The consequence for later work: a migration that introduces a NEW extension
# will fail on this box. Add it here and re-run provision.sh (which is safe to
# re-run) before deploying it.
psql_su -d "$DB_NAME" -c "create extension if not exists pg_trgm;"

# ─── Environment file ─────────────────────────────────────────────────────────
# A systemd EnvironmentFile, i.e. real process environment. Real environment
# variables outrank any .env file on disk, and no .env is ever placed in the
# deploy directory where a stale copy could shadow a rotated secret.
#
# deploy.sh also sources this file with `.` for the migration step, so values
# containing spaces or shell metacharacters are quoted. systemd strips the
# quotes; so does sh.
API_ENV="$CONFIG_DIR/api.env"

if [[ -f "$API_ENV" ]]; then
  warn "$API_ENV exists — leaving it alone (regenerating JWT_SECRET would log every user out)"
else
  log "Generating $API_ENV"
  JWT_VALUE="$(openssl rand -base64 48 | tr -d '\n')"

  cat > "$API_ENV" <<ENV
# IOVibe API — production environment. Generated by deploy/provision.sh.
# Loaded by systemd (iovibe-api.service) and sourced by deploy/deploy.sh for
# migrations. Parsed as KEY=VALUE: no expansion, no command substitution.
#
# EVERY INTEGRATION BELOW IS PRESENT AND EMPTY ON PURPOSE. Each one is wired
# end-to-end and env-gated — an empty value disables that feature with a clean
# 503 or a no-op, never a crash. Fill one in and restart the service. A dummy
# value is worse than an empty one: it builds a live client that fails with a
# provider auth error instead of the 503 the design promises. See INTEGRATIONS.md.

NODE_ENV=production
# Loopback only: nginx is the sole thing that should be able to reach this
# process. Without this the listener binds 0.0.0.0 and the firewall becomes the
# only thing keeping port ${API_PORT} off the internet.
HOST=127.0.0.1
PORT=${API_PORT}
API_PREFIX=/v1
LOG_LEVEL=info

# ---------------------------------------------------------------- Database
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${DB_NAME}
# Postgres is on this host, listening on loopback only, and speaks plaintext —
# it would refuse a client demanding TLS. src/config/db.ts turns SSL ON by
# default in production, so this MUST stay false while the database is local.
# Set it true (with DB_SSL_CA_PATH) if the database ever moves off the box.
DB_SSL=false
DB_APP_NAME=iovibe-api
DB_POOL_MAX=10

# ---------------------------------------------------------------- Auth
# Losing this file is unrecoverable and rotating this value logs out every user
# holding a live token. Back it up somewhere other than this server.
JWT_SECRET=${JWT_VALUE}
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d
BCRYPT_ROUNDS=12

# ---------------------------------------------------------------- Commerce
TAX_RATE=0.08
SHIPPING_FLAT_CENTS=699

# ---------------------------------------------------------------- Realtime / CORS
# Browser origins only. The native app sends no Origin header and is always
# allowed regardless of this list, so it stays empty until there is a web client.
FRONTEND_URLS=
# Optional. Unset means the Socket.io in-memory adapter and in-memory rate-limit
# store, which is correct for ONE instance and silently wrong for two — rooms
# would not federate. Set it before running a second process.
REDIS_URL=

# ---------------------------------------------------------------- Media / S3
# Empty S3_BUCKET => video publishing, avatar upload and chat images all return
# 503. That is most of the app, so this is the first block to fill in.
# Any S3-compatible bucket works (AWS, Cloudflare R2, DigitalOcean Spaces).
# Objects must be publicly READABLE — playback URLs are persisted on rows and
# must not expire — while staying private for WRITE. INTEGRATIONS.md has the
# exact bucket policy, CORS rules and least-privilege IAM policy.
S3_BUCKET=
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
S3_ENDPOINT=
S3_FORCE_PATH_STYLE=
S3_UPLOAD_URL_TTL_SECONDS=900

# ---------------------------------------------------------------- Payments
# Empty STRIPE_SECRET_KEY => every payment path returns 503.
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# ---------------------------------------------------------------- Push (FCM)
# The whole service-account JSON, base64'd into one line. Empty => push sending
# is a silent no-op and everything else still works.
FCM_SERVICE_ACCOUNT_BASE64=

# ---------------------------------------------------------------- Email
# Empty SMTP_HOST => password-reset codes are generated but never delivered.
# The endpoints still succeed and still refuse to reveal whether an account
# exists, so this fails quietly — fill it in before real users.
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="IOVibe <no-reply@iovibe.app>"

# ---------------------------------------------------------------- Geocoding
# Server-side geocoding of event addresses. This is NOT the same key the app
# uses for its map: an Android key restricted by package name and SHA-1 is
# rejected for server-side Geocoding calls. Create a separate key (or an
# IP-restricted one) with the Geocoding API enabled.
# Empty => created events store null coordinates and the app deep-links to the
# maps app instead of drawing a pin.
GOOGLE_MAPS_API_KEY=

# ---------------------------------------------------------------- WebRTC
# STUN alone gets calls connected on ordinary networks. TURN is what makes them
# connect across symmetric NATs and mobile carriers — without it a real share of
# calls will fail. Twilio NTS, Metered, Cloudflare Calls or self-hosted coturn.
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_USERNAME=
TURN_CREDENTIAL=
ENV
  chown root:"$APP_USER" "$API_ENV"
  chmod 640 "$API_ENV"
fi

# ─── nginx ────────────────────────────────────────────────────────────────────
# One site file, one server_name. The neighbours' sites are separate files and
# are not read or written here — beyond the shared `nginx -t && reload`, which
# is unavoidable and is why the config test runs first.
log "Installing the nginx site for $SERVER_NAME"
NGINX_SITE=/etc/nginx/sites-available/iovibe.conf

if ! command -v nginx >/dev/null 2>&1 && [[ ! -x /usr/sbin/nginx ]]; then
  fail "nginx is not installed. It should already be on this box from TradeToBuild's provisioning."
fi

if [[ -f "$NGINX_SITE" ]] && grep -q 'ssl_certificate' "$NGINX_SITE"; then
  warn "$NGINX_SITE already has TLS blocks (certbot has edited it) — not overwriting"
else
  sed -e "s/__SERVER_NAME__/${SERVER_NAME}/g" -e "s/__API_PORT__/${API_PORT}/g" \
    "$REPO_DIR/deploy/nginx/iovibe.conf.template" > "$NGINX_SITE"
fi
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/iovibe.conf
nginx -t
systemctl reload nginx

# ─── systemd unit ─────────────────────────────────────────────────────────────
log "Installing the systemd unit"
sed "s/__PG_UNIT__/postgresql@${PG_MAJOR}-${PG_CLUSTER}.service/" \
  "$REPO_DIR/deploy/systemd/iovibe-api.service" > /etc/systemd/system/iovibe-api.service
chmod 644 /etc/systemd/system/iovibe-api.service
systemctl daemon-reload
systemctl enable iovibe-api

# ─── Firewall ─────────────────────────────────────────────────────────────────
# ufw is already enabled and already allows OpenSSH and Nginx Full, which is
# everything IOVibe needs — the API and the database are both loopback-bound.
# Nothing to open; say so rather than silently doing nothing.
log "Firewall"
if command -v ufw >/dev/null 2>&1; then
  printf '    %s\n' "$(ufw status | head -1)"
  printf '    No new rules needed: API is on 127.0.0.1:%s and Postgres on 127.0.0.1:%s.\n' "$API_PORT" "$DB_PORT"
fi

# ─── Next steps ───────────────────────────────────────────────────────────────
cat <<NEXT

$(log "Provisioning complete")

Next, on this server:

    1. Build, migrate and start:

         bash ${APP_DIR}/deploy/deploy.sh

    2. Fill in S3_BUCKET and its credentials in ${API_ENV}, then
       restart — until you do, video publishing, avatar upload and chat
       images all return 503:

         systemctl restart iovibe-api

The API will answer on:

    http://${SERVER_NAME}/v1        (plain HTTP — there is no domain, so there
    ws://${SERVER_NAME}              is no certificate; see deploy/README.md)

Secrets live in ${API_ENV} and exist nowhere else.
Back that file up off this server — losing JWT_SECRET is unrecoverable.

NEXT
