# Sample Go WASM Plugin (sample)

This sample lives at the repo root and builds a WASI-compatible Go plugin.

## Files to include in the plugin zip

At the root of the zip:
- sample.wasm
- sample.html
- sample.css
- sample.js

## Build the WASM

Recommended: Go WASI (most compatible with wazero)

1) Build the WASM with Go 1.21+:

   GOOS=wasip1 GOARCH=wasm go build -o sample.wasm ./wasm

2) Optional TinyGo fallback:

   tinygo build -o sample.wasm -target wasi -scheduler=none -gc=leaking ./wasm

## Create the zip

Create a zip named sample.zip containing:
- sample.wasm
- sample.html
- sample.css
- sample.js

Then place sample.zip in Overlord-Server/plugins.

## Open the UI

Navigate to:
- /plugins/sample?clientId=<CLIENT_ID>

Click "Send event" and the WASM plugin will echo back to the server logs.
