import { existsSync, readFileSync } from "fs";
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

  return configCache;
}

export function getConfig(): Config {
  if (!configCache) {
    return loadConfig();
  }
  return configCache;
}
