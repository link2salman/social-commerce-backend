#!/usr/bin/env bash
#
# IOVibe API — build and release. Run on the server, as root, for every deploy
# after provision.sh has run once:
#
#   bash /srv/iovibe/app/deploy/deploy.sh          # pull, build, migrate, restart
#   bash deploy/deploy.sh --no-pull                # build what's already checked out
#   bash deploy/deploy.sh --skip-migrate           # code-only release
#
# Migrations run here rather than from the service unit: a unit that migrates on
# start would race itself on every restart, and sequelize-cli is a devDependency
# the running service never loads.
set -euo pipefail

APP_USER="${APP_USER:-iovibe}"
APP_DIR="${APP_DIR:-/srv/iovibe/app}"
CONFIG_DIR="${CONFIG_DIR:-/etc/iovibe}"

PULL=1
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)      PULL=0 ;;
    --skip-migrate) MIGRATE=0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[x]\033[0m %s\n' "$*"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root (sudo bash deploy/deploy.sh)"
[[ -f "$CONFIG_DIR/api.env" ]] || fail "$CONFIG_DIR/api.env missing — run deploy/provision.sh first"

# Everything below runs as the service user, in the tree it owns: a root-owned
# node_modules leaves the service unable to read its own dependencies, and git
# refuses to operate on a tree it considers someone else's ("dubious
# ownership"). -H points npm's cache at that user's home rather than root's.
as_app() { sudo -H -u "$APP_USER" "$@"; }
in_app() { ( cd "$1" && shift && sudo -H -u "$APP_USER" "$@" ); }

cd "$APP_DIR"

# Defaults to whatever this checkout is already on, NOT to `main`. Hardcoding
# main is a quiet way to ship the wrong thing: if the server tracks a branch,
# `git reset --hard origin/main` rolls the running API backwards while leaving
# the database at the newer schema — a rollback nobody asked for, triggered by
# the command you run for an ordinary deploy.
#
# Computed AS THE SERVICE USER, and this is not a detail. The tree belongs to
# $APP_USER, and git refuses to report on a tree it considers someone else's
# ("dubious ownership") even for root. Asking as root fails, and a
# `|| echo main` fallback then turns that failure into a silent deploy of the
# wrong branch — which is exactly what happened on the first run of this script.
# So: ask as the owner, and fail loudly if the answer is empty.
if [[ -z "${BRANCH:-}" ]]; then
  BRANCH="$(as_app git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [[ -n "$BRANCH" ]] || fail "could not read the checked-out branch in $APP_DIR.
  Pass it explicitly:  BRANCH=main bash deploy/deploy.sh"
fi

# Read the port from the config rather than assuming it — provision.sh takes
# API_PORT as an override and the health checks below have to follow it.
API_PORT="$(grep -E '^PORT=' "$CONFIG_DIR/api.env" | tail -1 | cut -d= -f2)"
API_PORT="${API_PORT:-5200}"

# ─── Source ───────────────────────────────────────────────────────────────────
if [[ $PULL -eq 1 ]]; then
  log "Fetching origin/$BRANCH"
  as_app git fetch --prune origin
  # Destroys uncommitted edits under $APP_DIR. Configuration lives in
  # $CONFIG_DIR, outside the repo, precisely so a deploy cannot touch it.
  as_app git reset --hard "origin/$BRANCH"
fi
log "Deploying $(as_app git rev-parse --short HEAD) — $(as_app git log -1 --pretty=%s)"

# ─── Build ────────────────────────────────────────────────────────────────────
# --include=dev is not redundant: npm omits devDependencies whenever NODE_ENV is
# production, and without them there is no tsc to build with and no
# sequelize-cli to migrate with. Neither reaches the running process, which
# executes only dist/.
log "Installing dependencies"
in_app "$APP_DIR" npm ci --include=dev

log "Building"
in_app "$APP_DIR" npm run build

# `npm run build` is `tsc && cp src/config/config.cjs dist/config/config.cjs`.
# The copy matters at runtime as well as for migrations, and a silent failure
# there would surface as a crash loop under systemd rather than as a build error
# here.
[[ -f dist/server.js ]]        || fail "dist/server.js is missing — the TypeScript build did not produce an entrypoint"
[[ -f dist/worker.js ]]        || fail "dist/worker.js is missing — iovibe-worker.service has nothing to run"
[[ -f dist/config/config.cjs ]] || fail "dist/config/config.cjs is missing — the build's copy step did not run"

# ─── Migrate ──────────────────────────────────────────────────────────────────
if [[ $MIGRATE -eq 1 ]]; then
  log "Running migrations"
  # `npm run migrate` is NOT used: it wraps dotenv-cli around .env.development,
  # and there is no .env file on this server by design.
  #
  # api.env is sourced INSIDE the sudo'd shell, not out here — sudo sanitises the
  # environment, so anything exported by a `set -a` in this script would never
  # reach the child. Enumerating the needed variables through `env` would work
  # but rots silently every time the config gains a field, so the child reads the
  # same file systemd does. api.env is 640 root:iovibe, which the service user
  # can read.
  #
  # One identity: `iovibe` owns the database and runs both the migrations and the
  # app. See the comment in provision.sh for why this deployment does not copy
  # DocBuddy's superuser/runtime split.
  in_app "$APP_DIR" sh -c '
    set -a
    . "$1"
    set +a
    exec npx sequelize-cli db:migrate --config src/config/config.cjs --migrations-path migrations
  ' _ "$CONFIG_DIR/api.env"
fi

# ─── Release ──────────────────────────────────────────────────────────────────
# BOTH long-running units run out of the same dist/ that was just rebuilt, so
# restarting only the API leaves the worker executing the previous release's
# code — including, until this was fixed, no release at all.
log "Restarting iovibe-api and iovibe-worker"
systemctl restart iovibe-api iovibe-worker

# ─── Verify ───────────────────────────────────────────────────────────────────
log "Waiting for health checks"

# Liveness first: is the process up and answering at all? /live never touches a
# dependency, so it separates "the process died" from "the database is down".
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/live" >/dev/null 2>&1; then
    printf '    api   live\n'
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    printf '\n'; journalctl -u iovibe-api -n 40 --no-pager
    fail "the API never became live on port ${API_PORT}"
  fi
  sleep 2
done

# Readiness second, and it is the one that matters: /health returns 503 unless
# the database (and Redis, when configured) actually answer. A process that is
# live but not ready serves 500s for every real request, which liveness alone
# would happily call a successful deploy.
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    printf '    api   ready (database reachable)\n'
    break
  fi
  if [[ $attempt -eq 15 ]]; then
    printf '\n'
    curl -sS --max-time 5 "http://127.0.0.1:${API_PORT}/health" || true
    printf '\n'; journalctl -u iovibe-api -n 40 --no-pager
    fail "the API is live but not ready — it cannot reach the database"
  fi
  sleep 2
done

# Restart=always means a crash loop still reports "active", so check that each
# unit has settled rather than merely started. The worker has no HTTP surface to
# probe, so this is the only signal that it actually came up — and a worker that
# dies on boot is invisible otherwise: nothing 500s, videos just never transcode.
for unit in iovibe-api iovibe-worker; do
  restarts="$(systemctl show -p NRestarts --value "$unit" || echo 0)"
  sleep 5
  if [[ "$(systemctl show -p NRestarts --value "$unit" || echo 0)" != "$restarts" ]]; then
    printf '\n'; journalctl -u "$unit" -n 40 --no-pager
    fail "$unit is restarting in a loop"
  fi
done

log "Deployed"
systemctl --no-pager --lines=0 status iovibe-api iovibe-worker | grep -E 'iovibe|Active:'
