#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT/Overlord-Server"
BUN_BIN="${BUN_BIN:-bun}"

cd "$SERVER_DIR"
if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
	echo "[server] bun not found. Set BUN_BIN to your bun binary or install bun for this environment." >&2
	exit 1
fi
echo "[server] using bun at: $(command -v $BUN_BIN)"
echo "[server] bun install..."
"$BUN_BIN" install
echo "[server] starting bun start"
PORT="${PORT:-5173}" \
HOST="${HOST:-0.0.0.0}" \
OVERLORD_USER="${OVERLORD_USER:-admin}" \
OVERLORD_PASS="${OVERLORD_PASS:-admin}" \
"$BUN_BIN" run start
