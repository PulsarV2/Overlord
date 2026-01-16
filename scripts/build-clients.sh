#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLIENT_DIR="${CLIENT_DIR:-${REPO_ROOT}/Overlord-Client}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/dist-clients}"
TARGETS="${TARGETS:-windows/amd64 windows/arm64 linux/amd64 linux/arm64 linux/arm/v7 darwin/arm64}"
GO_BUILD_FLAGS="${GO_BUILD_FLAGS:--trimpath}"
LDFLAGS_EXTRA="${LDFLAGS:--s -w}"
ENABLE_PERSISTENCE="${ENABLE_PERSISTENCE:-false}"
SERVER_URL="${SERVER_URL:-}"
CLIENT_ID="${CLIENT_ID:-}"
CLIENT_COUNTRY="${CLIENT_COUNTRY:-}"

# Build LDFLAGS with all custom settings
if [ "${ENABLE_PERSISTENCE}" = "true" ]; then
  echo "Building with persistence enabled"
  LDFLAGS_EXTRA="${LDFLAGS_EXTRA} -X overlord-client/cmd/agent/config.DefaultPersistence=true"
fi

if [ -n "${SERVER_URL}" ]; then
  echo "Building with custom server URL: ${SERVER_URL}"
  LDFLAGS_EXTRA="${LDFLAGS_EXTRA} -X overlord-client/cmd/agent/config.DefaultServerURL=${SERVER_URL}"
fi

if [ -n "${CLIENT_ID}" ]; then
  echo "Building with custom client ID: ${CLIENT_ID}"
  LDFLAGS_EXTRA="${LDFLAGS_EXTRA} -X overlord-client/cmd/agent/config.DefaultID=${CLIENT_ID}"
fi

if [ -n "${CLIENT_COUNTRY}" ]; then
  echo "Building with custom country: ${CLIENT_COUNTRY}"
  LDFLAGS_EXTRA="${LDFLAGS_EXTRA} -X overlord-client/cmd/agent/config.DefaultCountry=${CLIENT_COUNTRY}"
fi

echo "LDFLAGS: ${LDFLAGS_EXTRA}"

mkdir -p "${OUT_DIR}"
cd "${CLIENT_DIR}"

# Pre-fetch dependencies for reproducible builds
if [ -f go.sum ]; then
  go mod download
fi

target_list=${TARGETS//,/ }
for target in ${target_list}; do
  IFS=/ read -r goos goarch goarm_raw <<<"${target}"
  export GOOS="${goos}"
  export GOARCH="${goarch}"
  if [ -n "${goarm_raw:-}" ]; then
    export GOARM="${goarm_raw#v}"
  else
    unset GOARM || true
  fi

  suffix="${GOOS}-${GOARCH}"
  if [ -n "${GOARM:-}" ]; then
    suffix="${GOOS}-${GOARCH}v${GOARM}"
  fi
  bin_name="agent-${suffix}"
  if [ "${GOOS}" = "windows" ]; then
    bin_name="${bin_name}.exe"
  fi

  echo "==> Building ${bin_name} (GOOS=${GOOS} GOARCH=${GOARCH}${GOARM:+ GOARM=${GOARM}})"
  go build ${GO_BUILD_FLAGS} -ldflags "${LDFLAGS_EXTRA}" -o "${OUT_DIR}/${bin_name}" ./cmd/agent

  echo "    ✔ done"
done

echo "Build artifacts written to ${OUT_DIR}"