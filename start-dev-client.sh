#!/usr/bin/env bash
set -eu
ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$ROOT/Overlord-Client"
DIST_DIR="$ROOT/dist-clients"
GO_BIN="${GO_BIN:-go}"

# detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM="mac";;
  Linux) PLATFORM="linux";;
  *) PLATFORM="unknown";;
esac

echo "[client] platform detected: $OS ($PLATFORM) arch: $ARCH"

# determine expected dist binary name
BIN_NAME=""
if [ "$PLATFORM" = "mac" ]; then
  BIN_NAME="agent-darwin-arm64"
elif [ "$PLATFORM" = "linux" ]; then
  BIN_NAME="agent-linux-amd64"
fi

if [ -n "$BIN_NAME" ] && [ -x "$DIST_DIR/$BIN_NAME" ]; then
  echo "[client] found prebuilt client binary: $DIST_DIR/$BIN_NAME"
  echo "[client] starting prebuilt agent"
  OVERLORD_SERVER="wss://localhost:5173" \
  OVERLORD_AGENT_TOKEN="dev-token-insecure-local-only" \
  OVERLORD_TLS_INSECURE_SKIP_VERIFY="true" \
  OVERLORD_MODE="dev" \
  "${DIST_DIR:?}/$BIN_NAME"
  exit 0
fi

echo "[client] no suitable prebuilt client binary found in $DIST_DIR; falling back to 'go run'"

cd "$CLIENT_DIR"
if ! command -v "$GO_BIN" >/dev/null 2>&1; then
    echo "[client] go not found. Set GO_BIN to your Go binary (>=1.21) or install Go." >&2
    exit 1
fi
GO_VER=$($GO_BIN env GOVERSION 2>/dev/null || true)
GO_MINOR=$(echo "$GO_VER" | sed -E 's/^go[0-9]+\.([0-9]+).*/\1/')
if [ -z "$GO_MINOR" ]; then
    echo "[client] unable to determine Go version (got '$GO_VER')." >&2
    exit 1
fi
if [ "$GO_MINOR" -lt 21 ]; then
    echo "[client] Go >=1.21 required (found $GO_VER). Install a newer Go or point GO_BIN to one." >&2
    exit 1
fi
echo "[client] using go at: $(command -v $GO_BIN) ($GO_VER)"
echo "[client] go mod tidy..."
GOTOOLCHAIN=${GOTOOLCHAIN:-auto} \
"$GO_BIN" mod tidy
echo "[client] starting agent via 'go run'"
OVERLORD_SERVER="wss://localhost:5173" \
OVERLORD_AGENT_TOKEN="dev-token-insecure-local-only" \
OVERLORD_TLS_INSECURE_SKIP_VERIFY="true" \
OVERLORD_MODE="dev" \
GOINSECURE="*" \
GOSUMDB="off" \
GOPROXY="https://proxy.golang.org,direct" \
GOTOOLCHAIN=${GOTOOLCHAIN:-auto} \
"$GO_BIN" run ./cmd/agent
