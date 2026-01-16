import Database from "bun:sqlite";
import { ClientInfo, ListFilters, ListResult, ClientRole } from "./types";
import { getThumbnail } from "./thumbnails";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const dataDir = process.env.DATA_DIR || "./data";
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = resolve(dataDir, "overlord.db");
const db = new Database(dbPath);
console.log(`[db] Using database at: ${dbPath}`);

db.run(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    hwid TEXT,
    role TEXT,
    host TEXT,
    os TEXT,
    arch TEXT,
    version TEXT,
    user TEXT,
    monitors INTEGER,
    country TEXT,
    last_seen INTEGER,
    online INTEGER,
    ping_ms INTEGER
  );
`);
try {
  db.run(`ALTER TABLE clients ADD COLUMN role TEXT`);
} catch {}
try {
  db.run(`ALTER TABLE clients ADD COLUMN hwid TEXT`);
} catch {}

db.run(`
  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    files TEXT NOT NULL
  );
`);

export function upsertClientRow(
  partial: Partial<ClientInfo> & {
    id: string;
    lastSeen?: number;
    online?: number;
  },
) {
  const now = partial.lastSeen ?? Date.now();
  db.run(
    `INSERT INTO clients (id, hwid, role, host, os, arch, version, user, monitors, country, last_seen, online, ping_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       hwid=COALESCE(excluded.hwid, clients.hwid),
       role=COALESCE(excluded.role, clients.role),
       host=COALESCE(excluded.host, clients.host),
       os=COALESCE(excluded.os, clients.os),
       arch=COALESCE(excluded.arch, clients.arch),
       version=COALESCE(excluded.version, clients.version),
       user=COALESCE(excluded.user, clients.user),
       monitors=COALESCE(excluded.monitors, clients.monitors),
       country=COALESCE(excluded.country, clients.country),
       last_seen=excluded.last_seen,
       online=COALESCE(excluded.online, clients.online),
       ping_ms=COALESCE(excluded.ping_ms, clients.ping_ms)
    `,
    partial.id,
    partial.hwid ?? partial.id,
    partial.role ?? null,
    partial.host ?? null,
    partial.os ?? null,
    partial.arch ?? null,
    partial.version ?? null,
    partial.user ?? null,
    partial.monitors ?? null,
    partial.country ?? null,
    now,
    partial.online ?? 0,
    partial.pingMs ?? null,
  );

  if (partial.hwid) {
    db.run(
      `DELETE FROM clients WHERE hwid=? AND id<>?`,
      partial.hwid,
      partial.id,
    );
  }
}

export function setOnlineState(id: string, online: boolean) {
  db.run(
    `UPDATE clients SET online=?, last_seen=? WHERE id=?`,
    online ? 1 : 0,
    Date.now(),
    id,
  );
}

export function markAllClientsOffline() {
  db.run(`UPDATE clients SET online=0`);
  console.log("[db] marked all clients as offline");
}

export function listClients(filters: ListFilters): ListResult {
  const { page, pageSize, search, sort, statusFilter, osFilter } = filters;
  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push(
      "(LOWER(COALESCE(host,'')) LIKE ? OR LOWER(COALESCE(user,'')) LIKE ? OR LOWER(id) LIKE ?)",
    );
    const needle = `%${search}%`;
    params.push(needle, needle, needle);
  }

  if (statusFilter === "online") {
    where.push("online=1");
  } else if (statusFilter === "offline") {
    where.push("online=0");
  }

  if (osFilter && osFilter !== "all") {
    where.push("os=?");
    params.push(osFilter);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const orderBy = (() => {
    switch (sort) {
      case "ping_asc":
        return "ORDER BY ping_ms IS NULL, ping_ms ASC";
      case "ping_desc":
        return "ORDER BY ping_ms IS NULL, ping_ms DESC";
      case "host_asc":
        return "ORDER BY LOWER(host) ASC";
      case "host_desc":
        return "ORDER BY LOWER(host) DESC";
      default:
        return "ORDER BY last_seen DESC";
    }
  })();

  const totalRow = db
    .query<{ c: number }>(`SELECT COUNT(*) as c FROM clients ${whereSql}`)
    .get(...params) ?? { c: 0 };
  const onlineRow = db
    .query<{ c: number }>(`SELECT COUNT(*) as c FROM clients WHERE online=1`)
    .get() ?? { c: 0 };
  const offset = (page - 1) * pageSize;

  const rows = db
    .query<any>(
      `SELECT id, hwid, role, host, os, arch, version, user, monitors, country, last_seen as lastSeen, online, ping_ms as pingMs
       FROM clients
       ${whereSql}
       ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);

  const items = rows.map((c: any) => ({
    id: c.id,
    hwid: c.hwid,
    role: (c.role as ClientRole) || "client",
    lastSeen: Number(c.lastSeen) || 0,
    host: c.host,
    os: c.os || "unknown",
    arch: c.arch || "arch?",
    version: c.version || "0",
    user: c.user,
    monitors: c.monitors,
    country: c.country || "ZZ",
    pingMs: c.pingMs ?? null,
    online: c.online === 1,
    thumbnail: getThumbnail(c.id),
  }));

  return { page, pageSize, total: totalRow.c, online: onlineRow.c, items };
}

export interface BuildRecord {
  id: string;
  status: string;
  startTime: number;
  expiresAt: number;
  files: Array<{
    name: string;
    filename: string;
    platform: string;
    size: number;
  }>;
}

export function saveBuild(build: BuildRecord) {
  db.run(
    `INSERT OR REPLACE INTO builds (id, status, start_time, expires_at, files)
     VALUES (?, ?, ?, ?, ?)`,
    build.id,
    build.status,
    build.startTime,
    build.expiresAt,
    JSON.stringify(build.files),
  );
}

export function getBuild(id: string): BuildRecord | null {
  const row = db.query<any>(`SELECT * FROM builds WHERE id = ?`).get(id);
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    startTime: row.start_time,
    expiresAt: row.expires_at,
    files: JSON.parse(row.files),
  };
}

export function getAllBuilds(): BuildRecord[] {
  const rows = db
    .query<any>(`SELECT * FROM builds ORDER BY start_time DESC`)
    .all();
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    startTime: row.start_time,
    expiresAt: row.expires_at,
    files: JSON.parse(row.files),
  }));
}

export function deleteExpiredBuilds() {
  const now = Date.now();
  db.run(`DELETE FROM builds WHERE expires_at <= ?`, now);
}

export function deleteBuild(id: string) {
  db.run(`DELETE FROM builds WHERE id = ?`, id);
}
