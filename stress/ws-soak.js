import ws from "k6/ws";
import { sleep, check } from "k6";

// Env-tunable ramp and endpoints so you can reuse this locally and on a VPS.
const HOST = __ENV.HOST || "127.0.0.1";
const PORT = __ENV.PORT || "5173";
const ROLE = __ENV.ROLE || "viewer";
const CLIENT_PREFIX = __ENV.CLIENT_PREFIX || "soak";
const HEARTBEAT_MS = Number(__ENV.HEARTBEAT_MS || 15000);
const INCLUDE_HELLO = __ENV.HELLO !== "0"; // send hello frame once to populate DB/state

// Ramp shape: default 500 VU every 60s until VUS max. Override via env.
const MAX_VUS = Number(__ENV.VUS || 2000);
const STEP = Number(__ENV.STEP || 500);
const STAGE_SEC = Number(__ENV.STAGE_SEC || 60);
const stages = [];
for (let target = STEP; target <= MAX_VUS; target += STEP) {
  stages.push({ duration: `${STAGE_SEC}s`, target });
}
stages.push({ duration: `${STAGE_SEC}s`, target: MAX_VUS });

export const options = {
  scenarios: {
    ws_capacity: {
      executor: "ramping-vus",
      startVUs: 0,
      stages,
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    ws_connecting: ["p(95)<1000"], // connect latency
    ws_session_duration: ["p(95)>300000"], // keep sessions alive
    ws_sessions: ["count>0"],
    ws_msgs_sent: ["count>0"],
    checks: ["rate>0.99"],
  },
};

function buildUrl(clientId) {
  return `ws://${HOST}:${PORT}/api/clients/${clientId}/stream/ws?role=${ROLE}`;
}

export default function () {
  const clientId = `${CLIENT_PREFIX}-${__VU}-${__ITER}`;
  const url = buildUrl(clientId);

  const res = ws.connect(url, {}, (socket) => {
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

    sleep(3600); // hold connection for the scenario duration
  });

  check(res, {
    "status 101": (r) => r && r.status === 101,
  });
}
