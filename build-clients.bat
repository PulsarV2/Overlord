@echo off
setlocal
set ROOT=%~dp0
set CLIENT_DIR=%ROOT%Overlord-Client
set OUT_DIR=%ROOT%dist-clients

set ENABLE_PERSISTENCE=false

REM Build LDFLAGS with all custom settings
set "LDFLAGS=-s -w"

if "%ENABLE_PERSISTENCE%"=="true" (
    echo Building with persistence enabled
    set "LDFLAGS=%LDFLAGS% -X overlord-client/cmd/agent/config.DefaultPersistence=true"
)

if not "%SERVER_URL%"=="" (
    echo Building with custom server URL: %SERVER_URL%
    set "LDFLAGS=%LDFLAGS% -X overlord-client/cmd/agent/config.DefaultServerURL=%SERVER_URL%"
)

if not "%CLIENT_ID%"=="" (
    echo Building with custom client ID: %CLIENT_ID%
    set "LDFLAGS=%LDFLAGS% -X overlord-client/cmd/agent/config.DefaultID=%CLIENT_ID%"
)

if not "%CLIENT_COUNTRY%"=="" (
    echo Building with custom country: %CLIENT_COUNTRY%
    set "LDFLAGS=%LDFLAGS% -X overlord-client/cmd/agent/config.DefaultCountry=%CLIENT_COUNTRY%"
)

echo LDFLAGS: %LDFLAGS%

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

pushd "%CLIENT_DIR%"
echo == Building agent for windows amd64 ==
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-windows-amd64.exe" ./cmd/agent
if errorlevel 1 goto :err

echo == Building agent for windows arm64 ==
set GOOS=windows
set GOARCH=arm64
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-windows-arm64.exe" ./cmd/agent
if errorlevel 1 goto :err

echo == Building agent for linux amd64 ==
set GOOS=linux
set GOARCH=amd64
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-linux-amd64" ./cmd/agent
if errorlevel 1 goto :err

echo == Building agent for linux arm64 ==
set GOOS=linux
set GOARCH=arm64
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-linux-arm64" ./cmd/agent
if errorlevel 1 goto :err

echo == Building agent for linux arm (armv7) ==
set GOOS=linux
set GOARCH=arm
set GOARM=7
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-linux-armv7" ./cmd/agent
if errorlevel 1 goto :err

echo == Building agent for darwin arm64 ==
set GOOS=darwin
set GOARCH=arm64
set CGO_ENABLED=0
go build -ldflags="%LDFLAGS%" -o "%OUT_DIR%\agent-darwin-arm64" ./cmd/agent
if errorlevel 1 goto :err

echo Builds complete. Outputs in %OUT_DIR%
goto :eof

:err
echo Build failed. See errors above.
exit /b 1

:eof
popd
endlocal
