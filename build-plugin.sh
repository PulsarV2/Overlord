#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="${1:-${ROOT_DIR}/plugin-sample-go}"
WASM_DIR="${PLUGIN_DIR}/wasm"
PLUGIN_NAME="sample"
WASM_OUT="${PLUGIN_DIR}/${PLUGIN_NAME}.wasm"
ZIP_OUT="${PLUGIN_DIR}/${PLUGIN_NAME}.zip"

if [[ ! -d "${WASM_DIR}" ]]; then
  echo "[error] wasm folder not found: ${WASM_DIR}" >&2
  exit 1
fi

pushd "${WASM_DIR}" >/dev/null

echo "[build] go build -o ${WASM_OUT} (GOOS=wasip1 GOARCH=wasm)"
if ! GOOS=wasip1 GOARCH=wasm go build -o "${WASM_OUT}" .; then
  echo "[warn] go build failed, trying tinygo"
  echo "[build] tinygo build -o ${WASM_OUT} -target wasi -scheduler=none -gc=leaking ."
  tinygo build -o "${WASM_OUT}" -target wasi -scheduler=none -gc=leaking .
fi

popd >/dev/null

rm -f "${ZIP_OUT}"

if command -v zip >/dev/null 2>&1; then
  (cd "${PLUGIN_DIR}" && zip -q "${ZIP_OUT}" "${PLUGIN_NAME}.wasm" "${PLUGIN_NAME}.html" "${PLUGIN_NAME}.css" "${PLUGIN_NAME}.js")
else
  echo "[error] zip not found. Please install zip." >&2
  exit 1
fi

echo "[ok] ${ZIP_OUT}"
