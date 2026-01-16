import { Database } from "bun:sqlite";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { logger } from "./logger";

const dataDir = process.env.DATA_DIR || "./data";
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
const dbPath = resolve(dataDir, "overlord.db");
const db = new Database(dbPath);

export type UserRole = "admin" | "operator" | "viewer";

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: number;
  last_login: number | null;
  created_by: string | null;
  must_change_password: number;
}

export interface UserInfo {
  id: number;
  username: string;
  role: UserRole;
  created_at: number;
  last_login: number | null;
  created_by: string | null;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    created_by TEXT,
    must_change_password INTEGER DEFAULT 0
  )
`);

try {
  db.exec(
    `ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`,
  );
  logger.info("[users] Added must_change_password column to existing database");
} catch (err: any) {
  if (!err.message?.includes("duplicate column name")) {
    logger.error("[users] Migration error:", err);
  }
}

const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
  count: number;
};
if (userCount.count === 0) {
  logger.info("[users] No users found, creating default admin account");
  const defaultPassword = await Bun.password.hash("admin", {
    algorithm: "bcrypt",
    cost: 10,
  });

  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at, created_by, must_change_password) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("admin", defaultPassword, "admin", Date.now(), "system", 1);

  const createdUser = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get("admin") as User | undefined;
  logger.info(
    "[users] Default admin created with must_change_password =",
    createdUser?.must_change_password,
  );

  logger.info(
    "[users] Default admin account created (username: admin, password: admin)",
  );
  logger.warn(
    "[users] ⚠️  SECURITY WARNING: You will be forced to change the password on first login!",
  );
}

export function getUserById(id: number): User | null {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
  return user || null;
}

export function getUserByUsername(username: string): User | null {
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as User | undefined;
  return user || null;
}

export function listUsers(): UserInfo[] {
  const users = db
    .prepare(
      "SELECT id, username, role, created_at, last_login, created_by FROM users ORDER BY created_at DESC",
    )
    .all() as UserInfo[];
  return users;
}

export async function createUser(
  username: string,
  password: string,
  role: UserRole,
  createdBy: string,
): Promise<{ success: boolean; error?: string; userId?: number }> {
  if (!username || username.length < 3 || username.length > 32) {
    return {
      success: false,
      error: "Username must be between 3 and 32 characters",
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      success: false,
      error:
        "Username can only contain letters, numbers, hyphens, and underscores",
    };
  }

  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  const existing = getUserByUsername(username);
  if (existing) {
    return { success: false, error: "Username already exists" };
  }

  try {
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run(username, passwordHash, role, Date.now(), createdBy);

    return { success: true, userId: result.lastInsertRowid as number };
  } catch (err: any) {
    logger.error("[users] Create user error:", err);
    return { success: false, error: err.message || "Failed to create user" };
  }
}

export async function updateUserPassword(
  userId: number,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: "Password must be at least 6 characters" };
  }

  try {
    const passwordHash = await Bun.password.hash(newPassword, {
      algorithm: "bcrypt",
      cost: 10,
    });

    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    ).run(passwordHash, userId);
    return { success: true };
  } catch (err: any) {
    console.error("[users] Update password error:", err);
    return {
      success: false,
      error: err.message || "Failed to update password",
    };
  }
}

export function updateUserRole(
  userId: number,
  newRole: UserRole,
): { success: boolean; error?: string } {
  try {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(newRole, userId);
    return { success: true };
  } catch (err: any) {
    console.error("[users] Update role error:", err);
    return { success: false, error: err.message || "Failed to update role" };
  }
}

export function deleteUser(userId: number): {
  success: boolean;
  error?: string;
} {
  const admins = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  const user = getUserById(userId);

  if (user?.role === "admin" && admins.count <= 1) {
    return { success: false, error: "Cannot delete the last admin user" };
  }

  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return { success: true };
  } catch (err: any) {
    console.error("[users] Delete user error:", err);
    return { success: false, error: err.message || "Failed to delete user" };
  }
}

export function updateLastLogin(userId: number): void {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(
    Date.now(),
    userId,
  );
}

export async function verifyPassword(
  username: string,
  password: string,
): Promise<User | null> {
  const user = getUserByUsername(username);
  if (!user) return null;

  const isValid = await Bun.password.verify(password, user.password_hash);
  if (!isValid) return null;

  updateLastLogin(user.id);
  return user;
}

export function canManageUsers(role: UserRole): boolean {
  return role === "admin";
}

export function canControlClients(role: UserRole): boolean {
  return role === "admin" || role === "operator";
}

export function canViewClients(role: UserRole): boolean {
  return true;
}

export function canViewAuditLogs(role: UserRole): boolean {
  return role === "admin";
}

export function hasPermission(role: UserRole, permission: string): boolean {
  switch (permission) {
    case "users:manage":
      return canManageUsers(role);
    case "clients:control":
      return canControlClients(role);
    case "clients:view":
      return canViewClients(role);
    case "audit:view":
      return canViewAuditLogs(role);
    default:
      return false;
  }
}
