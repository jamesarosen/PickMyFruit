#!/bin/sh
# Container entrypoint. When LITESTREAM_REPLICA_URL is set (production), the
# server runs under Litestream so every SQLite WAL frame is continuously
# replicated to object storage, and a fresh volume is restored from the
# replica before boot. When unset (preview apps, docker-compose, local), the
# server starts directly. See docs/0010-database-durability.md.
set -eu

server_cmd="node .output/server/index.mjs"

# Litestream needs a filesystem path; derive it from the libsql file: URL.
case "${DATABASE_URL:-}" in
	file://*) db_path="${DATABASE_URL#file://}" ;;
	file:*) db_path="${DATABASE_URL#file:}" ;;
	*) db_path="" ;;
esac

if [ -n "${LITESTREAM_REPLICA_URL:-}" ] && [ -n "$db_path" ]; then
	echo "litestream: restoring ${db_path} from replica if volume is empty"
	litestream restore -if-db-not-exists -if-replica-exists \
		-o "$db_path" "$LITESTREAM_REPLICA_URL"
	echo "litestream: starting server under replication"
	exec litestream replicate -exec "$server_cmd" "$db_path" "$LITESTREAM_REPLICA_URL"
fi

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
	# Replication was requested but DATABASE_URL is not a local file URL —
	# refuse to boot un-replicated rather than silently skip backups.
	echo "litestream: LITESTREAM_REPLICA_URL is set but DATABASE_URL is not a file: URL" >&2
	exit 1
fi

exec $server_cmd
