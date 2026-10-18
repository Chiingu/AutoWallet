#!/bin/bash

set -e

echo "[entrypoint] starting AutoWallet backend..."

DB_HOST="${POSTGRES_HOST}"
DB_PORT="${POSTGRES_PORT}"

if [[ "$DATABASE_URL" == postgresql* ]]; then
    python - <<'EOF'
import os, sys, time

import psycopg2

host = os.environ.get("POSTGRES_HOST", "postgres")
port = os.environ.get("POSTGRES_PORT", "5432")
deadline = time.time() + 30
while True:
    try:
        psycopg2.connect(
            host=host, port=port,
            dbname=os.environ.get("POSTGRES_DB"),
            user=os.environ.get("POSTGRES_USER"),
            password=os.environ.get("POSTGRES_PASSWORD"),
            connect_timeout=2,
        ).close()
        print(f"[entrypoint] postgres is up at {host}:{port}")
        sys.exit(0)
    except Exception as e:
        if time.time() > deadline:
            print(f"[entrypoint] FATAL: postgres never became ready: {e}", file=sys.stderr)
            sys.exit(1)
        time.sleep(1)
EOF
else
    echo "[entrypoint] not using postgres (DATABASE_URL=$DATABASE_URL) — skipping wait"
fi

if [ -n "$DATABASE_URL" ]; then
    echo "[entrypoint] applying migrations..."
    alembic upgrade head
else
    echo "[entrypoint] WARNING: no DATABASE_URL set — skipping migrations"
fi

echo "[entrypoint] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
