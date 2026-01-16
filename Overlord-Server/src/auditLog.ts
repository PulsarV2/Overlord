import Database from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";

const dataDir = process.env.DATA_DIR || "./data";
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = resolve(dataDir, "overlord.db");
const db = new Database(dbPath);

const auditQueue: AuditLogEntry[] = [];
const BATCH_SIZE = 50;
const BATCH_INTERVAL_MS = 1000;
let flushTimeout: Timer | null = null;

const VERBOSE_AUDIT = process.env.VERBOSE_AUDIT === "true";

db.run(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    username TEXT NOT NULL,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,
    target_client_id TEXT,
    details TEXT,
    success INTEGER NOT NULL,
    error_message TEXT
  );
`);

db.run(
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);`,
);
db.run(
  `CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_logs(username);`,
);
db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);`);

export enum AuditAction {
  LOGIN = "login",
  LOGOUT = "logout",
  LOGIN_FAILED = "login_failed",
  COMMAND = "command",
  FILE_DOWNLOAD = "file_download",
  FILE_UPLOAD = "file_upload",
  FILE_DELETE = "file_delete",
  FILE_LIST = "file_list",
  FILE_MKDIR = "file_mkdir",
  FILE_READ = "file_read",
  FILE_WRITE = "file_write",
  FILE_SEARCH = "file_search",
  FILE_COPY = "file_copy",
  FILE_MOVE = "file_move",
  FILE_CHMOD = "file_chmod",
  FILE_EXECUTE = "file_execute",
  FILE_ZIP = "file_zip",
  CONSOLE_START = "console_start",
  CONSOLE_STOP = "console_stop",
  CONSOLE_INPUT = "console_input",
  DESKTOP_START = "desktop_start",
  DESKTOP_STOP = "desktop_stop",
  DESKTOP_MOUSE = "desktop_mouse",
  DESKTOP_KEYBOARD = "desktop_keyboard",
  PROCESS_LIST = "process_list",
  PROCESS_KILL = "process_kill",
  SCREENSHOT = "screenshot",
  DISCONNECT = "disconnect",
  RECONNECT = "reconnect",
  UNINSTALL = "uninstall",
  AGENT_UPDATE = "agent_update",
  SCRIPT_EXECUTE = "script_execute",
}

export interface AuditLogEntry {
  id?: number;
  timestamp: number;
  username: string;
  ip: string;
  action: AuditAction | string;
  targetClientId?: string;
  details?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  username?: string;
  action?: string;
  targetClientId?: string;
  startDate?: number;
  endDate?: number;
  successOnly?: boolean;
}

export function logAudit(entry: AuditLogEntry): void {
  auditQueue.push(entry);

  if (VERBOSE_AUDIT) {
    const status = entry.success ? "✓" : "✗";
    const target = entry.targetClientId
      ? ` [client: ${entry.targetClientId.substring(0, 8)}...]`
      : "";
    console.log(
      `[audit] ${status} ${entry.username}@${entry.ip} - ${entry.action}${target}`,
    );
  }

  if (auditQueue.length >= BATCH_SIZE) {
    flushAuditLogs();
  } else if (!flushTimeout) {
    flushTimeout = setTimeout(flushAuditLogs, BATCH_INTERVAL_MS);
  }
}

function flushAuditLogs(): void {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  if (auditQueue.length === 0) return;

  const logsToWrite = auditQueue.splice(0, auditQueue.length);

  try {
    const insert = db.prepare(
      `INSERT INTO audit_logs (timestamp, username, ip, action, target_client_id, details, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const transaction = db.transaction((logs: AuditLogEntry[]) => {
      for (const entry of logs) {
        insert.run(
          entry.timestamp,
          entry.username,
          entry.ip,
          entry.action,
          entry.targetClientId || null,
          entry.details || null,
          entry.success ? 1 : 0,
          entry.errorMessage || null,
        );
      }
    });

    transaction(logsToWrite);
  } catch (error) {
    console.error(
      `[audit] Failed to flush ${logsToWrite.length} audit entries:`,
      error,
    );
  }
}

export function flushAuditLogsSync(): void {
  flushAuditLogs();
}

export function getAuditLogs(filters: AuditLogFilters = {}): {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];

  if (filters.username) {
    where.push("username = ?");
    params.push(filters.username);
  }

  if (filters.action) {
    where.push("action = ?");
    params.push(filters.action);
  }

  if (filters.targetClientId) {
    where.push("target_client_id = ?");
    params.push(filters.targetClientId);
  }

  if (filters.startDate) {
    where.push("timestamp >= ?");
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    where.push("timestamp <= ?");
    params.push(filters.endDate);
  }

  if (filters.successOnly) {
    where.push("success = 1");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countQuery = `SELECT COUNT(*) as total FROM audit_logs ${whereSql}`;
  const countResult = db.query(countQuery).get(...params) as { total: number };
  const total = countResult?.total || 0;

  const logsQuery = `
    SELECT id, timestamp, username, ip, action, target_client_id, details, success, error_message
    FROM audit_logs
    ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;

  const logs = db.query(logsQuery).all(...params, pageSize, offset) as any[];

  return {
    logs: logs.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      username: row.username,
      ip: row.ip,
      action: row.action,
      targetClientId: row.target_client_id || undefined,
      details: row.details || undefined,
      success: row.success === 1,
      errorMessage: row.error_message || undefined,
    })),
    total,
    page,
    pageSize,
  };
}

export function getAuditStats(): {
  totalLogs: number;
  last24h: number;
  failedLogins: number;
  topUsers: Array<{ username: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
} {
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  const totalLogs = (
    db.query("SELECT COUNT(*) as count FROM audit_logs").get() as any
  ).count;
  const last24h = (
    db
      .query("SELECT COUNT(*) as count FROM audit_logs WHERE timestamp >= ?")
      .get(yesterday) as any
  ).count;
  const failedLogins = (
    db
      .query(
        "SELECT COUNT(*) as count FROM audit_logs WHERE action = ? AND success = 0",
      )
      .get(AuditAction.LOGIN_FAILED) as any
  ).count;

  const topUsers = db
    .query(
      `
    SELECT username, COUNT(*) as count 
    FROM audit_logs 
    WHERE timestamp >= ?
    GROUP BY username 
    ORDER BY count DESC 
    LIMIT 5
  `,
    )
    .all(yesterday) as Array<{ username: string; count: number }>;

  const topActions = db
    .query(
      `
    SELECT action, COUNT(*) as count 
    FROM audit_logs 
    WHERE timestamp >= ?
    GROUP BY action 
    ORDER BY count DESC 
    LIMIT 10
  `,
    )
    .all(yesterday) as Array<{ action: string; count: number }>;

  return {
    totalLogs,
    last24h,
    failedLogins,
    topUsers,
    topActions,
  };
}

export function cleanupOldAuditLogs(daysToKeep: number = 90): number {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const result = db.run("DELETE FROM audit_logs WHERE timestamp < ?", [
    cutoffTime,
  ]);
  const deleted = result.changes;

  if (deleted > 0) {
    console.log(
      `[audit] Cleaned up ${deleted} audit logs older than ${daysToKeep} days`,
    );
  }

  return deleted;
}

process.on("beforeExit", () => {
  flushAuditLogs();
});

process.on("SIGINT", () => {
  flushAuditLogs();
  process.exit(0);
});

process.on("SIGTERM", () => {
  flushAuditLogs();
  process.exit(0);
});

console.log("[audit] Audit logging system initialized");
