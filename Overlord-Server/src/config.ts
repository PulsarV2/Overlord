import { existsSync, readFileSync, writeFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";
import logger from "./logger";

export interface Config {
  auth: {
    username: string;
    password: string;
    jwtSecret: string;
    agentToken: string;
  };
  server: {
    port: number;
    host: string;
  };
  tls: {
    certPath: string;
    keyPath: string;
    caPath: string;
  };
  notifications: {
    keywords: string[];
    minIntervalMs: number;
    spamWindowMs: number;
    spamWarnThreshold: number;
    historyLimit: number;
  };
}

const DEFAULT_CONFIG: Config = {
  auth: {
    username: "admin",
    password: "admin",
    jwtSecret: "",
    agentToken: "",
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  tls: {
    certPath: "./certs/server.crt",
    keyPath: "./certs/server.key",
    caPath: "",
  },
  notifications: {
    keywords: [],
    minIntervalMs: 8000,
    spamWindowMs: 60000,
    spamWarnThreshold: 5,
    historyLimit: 200,
  },
};

function generateJwtSecret(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let secret = "";
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (let i = 0; i < 32; i++) {
    secret += chars[array[i] % chars.length];
  }
  return secret;
}

function generateAgentToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let configCache: Config | null = null;

export function loadConfig(): Config {
  if (configCache) {
    return configCache;
  }

  let fileConfig: Partial<Config> = {};

  const configPath = resolve(process.cwd(), "config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(content);
      logger.info("Loaded configuration from config.json");
    } catch (error) {
      logger.warn("Failed to parse config.json, using defaults:", error);
    }
  } else {
    logger.info(
      "No config.json found, using defaults and environment variables",
    );
  }

  const jwtSecret =
    process.env.JWT_SECRET ||
    fileConfig.auth?.jwtSecret ||
    DEFAULT_CONFIG.auth.jwtSecret;

  const finalJwtSecret = jwtSecret || generateJwtSecret();
  if (!jwtSecret) {
    logger.info("No JWT secret provided, generated secure random secret");
  }

  const agentToken =
    process.env.OVERLORD_AGENT_TOKEN ||
    fileConfig.auth?.agentToken ||
    DEFAULT_CONFIG.auth.agentToken;

  const keywordsEnv = process.env.OVERLORD_NOTIFICATION_KEYWORDS;
  const keywordsFromEnv = keywordsEnv
    ? keywordsEnv
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  const finalAgentToken = agentToken || generateAgentToken();
  
  if (!agentToken) {
    logger.info("No agent token provided, generated secure random token");
  } else {
    logger.info(`Using agent token from ${process.env.OVERLORD_AGENT_TOKEN ? 'environment' : 'config file'}`);
  }

  configCache = {
    auth: {
      username:
        process.env.OVERLORD_USER ||
        fileConfig.auth?.username ||
        DEFAULT_CONFIG.auth.username,
      password:
        process.env.OVERLORD_PASS ||
        fileConfig.auth?.password ||
        DEFAULT_CONFIG.auth.password,
      jwtSecret: finalJwtSecret,
      agentToken: finalAgentToken,
    },
    server: {
      port:
        Number(process.env.PORT) ||
        fileConfig.server?.port ||
        DEFAULT_CONFIG.server.port,
      host:
        process.env.HOST ||
        fileConfig.server?.host ||
        DEFAULT_CONFIG.server.host,
    },
    tls: {
      certPath:
        process.env.OVERLORD_TLS_CERT ||
        fileConfig.tls?.certPath ||
        DEFAULT_CONFIG.tls.certPath,
      keyPath:
        process.env.OVERLORD_TLS_KEY ||
        fileConfig.tls?.keyPath ||
        DEFAULT_CONFIG.tls.keyPath,
      caPath:
        process.env.OVERLORD_TLS_CA ||
        fileConfig.tls?.caPath ||
        DEFAULT_CONFIG.tls.caPath,
    },
    notifications: {
      keywords:
        keywordsFromEnv.length > 0
          ? keywordsFromEnv
          : (fileConfig.notifications?.keywords ||
              DEFAULT_CONFIG.notifications.keywords),
      minIntervalMs:
        Number(process.env.OVERLORD_NOTIFICATION_MIN_INTERVAL_MS) ||
        fileConfig.notifications?.minIntervalMs ||
        DEFAULT_CONFIG.notifications.minIntervalMs,
      spamWindowMs:
        Number(process.env.OVERLORD_NOTIFICATION_SPAM_WINDOW_MS) ||
        fileConfig.notifications?.spamWindowMs ||
        DEFAULT_CONFIG.notifications.spamWindowMs,
      spamWarnThreshold:
        Number(process.env.OVERLORD_NOTIFICATION_SPAM_WARN_THRESHOLD) ||
        fileConfig.notifications?.spamWarnThreshold ||
        DEFAULT_CONFIG.notifications.spamWarnThreshold,
      historyLimit:
        Number(process.env.OVERLORD_NOTIFICATION_HISTORY_LIMIT) ||
        fileConfig.notifications?.historyLimit ||
        DEFAULT_CONFIG.notifications.historyLimit,
    },
  };

  if (
    configCache.auth.username === "admin" &&
    configCache.auth.password === "admin"
  ) {
    console.warn(
      "[config] ⚠️  WARNING: Using default credentials (admin/admin). Please change them in config.json or via environment variables!",
    );
  }

  if (configCache.auth.jwtSecret === "change-this-secret-in-production") {
    console.warn(
      "[config] ⚠️  WARNING: Using default JWT secret. Please change it in config.json or via JWT_SECRET environment variable!",
    );
  }

  if (!jwtSecret && !process.env.JWT_SECRET) {
    try {
      const configPath = resolve(process.cwd(), "config.json");
      const nextConfig = fileConfig || {};
      nextConfig.auth = { ...(nextConfig.auth || {}), jwtSecret: finalJwtSecret };
      writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
      logger.info("Persisted generated JWT secret to config.json");
    } catch (error) {
      logger.warn("Failed to persist generated JWT secret", error);
    }
  }

  return configCache;
}

export function getConfig(): Config {
  if (!configCache) {
    return loadConfig();
  }
  return configCache;
}

export async function updateNotificationsConfig(
  updates: Partial<Config["notifications"]>,
): Promise<Config["notifications"]> {
  const current = getConfig();
  const keywords = (updates.keywords || current.notifications.keywords || [])
    .map((k) => String(k).trim())
    .filter(Boolean);
  const deduped = Array.from(new Set(keywords));

  const next = {
    ...current.notifications,
    ...updates,
    keywords: deduped,
  };

  configCache = {
    ...current,
    notifications: next,
  };

  const configPath = resolve(process.cwd(), "config.json");
  let fileConfig: any = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(content) || {};
    } catch {
      fileConfig = {};
    }
  }

  fileConfig.notifications = next;

  try {
    await mkdir(resolve(process.cwd()), { recursive: true });
  } catch {}

  await writeFile(configPath, JSON.stringify(fileConfig, null, 2));
  return next;
}
