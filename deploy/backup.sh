#!/usr/bin/env bash
#
# IOVibe — nightly backup.
#
#   bash /srv/iovibe/app/deploy/backup.sh
#
# Install as a nightly job. 04:10, deliberately not 03:15 (TradeToBuild's) or
# 03:40 (DocBuddy's): the box has two cores and three apps dumping at once would
# contend for them.
#   ( crontab -l 2>/dev/null; echo '10 4 * * * /srv/iovibe/app/deploy/backup.sh >> /var/log/iovibe-backup.log 2>&1' ) | crontab -
#
# There is no upload directory to archive: media goes straight from the phone to
# S3 through presigned URLs and never lands on this disk. The database plus
# api.env really is the whole of the state that lives here — the bucket is
# backed up by whoever owns the bucket.
#
# These land on the same disk as the thing they protect, which covers a bad
# migration or an accidental delete and none of the cases that lose the VPS.
# Copy BACKUP_DIR off this box, or this is a snapshot, not a backup.
set -euo pipefail

CONFIG_DIR="${CONFIG_DIR:-/etc/iovibe}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/iovibe}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
PG_MAJOR="${PG_MAJOR:-17}"

[[ $EUID -eq 0 ]] || { echo "Run as root"; exit 1; }

set -a
# shellcheck disable=SC1091
. "$CONFIG_DIR/api.env"
set +a

: "${DATABASE_URL:?DATABASE_URL missing from $CONFIG_DIR/api.env}"

# The version-matched binary matters: this box also carries PostgreSQL 16 for
# TradeToBuild, and /usr/bin/pg_dump points at whichever client packaging won.
# A 16 pg_dump refuses to dump a 17 server with a "server version mismatch"
# that reads like a connection problem.
PG_DUMP="/usr/lib/postgresql/${PG_MAJOR}/bin/pg_dump"
[[ -x "$PG_DUMP" ]] || { echo "$PG_DUMP not found — is PostgreSQL ${PG_MAJOR} installed?"; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# -Fc (custom format) so a single table can be restored without replaying the
# whole dump:  pg_restore -d iovibe -t <table> <file>
#
# The app role owns every object it created, so the runtime URL dumps everything
# — there is no RLS here to silently filter rows out of a dump taken with the
# wrong identity.
#
# Dumped to a temporary name and published only on success. A shell redirect is
# created before the command runs, so failing in place would leave a zero-byte
# file that looks like a backup until the retention sweep below deletes the last
# good one.
if "$PG_DUMP" --dbname="$DATABASE_URL" --format=custom --no-owner \
     > "$BACKUP_DIR/db-$STAMP.dump.partial"; then
  mv "$BACKUP_DIR/db-$STAMP.dump.partial" "$BACKUP_DIR/db-$STAMP.dump"
else
  rm -f "$BACKUP_DIR/db-$STAMP.dump.partial"
  echo "$(date -u +%FT%TZ) backup FAILED: pg_dump error" >&2
  exit 1
fi

# api.env holds JWT_SECRET and the database password, and exists in exactly one
# place. Cheapest thing here to copy, most expensive to lose.
install -m 600 "$CONFIG_DIR/api.env" "$BACKUP_DIR/api.env-$STAMP"

find "$BACKUP_DIR" -maxdepth 1 -type f -mtime "+$RETAIN_DAYS" -delete

echo "$(date -u +%FT%TZ) backup ok: $(du -sh "$BACKUP_DIR" | cut -f1) in $BACKUP_DIR"
