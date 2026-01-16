@echo off
REM Generate self-signed TLS certificates for Overlord (Windows)
REM Requires OpenSSL to be installed and in PATH

setlocal EnableDelayedExpansion

set CERT_DIR=.\certs
set DAYS=3650
set COUNTRY=US
set STATE=State
set CITY=City
set ORG=Overlord
set ORG_UNIT=IT

if "%~1"=="" (
    set COMMON_NAME=localhost
) else (
    set COMMON_NAME=%~1
)

echo =========================================
echo Generating TLS Certificates for Overlord
echo =========================================
echo Common Name: %COMMON_NAME%
echo Certificate Directory: %CERT_DIR%
echo Validity: %DAYS% days
echo.

REM Check if OpenSSL is available
where openssl >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: OpenSSL is not installed or not in PATH
    echo.
    echo Please install OpenSSL from:
    echo   - https://slproweb.com/products/Win32OpenSSL.html
    echo   - Or use Chocolatey: choco install openssl
    echo   - Or use Git Bash which includes OpenSSL
    exit /b 1
)

REM Create certs directory if it doesn't exist
if not exist "%CERT_DIR%" mkdir "%CERT_DIR%"

REM Generate private key
echo [1/3] Generating private key...
openssl genrsa -out "%CERT_DIR%\server.key" 2048

REM Generate certificate signing request
echo [2/3] Generating certificate signing request...
openssl req -new -key "%CERT_DIR%\server.key" -out "%CERT_DIR%\server.csr" -subj "/C=%COUNTRY%/ST=%STATE%/L=%CITY%/O=%ORG%/OU=%ORG_UNIT%/CN=%COMMON_NAME%"

REM Generate self-signed certificate with SAN
echo [3/3] Generating self-signed certificate...
(
echo [req]
echo default_bits = 2048
echo prompt = no
echo default_md = sha256
echo distinguished_name = dn
echo req_extensions = req_ext
echo.
echo [dn]
echo C=%COUNTRY%
echo ST=%STATE%
echo L=%CITY%
echo O=%ORG%
echo OU=%ORG_UNIT%
echo CN=%COMMON_NAME%
echo.
echo [req_ext]
echo subjectAltName = @alt_names
echo.
echo [alt_names]
echo DNS.1 = %COMMON_NAME%
echo DNS.2 = localhost
echo DNS.3 = *.local
echo IP.1 = 127.0.0.1
echo IP.2 = ::1
) > "%CERT_DIR%\san.cnf"

if not "%~2"=="" (
    echo IP.3 = %~2>> "%CERT_DIR%\san.cnf"
    echo Added IP: %~2
)

openssl x509 -req -in "%CERT_DIR%\server.csr" -signkey "%CERT_DIR%\server.key" -out "%CERT_DIR%\server.crt" -days %DAYS% -sha256 -extfile "%CERT_DIR%\san.cnf" -extensions req_ext

REM Clean up
del "%CERT_DIR%\server.csr"
del "%CERT_DIR%\san.cnf"

echo.
echo =========================================
echo ✓ Certificates generated successfully!
echo =========================================
echo Certificate: %CERT_DIR%\server.crt
echo Private Key: %CERT_DIR%\server.key
echo.
echo To use these certificates:
echo   1. Set environment variable: set OVERLORD_TLS=true
echo   2. Optionally set custom paths:
echo      set OVERLORD_TLS_CERT=%CERT_DIR%\server.crt
echo      set OVERLORD_TLS_KEY=%CERT_DIR%\server.key
echo.
echo ⚠️  NOTE: Self-signed certificates require clients to:
echo   - Skip certificate verification (insecure), OR
echo   - Trust the server.crt certificate manually
echo.
echo For production, use proper certificates from:
echo   - Let's Encrypt (free, automated)
echo   - Your organization's certificate authority
echo =========================================

endlocal
