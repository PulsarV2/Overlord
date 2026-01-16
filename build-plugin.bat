@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "PLUGIN_DIR=%ROOT%plugin-sample-go"
if not "%~1"=="" set "PLUGIN_DIR=%~1"

set "WASM_DIR=%PLUGIN_DIR%\wasm"
set "PLUGIN_NAME=sample"
set "WASM_OUT=%PLUGIN_DIR%\%PLUGIN_NAME%.wasm"
set "ZIP_OUT=%PLUGIN_DIR%\%PLUGIN_NAME%.zip"

if not exist "%WASM_DIR%" (
  echo [error] wasm folder not found: %WASM_DIR%
  exit /b 1
)

pushd "%WASM_DIR%"

echo [build] go build -o "%WASM_OUT%" (GOOS=wasip1 GOARCH=wasm)
set "GOOS=wasip1"
set "GOARCH=wasm"
go build -o "%WASM_OUT%" .
set "GOOS="
set "GOARCH="
if errorlevel 1 (
  echo [warn] go build failed, trying tinygo
  echo [build] tinygo build -o "%WASM_OUT%" -target wasi -scheduler=none -gc=leaking .
  tinygo build -o "%WASM_OUT%" -target wasi -scheduler=none -gc=leaking .
  if errorlevel 1 (
    echo [error] tinygo build failed
    popd
    exit /b 1
  )
)

popd

if exist "%ZIP_OUT%" del /f /q "%ZIP_OUT%"

powershell -NoProfile -Command "Compress-Archive -Path '%PLUGIN_DIR%\%PLUGIN_NAME%.wasm','%PLUGIN_DIR%\%PLUGIN_NAME%.html','%PLUGIN_DIR%\%PLUGIN_NAME%.css','%PLUGIN_DIR%\%PLUGIN_NAME%.js' -DestinationPath '%ZIP_OUT%'"
if errorlevel 1 (
  echo [error] zip failed
  exit /b 1
)

echo [ok] %ZIP_OUT%
