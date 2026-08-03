#!/usr/bin/env bash
#
# IOVibe API — one-time provisioning for the shared InterServer VPS.
#
# This box already runs TWO other applications: TradeToBuild (nginx, Node 24,
# PostgreSQL 16 on 5432, an Express API on 5000) and DocBuddy (an API on 5100,
# PostgreSQL 17 on 5433). IOVibe is the THIRD tenant, so this script is narrow
# by design: it never touches nginx's global config, never runs certbot, and
# never goes near the neighbours' clusters or units.
#
# What it owns:
#   * a PostgreSQL 17 cluster named `iovibe` on port 5434, alongside 16/main
#     (5432) and 17/main (5433)
#   * the `iovibe` service user, /srv/iovibe and /etc/iovibe
#   * the database and the `iovibe` login role that owns it
#   * /etc/iovibe/api.env
#   * one nginx site and the iovibe-* systemd units (api, worker, sweep report
#     timer, sweep reclaim timer)
#   * coturn: /etc/turnserver.conf, /etc/default/coturn and the `coturn` unit —
#     a self-hosted TURN relay, because two phones on mobile data cannot connect
#     a call without one and every hosted relay is metered
#
# It DOES add firewall rules now, and only these: the TURN listener (3478
# udp+tcp), coturn's relay port range, and 5349/tcp when TURN-over-TLS is
# configured. A relay the internet cannot reach is not a relay. Nothing else is
# opened — the API and every database stay loopback-bound.
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
# whose phone is holding a live token. The one thing a re-run does rewrite in
# that file is the TURN block, because this script owns both ends of it and the
# secret there must equal the one in /etc/turnserver.conf. That secret is itself
# generated once and kept in ${CONFIG_DIR}/.turnsecret.
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

# ─── TURN relay (coturn) ──────────────────────────────────────────────────────
# Self-hosted, because a relay is the difference between "calls work" and "calls
# work unless both people are on mobile data", and every hosted TURN service is
# metered. This box already pays for bandwidth; see INTEGRATIONS.md § 7 for what
# relaying actually costs.
TURN_PORT="${TURN_PORT:-3478}"
TURN_TLS_PORT="${TURN_TLS_PORT:-5349}"
# The relay port range IS the concurrency ceiling: coturn burns one UDP port per
# allocation, and a fully-relayed 1:1 call is one allocation per peer. 101 ports
# ≈ 50 relayed peers ≈ 25 relayed calls at once. Bandwidth, not ports, is the
# limit that actually bites — see TURN_BPS_CAPACITY below.
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49260}"
# Allocations per credential. A 1:1 call negotiates one allocation when the SDP
# bundles (it does), three if a peer ever stops bundling — 6 leaves room for a
# second call and a reconnect without letting one account hold the whole relay.
TURN_USER_QUOTA="${TURN_USER_QUOTA:-6}"
TURN_TOTAL_QUOTA="${TURN_TOTAL_QUOTA:-100}"
# Bytes per second, per session and server-wide, counted per direction.
#   per session 500000 B/s  = 4 Mbit/s   (a 1:1 video call needs 1–3)
#   server-wide 2500000 B/s = 20 Mbit/s  ≈ 10 concurrent relayed video calls
# 20 Mbit/s saturated around the clock is ~6.5 TB/month, which is the honest
# worst case this ceiling permits. Raise it against your VPS's actual transfer
# allowance, not optimistically.
TURN_MAX_BPS="${TURN_MAX_BPS:-500000}"
TURN_BPS_CAPACITY="${TURN_BPS_CAPACITY:-2500000}"

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

# ─── TURN relay (coturn) ──────────────────────────────────────────────────────
#
# STUN alone connects two peers only when at least one of them can be reached at
# a predictable address. Two phones on mobile data are both behind carrier-grade
# NAT, which is symmetric: the address each peer learns from STUN is bound to the
# STUN server's socket and is useless to the other side. Those calls ring and
# never connect. A TURN relay fixes it by being the reachable address for both —
# every packet goes through this box.
#
# So this is the fourth thing the script owns: the coturn package, its unit,
# /etc/turnserver.conf, and the shared secret it splits with the API.
log "Installing and configuring coturn (self-hosted TURN relay)"

if ! command -v turnserver >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq coturn \
    || fail "could not install coturn. Without it, calls between two peers on mobile data
  will not connect — this is not an optional package for this application."
else
  log "coturn already installed"
fi

# The shared secret. Same discipline as the database password: generated once,
# root-only, and NEVER regenerated on a re-run — the API mints credentials from
# it and rotating it invalidates every credential a phone is currently holding,
# which drops live calls and breaks the next ones until the app refetches.
TURN_SECRET_FILE="$CONFIG_DIR/.turnsecret"
if [[ ! -f "$TURN_SECRET_FILE" ]]; then
  log "Generating the TURN shared secret"
  openssl rand -hex 32 > "$TURN_SECRET_FILE"
  chown root:root "$TURN_SECRET_FILE"
  chmod 600 "$TURN_SECRET_FILE"
fi
TURN_SECRET="$(cat "$TURN_SECRET_FILE")"

# coturn must advertise the address a phone on the internet can actually reach.
# On this VPS the public address is bound directly to the interface, so there is
# nothing to translate; `external-ip` is emitted only if that stops being true
# (a 1:1-NAT cloud instance), where omitting it makes the relay hand out an
# RFC1918 candidate that nothing can connect to.
TURN_PRIVATE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null \
  | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)"
if [[ "$SERVER_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  TURN_PUBLIC_IP="${TURN_PUBLIC_IP:-$SERVER_NAME}"
else
  TURN_PUBLIC_IP="${TURN_PUBLIC_IP:-$TURN_PRIVATE_IP}"
fi

TURN_EXTERNAL_IP_LINE="# external-ip: not needed, the public address is on the interface itself"
if [[ -n "$TURN_PUBLIC_IP" && -n "$TURN_PRIVATE_IP" && "$TURN_PUBLIC_IP" != "$TURN_PRIVATE_IP" ]]; then
  TURN_EXTERNAL_IP_LINE="external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}"
  warn "this host's public IP (${TURN_PUBLIC_IP}) differs from its interface IP (${TURN_PRIVATE_IP}) — emitting external-ip"
fi

# TLS on 5349. Only if a real certificate exists for this server_name, and a
# bare IP can never have one: a `turns:` URL is verified against the hostname,
# and no CA issues for an IP address. So the honest outcome today is plain 3478
# (UDP *and* TCP — TCP is what gets through networks that block UDP), and the
# TLS block appears by itself once IOVibe has a domain with a certbot cert.
TURN_TLS=0
TURN_CERT_DIR="/etc/letsencrypt/live/${SERVER_NAME}"
if [[ "$SERVER_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  warn "server_name is a bare IP, so there is no certificate to serve TURN-over-TLS with.
    Configuring plain TURN on ${TURN_PORT}/udp + ${TURN_PORT}/tcp. That still relays every
    call; what it does not do is look like HTTPS to a firewall that only allows 443."
elif [[ -r "${TURN_CERT_DIR}/fullchain.pem" && -r "${TURN_CERT_DIR}/privkey.pem" ]]; then
  TURN_TLS=1
  log "Found a certificate for ${SERVER_NAME} — enabling TURN over TLS on ${TURN_TLS_PORT}"
else
  warn "no certificate at ${TURN_CERT_DIR} — configuring plain TURN on ${TURN_PORT} only.
    Run certbot for this domain and re-run this script to add TURN-over-TLS."
fi

if [[ "$TURN_TLS" -eq 1 ]]; then
  # coturn runs as the unprivileged `turnserver` user; certbot writes private
  # keys root-only. Grant read on IOVibe's OWN certificate lineage and nothing
  # else — the neighbours' keys stay untouched, and g+x on the shared parents
  # only permits traversal, never reading a directory's contents.
  getent group ssl-cert >/dev/null 2>&1 || groupadd --system ssl-cert
  if id -u turnserver >/dev/null 2>&1; then usermod -aG ssl-cert turnserver; fi
  chmod g+x /etc/letsencrypt/live /etc/letsencrypt/archive
  chgrp -R ssl-cert "$TURN_CERT_DIR" "/etc/letsencrypt/archive/${SERVER_NAME}"
  chmod -R g+rX "$TURN_CERT_DIR" "/etc/letsencrypt/archive/${SERVER_NAME}"

  # RENEWAL. Every ~60 days certbot writes a NEW privkeyN.pem as root:root 0600
  # and relinks live/. Without this hook the grant above evaporates and coturn
  # fails to start on its next restart — weeks after the change that caused it,
  # which is the worst kind of outage to diagnose. The hook re-applies the grant
  # and restarts coturn (a restart, not a reload: coturn does not re-read its
  # certificate in place). It drops any call being relayed at that instant,
  # roughly once every two months, which is the right trade against serving an
  # expired certificate.
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  sed "s/__SERVER_NAME__/${SERVER_NAME}/g" \
    "$REPO_DIR/deploy/coturn/renewal-hook.sh.template" \
    > /etc/letsencrypt/renewal-hooks/deploy/iovibe-coturn.sh
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/iovibe-coturn.sh
fi

TURN_CONF=/etc/turnserver.conf
TURN_CONF_NEW="$(mktemp)"

cat > "$TURN_CONF_NEW" <<TURNCONF
# IOVibe TURN relay — GENERATED by deploy/provision.sh. Edits here are lost on
# the next run; change the script instead.
#
# Self-hosted on this box on purpose: TURN is metered by every vendor that sells
# it, and the only calls that touch a relay are the ones that cannot go
# peer-to-peer. See INTEGRATIONS.md § 7 for the bandwidth arithmetic.

# ── Listeners ────────────────────────────────────────────────────────────────
# 3478 on both transports. UDP is the fast path; TCP is the fallback for
# networks that drop UDP outright, and costs nothing to offer.
listening-port=${TURN_PORT}
${TURN_EXTERNAL_IP_LINE}
# Sign every message. Cheap, and it lets both ends detect a mangled/spoofed
# packet instead of silently failing to connect.
fingerprint

# ── Authentication: time-limited REST credentials ────────────────────────────
# NOT a static username/password. This server's credential is computed, not
# stored: the client presents  <unix-expiry>:<userId>  as the username and
# base64(HMAC-SHA1(username, static-auth-secret)) as the password, and coturn
# recomputes the same HMAC to verify it. src/services/callService.ts mints them.
#
# The reason is blunt: a static TURN password lives in the app binary, where
# anyone can read it out of an APK, and it never expires. That is a free relay
# for whoever finds it, paid for in this VPS's bandwidth. A minted credential
# expires and names the account it was issued to.
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${SERVER_NAME}
# Nonce lifetime. 10 minutes forces periodic re-auth without churning
# mid-call.
stale-nonce=600

# ── Relay port range ─────────────────────────────────────────────────────────
# One UDP port per allocation. This range is also what has to be open in ufw.
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
# WebRTC never asks for a TCP *relay* allocation (RFC 6062) — it uses TCP only
# to reach the server. Refusing them removes an entire class of tunnelling
# through this box.
no-tcp-relay

# ── What the relay may NOT be pointed at ─────────────────────────────────────
# THE most important block in this file. A TURN server forwards UDP to whatever
# peer address a client names, so an unrestricted relay is a general-purpose
# SSRF pivot: an attacker with a credential could aim it at 127.0.0.1:${DB_PORT}
# and reach the IOVibe PostgreSQL cluster, or at 127.0.0.1:${API_PORT} and reach the
# API behind nginx, or at 169.254.169.254 for cloud instance metadata — all from
# inside the network boundary, sourced from the box itself.
#
# So: deny every address that is not a public internet host. These are ranges,
# not CIDRs, because that is coturn's syntax.
no-multicast-peers
# 0.0.0.0/8      "this network"
denied-peer-ip=0.0.0.0-0.255.255.255
# 10/8, 172.16/12, 192.168/16 — RFC 1918 private space
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
# 100.64/10 — RFC 6598 carrier-grade NAT space
denied-peer-ip=100.64.0.0-100.127.255.255
# 127/8 — loopback. This is the line that keeps the relay away from PostgreSQL
# on 127.0.0.1:${DB_PORT} and the API on 127.0.0.1:${API_PORT}.
denied-peer-ip=127.0.0.0-127.255.255.255
# 169.254/16 — link-local, and with it 169.254.169.254 (cloud metadata)
denied-peer-ip=169.254.0.0-169.254.255.255
# 192.0.0.0/24 IETF assignments, 192.0.2.0/24 TEST-NET-1,
# 192.88.99.0/24 6to4 anycast, 198.18/15 benchmarking,
# 198.51.100.0/24 TEST-NET-2, 203.0.113.0/24 TEST-NET-3
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.88.99.0-192.88.99.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
# 224/4 multicast, 240/4 reserved (includes 255.255.255.255 broadcast)
denied-peer-ip=224.0.0.0-239.255.255.255
denied-peer-ip=240.0.0.0-255.255.255.255
# IPv6. ::ffff:0:0/96 matters as much as any line above: an IPv4-mapped IPv6
# address is how you would otherwise walk straight past every IPv4 deny here.
denied-peer-ip=::1
denied-peer-ip=::ffff:0.0.0.0-::ffff:255.255.255.255
# 64:ff9b::/96 — the well-known NAT64 prefix, i.e. IPv4 by another route
denied-peer-ip=64:ff9b::-64:ff9b::ffff:ffff
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# ── Quotas: what bounds the bill ─────────────────────────────────────────────
# Relayed traffic is this VPS's bandwidth. These are the ceilings.
# Allocations per credential, and server-wide.
user-quota=${TURN_USER_QUOTA}
total-quota=${TURN_TOTAL_QUOTA}
# Bytes per second, per session and in total, counted per direction.
max-bps=${TURN_MAX_BPS}
bps-capacity=${TURN_BPS_CAPACITY}

# ── Surface reduction ────────────────────────────────────────────────────────
# The admin CLI is a plaintext telnet listener on 5766. There is no use for it
# here and no password worth trusting it with.
no-cli
# Do not announce the exact coturn build to every client.
no-software-attribute
# Log through syslog → journald (journalctl -u coturn), so logs rotate with
# everything else instead of growing a file nobody watches.
syslog
TURNCONF

if [[ "$TURN_TLS" -eq 1 ]]; then
  cat >> "$TURN_CONF_NEW" <<TURNTLS

# ── TLS ──────────────────────────────────────────────────────────────────────
# The same certbot certificate nginx serves. Renewal re-applies the group grant
# and restarts coturn: /etc/letsencrypt/renewal-hooks/deploy/iovibe-coturn.sh.
tls-listening-port=${TURN_TLS_PORT}
cert=${TURN_CERT_DIR}/fullchain.pem
pkey=${TURN_CERT_DIR}/privkey.pem
no-tlsv1
no-tlsv1_1
TURNTLS
else
  cat >> "$TURN_CONF_NEW" <<'TURNNOTLS'

# ── TLS: deliberately off ────────────────────────────────────────────────────
# There is no certificate for this server_name (see deploy/provision.sh). Saying
# so explicitly beats leaving coturn to open a TLS port it has nothing to serve
# on and log a certificate error every start. Media is DTLS-SRTP encrypted end
# to end regardless — TURN-over-TLS hides the *signalling to the relay*, it is
# not what protects the call.
no-tls
no-dtls
TURNNOTLS
fi

# Write only on change, so a re-run does not restart the relay (and drop live
# calls) for nothing.
TURN_RESTART=0
if [[ -f "$TURN_CONF" ]] && cmp -s "$TURN_CONF_NEW" "$TURN_CONF"; then
  log "$TURN_CONF already current"
else
  # Contains the shared secret, so: not world-readable. Group `turnserver` is
  # the user the Debian unit drops to.
  if getent group turnserver >/dev/null 2>&1; then
    install -o root -g turnserver -m 640 "$TURN_CONF_NEW" "$TURN_CONF"
  else
    install -o root -g root -m 600 "$TURN_CONF_NEW" "$TURN_CONF"
  fi
  log "Wrote $TURN_CONF"
  TURN_RESTART=1
fi
rm -f "$TURN_CONF_NEW"

# Debian/Ubuntu ship coturn switched OFF: /etc/default/coturn carries a
# commented-out TURNSERVER_ENABLED and the packaged start-up refuses to launch
# the daemon until it is set. Without this the service "starts" and there is no
# relay, which looks exactly like a firewall problem.
COTURN_DEFAULT=/etc/default/coturn
if [[ -f "$COTURN_DEFAULT" ]] && grep -qE '^[[:space:]]*#?[[:space:]]*TURNSERVER_ENABLED=' "$COTURN_DEFAULT"; then
  if ! grep -qE '^[[:space:]]*TURNSERVER_ENABLED=1[[:space:]]*$' "$COTURN_DEFAULT"; then
    sed -i 's/^[[:space:]]*#\?[[:space:]]*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' "$COTURN_DEFAULT"
    log "Enabled TURNSERVER_ENABLED in $COTURN_DEFAULT"
    TURN_RESTART=1
  fi
elif ! grep -qs '^TURNSERVER_ENABLED=1' "$COTURN_DEFAULT"; then
  printf 'TURNSERVER_ENABLED=1\n' >> "$COTURN_DEFAULT"
  log "Added TURNSERVER_ENABLED=1 to $COTURN_DEFAULT"
  TURN_RESTART=1
fi

systemctl enable coturn >/dev/null 2>&1 || true
# `|| true` on both, so a failure lands on the diagnostic below rather than on
# `set -e` exiting with nothing but a non-zero status.
if ! systemctl is-active --quiet coturn; then
  systemctl start coturn || true
elif [[ "$TURN_RESTART" -eq 1 ]]; then
  warn "restarting coturn to pick up the new config — any call being relayed right now will drop"
  systemctl restart coturn || true
fi
systemctl is-active --quiet coturn \
  || fail "coturn did not start. Check: journalctl -u coturn -n 50 --no-pager
  A rejected option in /etc/turnserver.conf and an unreadable certificate both
  look like this."

# What the app is told to dial. UDP first (the fast path), TCP second (for
# networks that drop UDP), TLS last when there is a certificate for it.
TURN_URLS_VALUE="turn:${SERVER_NAME}:${TURN_PORT}?transport=udp,turn:${SERVER_NAME}:${TURN_PORT}?transport=tcp"
if [[ "$TURN_TLS" -eq 1 ]]; then
  TURN_URLS_VALUE="${TURN_URLS_VALUE},turns:${SERVER_NAME}:${TURN_TLS_PORT}?transport=tcp"
fi
# coturn answers STUN on the same port, so the app can stop depending on
# Google's public server for the common case. Google stays as the fallback for
# when this box is the thing that is down.
STUN_URLS_VALUE="stun:${SERVER_NAME}:${TURN_PORT},stun:stun.l.google.com:19302"

# ─── Environment file ─────────────────────────────────────────────────────────
# A systemd EnvironmentFile, i.e. real process environment. Real environment
# variables outrank any .env file on disk, and no .env is ever placed in the
# deploy directory where a stale copy could shadow a rotated secret.
#
# deploy.sh also sources this file with `.` for the migration step, so values
# containing spaces or shell metacharacters are quoted. systemd strips the
# quotes; so does sh.
API_ENV="$CONFIG_DIR/api.env"

# Upsert one KEY=value in an existing env file, in place, preserving everything
# else. Values go through the environment rather than into the awk program so a
# URL full of `:`, `?` and `,` cannot be mistaken for awk syntax.
env_set() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$file"; then
    KEY="$key" VALUE="$value" awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"] }
      index($0, k "=") == 1 { print k "=" v; next }
      { print }
    ' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  install -o root -g "$APP_USER" -m 640 "$tmp" "$file"
  rm -f "$tmp"
}

env_get() { sed -n "s/^$1=//p" "$2" | head -1; }

if [[ -f "$API_ENV" ]]; then
  warn "$API_ENV exists — leaving it alone (regenerating JWT_SECRET would log every user out)"

  # …with one exception: the TURN block. Those keys are not operator input —
  # this script owns both ends of them, and the secret here MUST equal the one
  # in /etc/turnserver.conf or every minted credential is rejected and the relay
  # is dead weight. So the TURN keys are synced, and nothing else in the file is
  # touched.
  log "Syncing the TURN keys in $API_ENV with $TURN_CONF"
  API_ENV_BEFORE="$(sha256sum "$API_ENV" | cut -d' ' -f1)"

  PREV_TURN_URLS="$(env_get TURN_URLS "$API_ENV")"
  if [[ -n "$PREV_TURN_URLS" && "$PREV_TURN_URLS" != "$TURN_URLS_VALUE" ]]; then
    warn "replacing TURN_URLS ('$PREV_TURN_URLS') with this box's own relay"
  fi
  env_set "$API_ENV" TURN_URLS "$TURN_URLS_VALUE"
  env_set "$API_ENV" TURN_STATIC_AUTH_SECRET "$TURN_SECRET"
  env_set "$API_ENV" TURN_CREDENTIAL_TTL_SECONDS 43200

  # STUN only if it is still the shipped default — an operator who chose their
  # own STUN list keeps it.
  if [[ "$(env_get STUN_URLS "$API_ENV")" == "stun:stun.l.google.com:19302" ]]; then
    env_set "$API_ENV" STUN_URLS "$STUN_URLS_VALUE"
  fi

  # A running API holds its environment from process start, so a changed file
  # means nothing until it restarts. Leaving that to the operator is how you get
  # a provisioned relay that no client is ever told about.
  if [[ "$(sha256sum "$API_ENV" | cut -d' ' -f1)" != "$API_ENV_BEFORE" ]] \
     && systemctl is-active --quiet iovibe-api; then
    log "TURN settings changed — restarting iovibe-api to load them"
    systemctl restart iovibe-api
  fi
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
# NOT BLANK, unlike every other integration above — because this one is not a
# third-party account, it is coturn running on this same box (installed and
# configured by this script). Nothing to sign up for and nothing to pay.
#
# STUN alone gets calls connected on ordinary networks. TURN is what makes them
# connect across symmetric NATs and mobile carriers — without it a real share of
# calls will fail.
STUN_URLS=${STUN_URLS_VALUE}
TURN_URLS=${TURN_URLS_VALUE}
# The shared secret from /etc/turnserver.conf. The API mints a short-lived,
# per-user credential from it on every GET /v1/calls/ice-servers — nothing
# long-lived is ever handed to a phone. These two values MUST stay equal; both
# come from ${TURN_SECRET_FILE}, which is why neither is regenerated on a re-run.
TURN_STATIC_AUTH_SECRET=${TURN_SECRET}
TURN_CREDENTIAL_TTL_SECONDS=43200
# Only for a relay that offers no shared secret. Ignored while the secret above
# is set, and this box's relay does not use them.
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

# ─── systemd units ────────────────────────────────────────────────────────────
# All of them. Installing only iovibe-api is why no clip was ever transcoded in
# production: dist/worker.js drains the transcode queue and nothing was running
# it, so every video stayed at its client upload forever. The units have been in
# deploy/systemd/ the whole time; nothing copied them.
log "Installing the systemd units"
for unit in iovibe-api.service iovibe-worker.service \
            iovibe-sweep.service iovibe-sweep.timer \
            iovibe-sweep-reclaim.service iovibe-sweep-reclaim.timer; do
  # __PG_UNIT__ is substituted wherever it appears and is a no-op where it does
  # not, which keeps one install path instead of two that can drift.
  sed "s/__PG_UNIT__/postgresql@${PG_MAJOR}-${PG_CLUSTER}.service/" \
    "$REPO_DIR/deploy/systemd/$unit" > "/etc/systemd/system/$unit"
  chmod 644 "/etc/systemd/system/$unit"
done
systemctl daemon-reload

# Enabled, NOT started. Both long-running services execute dist/, which does not
# exist until deploy.sh builds it — starting them here would just crash-loop them
# into systemd's start rate limit before the first deploy. deploy.sh starts both.
systemctl enable iovibe-api
systemctl enable iovibe-worker

# The timers are the exception: they schedule rather than execute, so there is
# nothing to build first, and --now is what arms them without waiting for a reboot.
# The .service units they drive are deliberately NOT enabled — both are oneshot
# and the timer is what pulls them in.
#
# Two timers, because they do different things and only one of them is dangerous:
#   iovibe-sweep.timer          midnight, reports orphans, deletes nothing
#   iovibe-sweep-reclaim.timer  03:00, deletes orphans unreferenced for 7+ days
# The reclaim timer is what makes storage self-heal without a human in the loop.
# It never touches superseded originals — that still takes --include-originals by
# hand, after reading a report.
systemctl enable --now iovibe-sweep.timer
systemctl enable --now iovibe-sweep-reclaim.timer

# ─── Firewall ─────────────────────────────────────────────────────────────────
# ufw is already enabled and already allows OpenSSH and Nginx Full. The API and
# the database stay loopback-bound and need nothing.
#
# coturn is the exception, and it is unavoidable: a relay that phones on the
# internet cannot reach is not a relay. Four rules, no more —
#   3478/udp                the TURN + STUN listener (the fast path)
#   3478/tcp                the same, for networks that drop UDP
#   min-port:max-port/udp   the relay allocations themselves; without this every
#                           call negotiates a relay candidate and then silently
#                           carries no media, which is worse than no TURN at all
#   5349/tcp                TURN over TLS, only when a certificate exists
# `ufw allow` is idempotent — a repeat run reports "Skipping adding existing rule".
log "Firewall"
if command -v ufw >/dev/null 2>&1; then
  printf '    %s\n' "$(ufw status | head -1)"
  printf '    API stays on 127.0.0.1:%s and Postgres on 127.0.0.1:%s — nothing opened for those.\n' \
    "$API_PORT" "$DB_PORT"
  log "Opening the TURN ports"
  ufw allow "${TURN_PORT}/udp"
  ufw allow "${TURN_PORT}/tcp"
  ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"
  if [[ "$TURN_TLS" -eq 1 ]]; then
    ufw allow "${TURN_TLS_PORT}/tcp"
  else
    printf '    %s/tcp left closed: TURN-over-TLS is not configured (no certificate).\n' "$TURN_TLS_PORT"
  fi
else
  warn "ufw is not installed — open ${TURN_PORT}/udp, ${TURN_PORT}/tcp and ${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp
    in whatever firewall this box uses, or the relay will never receive a packet."
fi

# ─── Next steps ───────────────────────────────────────────────────────────────
cat <<NEXT

$(log "Provisioning complete")

Next, on this server:

    1. Build, migrate and start:

         bash ${APP_DIR}/deploy/deploy.sh

    2. Fill in S3_BUCKET and its credentials in ${API_ENV}, then
       restart — until you do, video publishing, avatar upload and chat
       images all return 503, and the worker cannot transcode:

         systemctl restart iovibe-api iovibe-worker

    3. Check the relay actually relays. It is the one integration that is
       already configured, because it IS this box — no account, no bill:

         systemctl status coturn
         journalctl -u coturn -f

       Then, with a username/credential from GET /v1/calls/ice-servers, from a
       machine that is NOT this server:

         turnutils_uclient -v -u '<username>' -w '<credential>' -p ${TURN_PORT} ${SERVER_NAME}

       The end-to-end check is the WebRTC trickle-ice page with the same
       credentials: it must report a candidate of type "relay".
       See INTEGRATIONS.md § 7.

The API will answer on:

    http://${SERVER_NAME}/v1        (plain HTTP — there is no domain, so there
    ws://${SERVER_NAME}              is no certificate; see deploy/README.md)

Secrets live in ${API_ENV} and exist nowhere else.
Back that file up off this server — losing JWT_SECRET is unrecoverable.

NEXT
