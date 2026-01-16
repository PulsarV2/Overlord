import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "./config";
import {
  verifyPassword,
  getUserByUsername,
  getUserById,
  type User,
  type UserRole,
} from "./users";

const JWT_ISSUER = "overlord-server";
const JWT_AUDIENCE = "overlord-client";
const JWT_EXPIRATION = "7d";

const tokenBlacklist = new Set<string>();

const tokenCache = new Map<
  string,
  { payload: JWTPayload; timestamp: number }
>();
const TOKEN_CACHE_TTL = 5000;

function getSecretKey(): Uint8Array {
  const config = getConfig();
  return new TextEncoder().encode(config.auth.jwtSecret);
}

export interface JWTPayload {
  sub: string;
  userId: number;
  role: UserRole;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedUser {
  username: string;
  userId: number;
  role: UserRole;
}

export async function generateToken(user: User): Promise<string> {
  const token = await new SignJWT({
    sub: user.username,
    userId: user.id,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(getSecretKey());

  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  if (tokenBlacklist.has(token)) {
    return null;
  }

  const cached = tokenCache.get(token);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < TOKEN_CACHE_TTL) {
      return cached.payload;
    } else {
      tokenCache.delete(token);
    }
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const jwtPayload: JWTPayload = {
      sub: payload.sub as string,
      userId: payload.userId as number,
      role: payload.role as UserRole,
      iat: payload.iat as number,
      exp: payload.exp as number,
      iss: payload.iss as string,
      aud: payload.aud as string,
    };

    tokenCache.set(token, { payload: jwtPayload, timestamp: Date.now() });

    return jwtPayload;
  } catch (error) {
    return null;
  }
}

export function revokeToken(token: string): void {
  tokenBlacklist.add(token);
  tokenCache.delete(token);
  console.log("[auth] Token revoked");
}

export async function cleanupBlacklist(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  let cleaned = 0;

  for (const token of tokenBlacklist) {
    try {
      const { payload } = await jwtVerify(token, getSecretKey(), {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      if (payload.exp && payload.exp < now) {
        tokenBlacklist.delete(token);
        cleaned++;
      }
    } catch {
      tokenBlacklist.delete(token);
      cleaned++;
    }
  }

  const cacheNow = Date.now();
  let cacheCleared = 0;
  for (const [token, entry] of tokenCache.entries()) {
    if (cacheNow - entry.timestamp > TOKEN_CACHE_TTL * 2) {
      tokenCache.delete(token);
      cacheCleared++;
    }
  }

  if (cleaned > 0 || cacheCleared > 0) {
    console.log(
      `[auth] Cleaned up ${cleaned} expired tokens from blacklist, ${cacheCleared} from cache`,
    );
  }
}

setInterval(cleanupBlacklist, 60 * 60 * 1000);

export async function authenticateUser(
  username: string,
  password: string,
): Promise<User | null> {
  return await verifyPassword(username, password);
}

export function extractTokenFromHeader(
  authHeader: string | null,
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

export function extractTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(/;\s*/);
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === "overlord_token") {
      return value;
    }
  }

  return null;
}

export async function authenticateRequest(
  req: Request,
): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get("Authorization");
  let token = extractTokenFromHeader(authHeader);

  if (!token) {
    const cookieHeader = req.headers.get("Cookie");
    token = extractTokenFromCookie(cookieHeader);
  }

  if (!token) {
    return null;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return null;
  }

  const user = getUserById(payload.userId);
  if (!user) {
    return null;
  }

  return {
    username: payload.sub,
    userId: payload.userId,
    role: payload.role,
  };
}

export async function getUserFromRequest(
  req: Request,
): Promise<AuthenticatedUser | null> {
  return await authenticateRequest(req);
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  let token = extractTokenFromHeader(authHeader);

  if (!token) {
    const cookieHeader = req.headers.get("Cookie");
    token = extractTokenFromCookie(cookieHeader);
  }

  return token;
}
