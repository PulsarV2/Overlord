@echo off
setlocal
set ROOT=%~dp0


echo === Ensuring server deps (Bun) ===
pushd "%ROOT%Overlord-Server"
echo [server] bun install...
call bun install
popd

echo === Ensuring client dependencies (Go) ===
pushd "%ROOT%Overlord-Client"
if exist go.mod (
	echo [client] go mod tidy...
	go mod tidy
)
popd

echo === Launching windows ===
rem Bind server to all interfaces for remote access
set HOST=0.0.0.0
set PORT=5173
set OVERLORD_AGENT_TOKEN=dev-token-insecure-local-only

start "Overlord-Server" cmd /k "cd /d %ROOT%Overlord-Server && set "OVERLORD_AGENT_TOKEN=dev-token-insecure-local-only" && bun install && bun run dev"
start "Overlord-Client" cmd /k "cd /d %ROOT%Overlord-Client && set OVERLORD_SERVER=wss://localhost:5173 && set "OVERLORD_AGENT_TOKEN=dev-token-insecure-local-only" && set OVERLORD_TLS_INSECURE_SKIP_VERIFY=true && set OVERLORD_MODE=dev && set GOINSECURE=* && set GOSUMDB=off && set GOPROXY=https://proxy.golang.org,direct && go mod tidy && go run ./cmd/agent"

echo Done. Terminals stay open (/k) for logs.
endlocal
