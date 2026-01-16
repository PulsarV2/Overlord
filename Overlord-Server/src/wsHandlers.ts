import geoip from "geoip-lite";
import { encodeMessage, decodeMessage, WireMessage } from "./protocol";
import { Buffer } from "node:buffer";
import { ClientInfo } from "./types";
import { setThumbnail, setLatestFrame } from "./thumbnails";
import { upsertClientRow } from "./db";
import { metrics } from "./metrics";

export function handleHello(
  info: ClientInfo,
  payload: WireMessage,
  ws: any,
  ip?: string,
) {
  info.hwid = (payload as any).hwid as string | undefined;
  info.host = payload.host;
  info.os = payload.os;
  info.arch = payload.arch;
  info.version = payload.version;
  info.user = payload.user;
  info.monitors = payload.monitors;
  const geo = ip ? geoip.lookup(ip) : undefined;
  const countryRaw =
    geo?.country || (payload as any).country || info.country || "ZZ";
  const country = /^[A-Z]{2}$/i.test(countryRaw)
    ? countryRaw.toUpperCase()
    : "ZZ";
  info.country = country;

  upsertClientRow({
    id: info.id,
    hwid: info.hwid,
    role: info.role,
    host: info.host,
    os: info.os,
    arch: info.arch,
    version: info.version,
    user: info.user,
    monitors: info.monitors,
    country: info.country,
    lastSeen: info.lastSeen,
    online: 1,
  });

  const ts = Date.now();
  info.lastPingSent = ts;
  ws.send(encodeMessage({ type: "ping", ts }));
}

export function handlePing(info: ClientInfo, payload: WireMessage, ws: any) {
  console.log(`[ping] from client=${info.id} ts=${payload.ts ?? ""}`);
  ws.send(encodeMessage({ type: "pong", ts: payload.ts || Date.now() }));
}

export function handlePong(info: ClientInfo, payload: WireMessage) {
  if (payload.ts && info.lastPingSent) {
    const rtt = Date.now() - payload.ts;

    if (rtt >= 0 && rtt < 30000) {
      console.log(`[pong] client=${info.id} rtt=${rtt}ms ts=${payload.ts}`);
      info.pingMs = rtt;
      upsertClientRow({
        id: info.id,
        pingMs: info.pingMs,
        lastSeen: info.lastSeen,
        online: 1,
      });

      metrics.recordPing(rtt);
    }
  }
}

export function handleFrame(info: ClientInfo, payload: any) {
  const bytes = payload.data as unknown as Uint8Array;
  const header = (payload as any).header;
  const allowedFormats = ["jpeg", "jpg", "webp"];
  const fmt = String(header?.format || "").toLowerCase();
  const safeFormat = allowedFormats.includes(fmt) ? fmt : "";

  metrics.recordBytesReceived(bytes.length);

  let sentToViewers = false;
  try {
    const globalAny: any = globalThis as any;
    if (globalAny.__rdBroadcast) {
      sentToViewers = globalAny.__rdBroadcast(info.id, bytes, header);
    }
  } catch {}

  if (sentToViewers) {
    return;
  }

  if (safeFormat) {
    setLatestFrame(info.id, bytes, safeFormat);
    upsertClientRow({ id: info.id, lastSeen: Date.now(), online: 1 });
  }
}
