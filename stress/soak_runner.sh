k6 run stress/ws-soak.js \
  --env HOST=127.0.0.1 \
  --env PORT=5173 \
  --env VUS=2000 \
  --env STEP=500 \
  --env STAGE_SEC=60 \
  --env CLIENT_PREFIX=soak \
  --env ROLE=viewer \
  --env HEARTBEAT_MS=15000 \
  --env HELLO=1