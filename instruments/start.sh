#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose -f compose.yml up -d --build --wait
exec sh bridge/start.sh "$@"
