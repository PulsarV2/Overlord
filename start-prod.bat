@echo off
setlocal
set ROOT=%~dp0

REM Simple production launcher for Overlord server (no watchers).
REM Env overrides you can set before running:
REM   PORT=5173
REM   HOST=0.0.0.0
REM   OVERLORD_USER=admin
REM   OVERLORD_PASS=admin

if not defined HOST set HOST=0.0.0.0
if not defined PORT set PORT=5173

pushd "%ROOT%Overlord-Server"
echo [server] installing deps (bun install)...
call bun install

if defined PORT (
  echo [server] starting on port %PORT%...
) else (
  echo [server] starting on default port...
)
call bun run start
popd

echo Server stopped.
endlocal
