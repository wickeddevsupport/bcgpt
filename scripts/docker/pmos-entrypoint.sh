#!/usr/bin/env bash
set -euo pipefail

node /app/scripts/prime-openclaw-state.mjs

exec "$@"
