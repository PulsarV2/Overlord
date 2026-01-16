import { listClients, setOnlineState, upsertClientRow } from "./db";
import { ClientRole, ClientInfo } from "./types";
import { encodeMessage } from "./protocol";
import { v4 as uuidv4 } from "uuid";
import { metrics } from "./metrics";
import { logAudit, AuditAction } from "./auditLog";

const DEFAULT_PAGE_SIZE = 12;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function handleClientsRequest(req: Request): Response {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") || DEFAULT_PAGE_SIZE));
  const search = (url.searchParams.get("q") || "").toLowerCase().trim();
  const sort = url.searchParams.get("sort") || "last_seen_desc";
  const statusFilter = url.searchParams.get("status") || "all";
  const osFilter = url.searchParams.get("os") || "all";

  const result = listClients({ page, pageSize, search, sort, statusFilter, osFilter });
  return Response.json(result, { headers: CORS_HEADERS });
}

export function handleCommand(target: ClientInfo, action: string, req: Request) {
  console.log(`[command] action=${action} clientId=${target.id}`);
  
  
  metrics.recordCommand(action);
  
  if (action === "ping") {
    const ts = Date.now();
    target.lastPingSent = ts;
    target.ws.send(encodeMessage({ type: "ping", ts }));
    return Response.json({ ok: true });
  }
  if (action === "desktop_start") {
    target.ws.send(encodeMessage({ type: "command", commandType: "desktop_start", id: uuidv4() }));
    return Response.json({ ok: true });
  }
  if (action === "desktop_stop") {
    target.ws.send(encodeMessage({ type: "command", commandType: "desktop_stop", id: uuidv4() }));
    return Response.json({ ok: true });
  }
  if (action === "desktop_select_display") {
    
    target.ws.send(encodeMessage({ type: "command", commandType: "desktop_select_display", id: uuidv4(), payload: { display: 0 } }));
    return Response.json({ ok: true });
  }
  if (action === "desktop_enable_mouse") {
    target.ws.send(encodeMessage({ type: "command", commandType: "desktop_enable_mouse", id: uuidv4(), payload: { enabled: true } }));
    return Response.json({ ok: true });
  }
  if (action === "desktop_enable_keyboard") {
    target.ws.send(encodeMessage({ type: "command", commandType: "desktop_enable_keyboard", id: uuidv4(), payload: { enabled: true } }));
    return Response.json({ ok: true });
  }
  if (action === "disconnect") {
    target.ws.send(encodeMessage({ type: "command", commandType: "disconnect", id: uuidv4() }));
    return Response.json({ ok: true });
  }
  if (action === "reconnect") {
    target.ws.send(encodeMessage({ type: "command", commandType: "reconnect", id: uuidv4() }));
    return Response.json({ ok: true });
  }
  if (action === "file_list") {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    target.ws.send(encodeMessage({ type: "command", commandType: "file_list", id: uuidv4(), payload: { path } }));
    return Response.json({ ok: true });
  }
  if (action === "file_download") {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    target.ws.send(encodeMessage({ type: "command", commandType: "file_download", id: uuidv4(), payload: { path } }));
    return Response.json({ ok: true });
  }
  if (action === "file_delete") {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    target.ws.send(encodeMessage({ type: "command", commandType: "file_delete", id: uuidv4(), payload: { path } }));
    return Response.json({ ok: true });
  }
  if (action === "file_mkdir") {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    target.ws.send(encodeMessage({ type: "command", commandType: "file_mkdir", id: uuidv4(), payload: { path } }));
    return Response.json({ ok: true });
  }
  if (action === "file_zip") {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") || "";
    target.ws.send(encodeMessage({ type: "command", commandType: "file_zip", id: uuidv4(), payload: { path } }));
    return Response.json({ ok: true });
  }
  return new Response("Bad request", { status: 400 });
}
}

export function markOffline(id: string) {
  setOnlineState(id, false);
}

export function markOnline(info: ClientInfo) {
  upsertClientRow({ id: info.id, role: info.role, lastSeen: info.lastSeen, online: 1 });
}
