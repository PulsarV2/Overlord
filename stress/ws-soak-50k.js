import ws from "k6/ws";
import { sleep, check } from "k6";

// 50k-cap ramp: env-tunable, defaults aim for 50k concurrent sockets.
const HOST = __ENV.HOST || "127.0.0.1";
const PORT = __ENV.PORT || "5173";
const ROLE = __ENV.ROLE || "viewer";
const CLIENT_PREFIX = __ENV.CLIENT_PREFIX || "soak50k";
const HEARTBEAT_MS = Number(__ENV.HEARTBEAT_MS || 15000);
const INCLUDE_HELLO = __ENV.HELLO !== "0";
const METRIC_URL_TAG = __ENV.METRIC_URL_TAG || "ws-stream";

// Two-phase ramp then long hold and very slow ramp-down to avoid disconnect storms.
const MAX_VUS = Number(__ENV.VUS || 50000);
const FAST_TARGET = Number(__ENV.FAST_TARGET || 30000);
const FAST_STEP = Number(__ENV.FAST_STEP || 5000);
const FAST_STAGE_SEC = Number(__ENV.FAST_STAGE_SEC || 60);
const SLOW_STEP = Number(__ENV.SLOW_STEP || 1000);
const SLOW_STAGE_SEC = Number(__ENV.SLOW_STAGE_SEC || 150);
const HOLD_SEC = Number(__ENV.HOLD_SEC || 900); // 15m hold by default
const RAMPDOWN_STEP = Number(__ENV.RAMPDOWN_STEP || 2000);
const RAMPDOWN_STAGE_SEC = Number(__ENV.RAMPDOWN_STAGE_SEC || 180);

const stages = [];
// Rapid phase
for (
  let target = FAST_STEP;
  target <= Math.min(FAST_TARGET, MAX_VUS);
  target += FAST_STEP
) {
  stages.push({ duration: `${FAST_STAGE_SEC}s`, target });
}
// Slow creep beyond fast target
for (
  let target = FAST_TARGET + SLOW_STEP;
  target <= MAX_VUS;
  target += SLOW_STEP
) {
  stages.push({ duration: `${SLOW_STAGE_SEC}s`, target });
}
// Hold peak for a long time to minimize churn
stages.push({ duration: `${HOLD_SEC}s`, target: MAX_VUS });
// Slow ramp-down to avoid close storms
for (
  let target = MAX_VUS - RAMPDOWN_STEP;
  target > 0;
  target -= RAMPDOWN_STEP
) {
  stages.push({
    duration: `${RAMPDOWN_STAGE_SEC}s`,
    target: Math.max(target, 0),
  });
}
stages.push({ duration: `${RAMPDOWN_STAGE_SEC}s`, target: 0 });

export const options = {
  scenarios: {
    ws_capacity: {
      executor: "ramping-vus",
      startVUs: 0,
      stages,
      gracefulRampDown: "60s",
    },
  },
  thresholds: {
    ws_connecting: ["p(95)<1500"],
    ws_sessions: ["count>0"],
    checks: ["rate>0.99"],
  },
};

function buildUrl(clientId) {
  return `ws://${HOST}:${PORT}/api/clients/${clientId}/stream/ws?role=${ROLE}`;
}

export default function () {
  const clientId = `${CLIENT_PREFIX}-${__VU}-${__ITER}`;
  const url = buildUrl(clientId);

  const res = ws.connect(
    url,
    { tags: { url: METRIC_URL_TAG, name: METRIC_URL_TAG } },
    (socket) => {
      socket.on("open", () => {
        if (INCLUDE_HELLO) {
          socket.send(
            JSON.stringify({
              type: "hello",
              id: clientId,
              host: "soak",
              os: "test",
              arch: "x64",
              version: "k6",
              user: "k6",
              monitors: 1,
              country: "ZZ",
            }),
          );
        }

        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        socket.setInterval(() => {
          socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        }, HEARTBEAT_MS);
        // Additional small tick to ensure ws_msgs_sent is >0 even if pings are filtered
        socket.setInterval(
          () => {
            socket.send("tick");
          },
          Math.max(HEARTBEAT_MS / 2, 1000),
        );
      });

      socket.on("message", () => {
        // consume messages to avoid backpressure
      });

      socket.on("error", (e) => {
        console.error(`ws error: ${e.error()}`);
      });

      socket.on("close", () => {
        // closed
      });

      sleep(7200); // hold connections for the full run
    },
  );

  check(res, {
    "status 101": (r) => r && r.status === 101,
  });
}
