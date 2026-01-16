# Overlord

Bun-first remote admin suite with a Go client and Bun/TypeScript server plus a Next.js admin UI.

**Security First:** TLS/HTTPS is always enabled. Self-signed certificates are automatically generated on first run.

## Packages

- `Overlord-Server`: Bun/TypeScript server with Bun-native WebSockets (HTTPS/WSS only).
- `Overlord-Client`: Go agent connecting over secure WebSocket (WSS) using a binary protocol.
- `shared`: Protocol definitions and helpers shared between server and UI.
- `admin`: Next.js (React) admin UI running on Bun.

## Quick start

### Docker (Recommended)

**The simplest deployment - no configuration needed:**

```bash
# Just run it - uses sensible defaults
docker compose up -d

# Access at https://localhost:5173
# Login: admin / admin (you'll be forced to change password on first login)
```

**That's it!** The system:

- ✅ Uses default admin/admin credentials (forces password change on first login)
- ✅ Auto-generates secure JWT secret
- ✅ Auto-generates self-signed TLS certificates
- ✅ Stores data in Docker volumes

**Optional: Customize the initial admin username**

If you want a different username instead of "admin":

```bash
# Create .env file
echo "OVERLORD_USER=myusername" > .env

# Run
docker compose up -d

# Login with: myusername / admin (still forces password change)
```

**For developers - build from source:**

```bash
# Clone repository
git clone https://github.com/yourusername/overlord.git
cd overlord

# Build from source
docker compose build
docker compose up -d
```

Build agent binaries without installing Go:

```bash
docker compose --profile builder run --rm agent-builder
```

See [DOCKER.md](DOCKER.md) for detailed Docker deployment guide.

### Local Development

- Requires Bun (latest), Go 1.21+, and OpenSSL (for certificate generation).

### Configuration

1. Copy the example config: `cp Overlord-Server/config.json.example Overlord-Server/config.json`
2. Edit `config.json` to set your credentials and JWT secret:

```json
{
  "auth": {
    "username": "your-username",
    "password": "your-secure-password",
    "jwtSecret": "your-random-secret-key"
  }
}
```

**Security Features:**

- ✅ JWT-based authentication with token expiration
- ✅ Rate limiting on login (5 attempts per 15 minutes, 30-minute lockout)
- ✅ Comprehensive audit logging for all admin actions
- ✅ Token revocation/blacklist for logout
- ✅ Secure HttpOnly cookies with SameSite protection

### Server/UI

- `cd Overlord-Server && bun install && bun run dev`
  - Certificates are auto-generated on first run if not present
  - Access at `https://localhost:5173` (accept self-signed cert warning)
  - Default credentials: admin/admin (change in config.json!)

### Client

- `cd Overlord-Client && OVERLORD_TLS_INSECURE_SKIP_VERIFY=true go run ./cmd/agent`
  - For production, copy `certs/server.crt` to client and use `OVERLORD_TLS_CA=./server.crt`

## TLS Configuration

TLS is **always enabled** for security. The server automatically generates self-signed certificates if they don't exist.

### Server

```bash
cd Overlord-Server
bun run dev  # Automatically generates certs in ./certs/ if needed
```

### Client Options

**Development (skip cert verification):**

```bash
export OVERLORD_SERVER=wss://your-server:5173
export OVERLORD_TLS_INSECURE_SKIP_VERIFY=true
cd Overlord-Client && go run ./cmd/agent
```

**Production (trust the server certificate):**

```bash
# Copy server.crt from server to client machine
export OVERLORD_SERVER=wss://your-server:5173
export OVERLORD_TLS_CA=./certs/server.crt
cd Overlord-Client && go run ./cmd/agent
```

See [TLS_SETUP.md](TLS_SETUP.md) for detailed configuration including Let's Encrypt and mutual TLS.

## Plugins

See [PLUGINS.md](PLUGINS.md) for a full guide to building, packaging, and deploying Overlord plugins.

### Plugin sandbox & restrictions

Plugin UIs run inside a **sandboxed iframe** (`sandbox="allow-scripts"`) to isolate them from the main dashboard. This means:

- No access to the main app DOM
- No access to cookies or localStorage from the parent app
- No direct access to privileged APIs

**Network restrictions:**

- Plugin frames are served with a strict CSP that blocks direct network access (`connect-src 'none'`).
- A parent-page **fetch bridge** is injected so plugin code can use `fetch()` to call allowed Overlord API routes.
- Direct WebSocket usage from the plugin frame is blocked; a parent bridge is required if you need WS traffic.

See [PLUGINS.md](PLUGINS.md) for the full security model, allowed endpoints, and bridge usage.

## Status

Initial scaffold. Protocol and implementations WIP.
