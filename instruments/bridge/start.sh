#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
if [ "${1:-}" = "--foreground" ]; then
    shift
elif [ "$(uname -s)" = "Darwin" ] && [ "${1:-}" != "--list-audio" ]; then
    exec .venv/bin/python service.py install "$@"
fi
exec .venv/bin/python host.py "$@"
