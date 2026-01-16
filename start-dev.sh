#!/usr/bin/env bash
set -eu
ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Dispatcher script kept for backwards compatibility.
# Usage:
#   ./start-dev.sh            # start server (background) and client (foreground)
#   ./start-dev.sh server     # start only server
#   ./start-dev.sh client     # start only client

SCRIPT_DIR="$ROOT"
SERVER_SCRIPT="$SCRIPT_DIR/start-dev-server.sh"
CLIENT_SCRIPT="$SCRIPT_DIR/start-dev-client.sh"

if [ "$#" -eq 0 ]; then
	# start server in background, then client in foreground (original behavior)
	echo "[start-dev] starting server (background) and client (foreground)"
	if [ -x "$SERVER_SCRIPT" ]; then
		"$SERVER_SCRIPT" &
		SERVER_PID=$!
		echo "[start-dev] server started (pid $SERVER_PID)"
	else
		echo "[start-dev] $SERVER_SCRIPT not found or not executable. Run \"chmod +x $SERVER_SCRIPT\" or run the scripts directly." >&2
		exit 1
	fi

	# Ensure we kill the server child if this script exits or receives a signal.
	cleanup() {
		echo "[start-dev] cleaning up"
		if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
			echo "[start-dev] killing server (pid $SERVER_PID)"
			kill "$SERVER_PID" 2>/dev/null || true
			sleep 1
			if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
				echo "[start-dev] server did not exit; force killing"
				kill -9 "$SERVER_PID" 2>/dev/null || true
			fi
		fi
	}
	trap cleanup INT TERM EXIT

	if [ -x "$CLIENT_SCRIPT" ]; then
		# run client in foreground; when it exits the trap will run and kill server
		"$CLIENT_SCRIPT"
	else
		echo "[start-dev] $CLIENT_SCRIPT not found or not executable. Run \"chmod +x $CLIENT_SCRIPT\" or run the scripts directly." >&2
		exit 1
	fi
	# explicit exit so the EXIT trap runs
	exit 0
fi

case "$1" in
	server)
		if [ -x "$SERVER_SCRIPT" ]; then
			exec "$SERVER_SCRIPT"
		else
			echo "[start-dev] $SERVER_SCRIPT not found or not executable." >&2
			exit 1
		fi
		;;
	client)
		if [ -x "$CLIENT_SCRIPT" ]; then
			exec "$CLIENT_SCRIPT"
		else
			echo "[start-dev] $CLIENT_SCRIPT not found or not executable." >&2
			exit 1
		fi
		;;
	*)
		echo "Usage: $0 [server|client]"
		exit 1
		;;
esac
