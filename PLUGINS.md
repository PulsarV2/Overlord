# Overlord Plugins

This document explains how to build Overlord plugins, how the runtime works, and what you can do from a plugin UI and a WASM module.

> TL;DR: A plugin is a zip file with 4 files at the root: `<id>.wasm`, `<id>.html`, `<id>.css`, `<id>.js`. Upload it in the Plugins page or drop it in Overlord-Server/plugins.

## 1) How plugins are structured

### Required bundle format

A plugin bundle is a zip file named after the plugin ID:

```
<pluginId>.zip
```

Inside the zip (root level), these four files are required:

```
<pluginId>.wasm
<pluginId>.html
<pluginId>.css
<pluginId>.js
```

Example for plugin ID `sample`:

```
sample.zip
  ├─ sample.wasm
  ├─ sample.html
  ├─ sample.css
  └─ sample.js
```

When the server sees `<pluginId>.zip`, it extracts to:

```
Overlord-Server/plugins/<pluginId>/
  ├─ <pluginId>.wasm
  ├─ manifest.json
  └─ assets/
     ├─ <pluginId>.html
     ├─ <pluginId>.css
     └─ <pluginId>.js
```

The server **generates manifest.json** automatically. You do not need to include a manifest inside the zip.

### Manifest fields

The auto-generated manifest looks like:

```
{
  "id": "sample",
  "name": "sample",
  "version": "1.0.0",
  "binary": "sample.wasm",
  "entry": "sample.html",
  "assets": {
    "html": "sample.html",
    "css": "sample.css",
    "js": "sample.js"
  }
}
```

## 2) Build a WASM plugin (Go WASI)

The plugin runtime expects a WASI-compatible WebAssembly binary. Go 1.21+ builds work well with the current wazero runtime.

Build steps (from the plugin folder):

```
GOOS=wasip1 GOARCH=wasm go build -o <pluginId>.wasm ./wasm
```

There is a working example in:

- plugin-sample-go/wasm/main.go

## 3) Install & open a plugin

### Install / upload

- Use the UI at /plugins to upload the zip
- Or drop `<pluginId>.zip` into Overlord-Server/plugins and restart the server

### Open the UI

The plugin UI is served from:

```
/plugins/<pluginId>?clientId=<CLIENT_ID>
```

Your HTML should load its JS/CSS from `/plugins/<pluginId>/assets/`.

## 4) Runtime: how events flow

Overlord plugins have **two parts**:

1. **UI (HTML/CSS/JS)** — Runs in the browser and can call server APIs or open WebSockets.
2. **WASM module** — Runs in the agent (client) process via wazero.

### UI → agent (plugin event)

From your UI JS, you can send an event to a plugin on a client:

```
POST /api/clients/<clientId>/plugins/<pluginId>/event
{
  "event": "ui_message",
  "payload": { "message": "hello" }
}
```

If the plugin is not loaded yet, the server will:

- load it on the client
- queue your event
- deliver it when the plugin reports `loaded`

### Agent → plugin (WASM stdin)

The agent forwards that event into the WASM plugin over msgpack via stdin.

The message envelope looks like:

```
{
  "type": "event",
  "event": "ui_message",
  "payload": { ... }
}
```

### Plugin → agent (WASM stdout)

Your WASM can reply by writing msgpack messages to stdout. Two supported types:

- `type: "event"` → forwarded back to the server as `plugin_event`
- `type: "log"` → logged by the agent

Examples:

```
{ "type": "event", "event": "ready", "payload": "plugin ready" }
{ "type": "log", "payload": "starting capture" }
```

### Plugin lifecycle events

The agent sends lifecycle events to the server:

- `loaded` on successful load
- `unloaded` when unloaded
- `error` if load or runtime fails

These update the server-side plugin status and error display.

> Note: plugin events are **not** pushed back to the plugin UI automatically. If you need UI feedback, call a server API that returns a response to the UI or implement your own polling/WS endpoint.

## 5) What can plugins do?

Plugins can do anything **the server already exposes** to authenticated users, such as:

- start/stop remote desktop
- open a console session
- file browser actions (list, upload, download, edit)
- process listing and kill
- run scripts
- send commands to clients

This is intentional: plugins **do not modify server code** and are sandboxed by the plugin CSP.

### Security constraints

Plugin pages are served with a tight CSP:

- scripts must be same-origin
- no third‑party JS/CDN
- WebSocket and fetch are allowed to same origin

That means your plugin JS must be bundled into `<pluginId>.js` and loaded from `/plugins/<pluginId>/assets/`.

### Sandboxed iframe isolation

Plugin UIs are rendered inside a **sandboxed iframe** to isolate them from the main dashboard. This provides:

- No access to main app DOM
- No access to main app cookies/localStorage
- No direct access to privileged APIs

Because of the sandbox, **direct network calls from the plugin are blocked** by CSP. The system injects a small bridge that replaces `window.fetch` and forwards requests to the parent page.

Practical implications:

- Use `fetch()` as usual in your plugin JS
- Only the allowed plugin API routes are permitted
- Direct WebSocket usage from the plugin frame is blocked

If your plugin needs WebSockets (e.g., remote desktop), you must build a parent‑page bridge that opens the WS in the parent and forwards frames into the plugin UI. See the remote desktop section below for the architecture.

## 6) API surface (what you can call)

### Plugin management

- `GET /api/plugins` — list installed plugins
- `POST /api/plugins/upload` — upload zip
- `POST /api/plugins/<id>/enable` — enable/disable
- `DELETE /api/plugins/<id>` — remove

### Per-client plugin runtime

- `POST /api/clients/<clientId>/plugins/<pluginId>/load`
- `POST /api/clients/<clientId>/plugins/<pluginId>/event`
- `POST /api/clients/<clientId>/plugins/<pluginId>/unload`

### Useful built-in endpoints

- `POST /api/clients/<clientId>/command` (input, ping, scripts, etc.)
- `WS /api/clients/<clientId>/rd/ws` (remote desktop)
- `WS /api/clients/<clientId>/console/ws`
- `WS /api/clients/<clientId>/files/ws`
- `WS /api/clients/<clientId>/processes/ws`

## 7) Building a “pinnacle” plugin (remote desktop class)

A remote‑desktop‑class plugin typically has:

1. **A UI page** with a `<canvas>` and quality controls
2. **A WebSocket** connection to `/api/clients/<id>/rd/ws`
3. **Command messages** (`desktop_start`, `desktop_stop`, `desktop_select_display`, etc.)
4. **Binary frame decoding** (JPEG/raw) and drawing into the canvas

### How it would work (high level)

1. UI page reads `clientId` from query string
2. JS opens a WebSocket to `/api/clients/<clientId>/rd/ws`
3. UI sends JSON messages:

```
{ "type": "desktop_start" }
{ "type": "desktop_select_display", "display": 0 }
{ "type": "desktop_set_quality", "quality": 90, "codec": "jpeg" }
```

4. Incoming WS messages contain encoded frames (see `public/assets/remotedesktop.js` for the parsing logic)
5. Draw frames into the canvas and expose controls to the user

You do **not** need to re-implement the agent capture pipeline. The agent already supports it; your plugin just drives the existing WS endpoint.

### What you’d write (outline)

- **HTML**: Canvas + controls
- **JS**:
  - parse `clientId`
  - open WS
  - send desktop commands
  - decode frames and draw
- **WASM module** (optional):
  - background tasks or message validation
  - optional telemetry / state management

If you want a starting point, the existing remote desktop UI is in:

- Overlord-Server/public/remotedesktop.html
- Overlord-Server/public/assets/remotedesktop.js

You can reuse that logic inside your plugin UI with minimal changes.

## 8) Example: minimal plugin code shape

### WASM side (Go, message loop)

- listen on stdin using msgpack
- on `type=init`, send `event=ready`
- on `type=event`, process payload and emit response events

See:

- plugin-sample-go/wasm/main.go

### UI side (JS)

- call `/api/clients/<id>/plugins/<pluginId>/event`
- show responses via your own UI (or poll your own endpoints)

See:

- plugin-sample-go/sample.js

---

If you want a deeper walkthrough of a specific plugin type (file explorer, custom telemetry, or a remote-desktop clone), say which one and I’ll expand that section.
