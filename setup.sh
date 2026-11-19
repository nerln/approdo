#!/usr/bin/env bash
# Kept for compatibility: the setup is scripts/setup.mjs (Node.js, no secret passes through it).
exec node "$(dirname "$0")/scripts/setup.mjs" "$@"
