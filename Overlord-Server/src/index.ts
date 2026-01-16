import type { ServerWebSocket } from "bun";
import { $ } from "bun";
import { decodeMessage, encodeMessage, type WireMessage, type PluginManifest } from "./protocol";
import { logger } from "./logger";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import AdmZip from "adm-zip";
import { upsertClientRow, setOnlineState, listClients, markAllClientsOffline, saveBuild, getBuild, getAllBuilds, deleteExpiredBuilds, deleteBuild } from "./db";
import { handleFrame, handleHello, handlePing, handlePong } from "./wsHandlers";
import { ClientInfo, ClientRole } from "./types";
import { v4 as uuidv4 } from "uuid";
import { certificatesExist, generateSelfSignedCert, isOpenSSLAvailable, getLocalIPs } from "./certGenerator";
import { generateToken, authenticateUser, authenticateRequest, getUserFromRequest, revokeToken, extractTokenFromRequest } from "./auth";
import { loadConfig, getConfig } from "./config";
import { isRateLimited, recordFailedAttempt, recordSuccessfulAttempt } from "./rateLimit";
import { logAudit, AuditAction, flushAuditLogsSync } from "./auditLog";
import { listUsers, createUser, updateUserPassword, updateUserRole, deleteUser, getUserById, verifyPassword } from "./users";
import { requireAuth, requirePermission } from "./rbac";
import { metrics } from "./metrics";
import * as clientManager from "./clientManager";
import * as sessionManager from "./sessions/sessionManager";
import type { SocketData, ConsoleSession, RemoteDesktopViewer } from "./sessions/types";
import * as buildManager from "./build/buildManager";
import type { BuildStream, BuildConfig } from "./build/types";


const config = loadConfig();

const PORT = config.server.port;
const HOST = config.server.host;
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_MS = 5 * 60_000;
const DISCONNECT_TIMEOUT_MS = 10_000; 
const PRUNE_BATCH = Number(process.env.PRUNE_BATCH || 500);
const MAX_WS_MESSAGE_BYTES_VIEWER = Number(process.env.MAX_WS_MESSAGE_BYTES_VIEWER || 1_000_000);
const MAX_WS_MESSAGE_BYTES_CLIENT = Number(process.env.MAX_WS_MESSAGE_BYTES_CLIENT || 10_000_000);
const PUBLIC_ROOT = fileURLToPath(new URL("../public", import.meta.url));
const PLUGIN_ROOT = fileURLToPath(new URL("../plugins", import.meta.url));
const PLUGIN_STATE_PATH = path.join(PLUGIN_ROOT, ".plugin-state.json");

const TLS_CERT_PATH = config.tls.certPath;
const TLS_KEY_PATH = config.tls.keyPath;
const TLS_CA_PATH = config.tls.caPath; 
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};


const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: https://cdn.jsdelivr.net; font-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.gstatic.com; connect-src 'self' wss: ws: https://cdn.jsdelivr.net",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const ALLOWED_CLIENT_MESSAGE_TYPES = new Set([
  "hello",
  "ping",
  "pong",
  "frame",
  "status",
  "console_output",
  "file_list_result",
  "file_download",
  "file_upload_result",
  "file_read_result",
  "file_search_result",
  "command_result",
  "command_progress",
  "process_list_result",
  "script_result",
  "plugin_event",
]);

const ALLOWED_PLATFORMS = new Set([
  "windows-amd64",
  "windows-arm64",
  "linux-amd64",
  "linux-arm64",
  "linux-armv7",
  "darwin-arm64",
]);

const pluginLoadedByClient = new Map<string, Set<string>>();
const pendingPluginEvents = new Map<string, Array<{ event: string; payload: any }>>();
const pluginLoadingByClient = new Map<string, Set<string>>();
let pluginState = { enabled: {} as Record<string, boolean>, lastError: {} as Record<string, string> };


function isAuthorizedAgentRequest(req: Request, url: URL): boolean {
  const token = config.auth.agentToken;
  const headerToken = req.headers.get("x-agent-token");
  const queryToken = url.searchParams.get("token");
  
  const isAuthed = headerToken === token || queryToken === token;
  if (!isAuthed) {
    logger.info(`[auth] Agent auth failed`);
  } else {
    logger.info(`[auth] Agent authenticated successfully`);
  }
  
  return isAuthed;
}

function sanitizeOutputName(name: string): string {
  
  const base = path.basename(name);
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned || cleaned !== base) {
    throw new Error("Invalid output filename");
  }
  return cleaned;
}

function secureHeaders(contentType?: string) {
  return {
    ...SECURITY_HEADERS,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function securePluginHeaders() {
  return {
    ...SECURITY_HEADERS,
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  };
}

type SocketRole = ClientRole | "console_viewer" | "rd_viewer" | "file_browser_viewer" | "process_viewer";

type FileBrowserViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};
type ProcessViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};
const textDecoder = new TextDecoder();

function getMessageByteLength(message: string | ArrayBuffer | Uint8Array): number {
  if (typeof message === "string") {
    return new TextEncoder().encode(message).length;
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  return message.byteLength;
}

function sendPingToClients() {
  const now = Date.now();
  let pingsSent = 0;
  for (const [id, info] of clientManager.getAllClients().entries()) {
    
    if (!info.online) continue;
    
    
    const timeSinceLastPing = info.lastPingSent ? now - info.lastPingSent : Infinity;
    if (timeSinceLastPing < 15000) continue;
    
    try {
      info.lastPingSent = now;
      info.ws.send(encodeMessage({ type: "ping", ts: now }));
      pingsSent++;
      logger.debug(`[ping] sent ping to ${id.substring(0, 8)}...`);
    } catch (err) {
      logger.error(`[ping] failed to send ping to ${id}:`, err);
    }
  }
  if (pingsSent > 0) {
    logger.debug(`[ping] sent ${pingsSent} pings to clients`);
  }
}

function pruneStale() {
  const now = Date.now();
  let processed = 0;
  for (const [id, info] of clientManager.getAllClients().entries()) {
    
    if (now - info.lastSeen > DISCONNECT_TIMEOUT_MS && info.online) {
      logger.info(`[prune] marking ${id} as offline (no heartbeat for ${DISCONNECT_TIMEOUT_MS}ms)`);
      info.online = false;
      setOnlineState(id, false);
    }
    
    if (now - info.lastSeen <= STALE_MS) continue;
    try {
      info.ws.close();
    } catch (err) {
      logger.error(`[prune] close failed for ${id}`, err);
    }
    clientManager.deleteClient(id);
    setOnlineState(id, false);
    processed += 1;
    if (processed >= PRUNE_BATCH) {
      logger.debug(`[prune] paused after ${processed} stale sockets; will continue next sweep`);
      break;
    }
  }
}

function mimeType(path: string) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function loadPluginState() {
  try {
    const raw = await fs.readFile(PLUGIN_STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { enabled?: Record<string, boolean>; lastError?: Record<string, string> };
    pluginState = {
      enabled: parsed.enabled || {},
      lastError: parsed.lastError || {},
    };
  } catch {
    pluginState = { enabled: {}, lastError: {} };
  }
}

async function savePluginState() {
  await fs.mkdir(PLUGIN_ROOT, { recursive: true });
  await fs.writeFile(PLUGIN_STATE_PATH, JSON.stringify(pluginState, null, 2));
}

function sanitizePluginId(name: string): string {
  const cleaned = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) {
    throw new Error("Invalid plugin id");
  }
  return cleaned;
}

async function ensurePluginExtracted(pluginId: string) {
  const safeId = sanitizePluginId(pluginId);
  const zipPath = path.join(PLUGIN_ROOT, `${safeId}.zip`);
  const pluginDir = path.join(PLUGIN_ROOT, safeId);
  const manifestPath = path.join(pluginDir, "manifest.json");

  let zipStat: any = null;
  try {
    zipStat = await fs.stat(zipPath);
  } catch {
    zipStat = null;
  }

  let manifestStat: any = null;
  try {
    manifestStat = await fs.stat(manifestPath);
  } catch {
    manifestStat = null;
  }

  if (!zipStat) {
    if (manifestStat) return;
    throw new Error(`Plugin bundle not found: ${safeId}`);
  }

  if (manifestStat && manifestStat.mtimeMs >= zipStat.mtimeMs) {
    return;
  }

  await fs.mkdir(pluginDir, { recursive: true });
  const assetsDir = path.join(pluginDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let wasmEntry: Buffer | null = null;
  let htmlEntry: Buffer | null = null;
  let cssEntry: Buffer | null = null;
  let jsEntry: Buffer | null = null;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const base = path.basename(entry.entryName);
    if (base.toLowerCase().endsWith(".wasm")) {
      wasmEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".html")) {
      htmlEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".css")) {
      cssEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".js")) {
      jsEntry = entry.getData();
    }
  }

  if (!wasmEntry || !htmlEntry || !cssEntry || !jsEntry) {
    throw new Error(`Invalid plugin bundle: ${safeId} (missing required files)`);
  }

  await fs.writeFile(path.join(pluginDir, `${safeId}.wasm`), wasmEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.html`), htmlEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.css`), cssEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.js`), jsEntry);

  const manifest: PluginManifest = {
    id: safeId,
    name: safeId,
    version: "1.0.0",
    binary: `${safeId}.wasm`,
    entry: `${safeId}.html`,
    assets: {
      html: `${safeId}.html`,
      css: `${safeId}.css`,
      js: `${safeId}.js`,
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function syncPluginBundles() {
  await fs.mkdir(PLUGIN_ROOT, { recursive: true });
  const entries = await fs.readdir(PLUGIN_ROOT, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".zip")) {
      const pluginId = ent.name.slice(0, -4);
      try {
        await ensurePluginExtracted(pluginId);
      } catch (err) {
        logger.warn(`[plugin] failed to extract ${pluginId}: ${(err as Error).message}`);
      }
    }
  }
}

async function listPluginManifests(): Promise<PluginManifest[]> {
  try {
    await syncPluginBundles();
    const entries = await fs.readdir(PLUGIN_ROOT, { withFileTypes: true });
    const manifests: PluginManifest[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const manifestPath = path.join(PLUGIN_ROOT, ent.name, "manifest.json");
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as PluginManifest;
        const id = manifest.id || ent.name;
        const name = manifest.name || ent.name;
        if (pluginState.enabled[id] === undefined) {
          pluginState.enabled[id] = true;
        }
        manifests.push({ ...manifest, id, name });
      } catch {}
    }
    await savePluginState();
    return manifests;
  } catch {
    return [];
  }
}

async function loadPluginBundle(pluginId: string) {
  await ensurePluginExtracted(pluginId);
  const dir = path.join(PLUGIN_ROOT, pluginId);
  const manifestPath = path.join(dir, "manifest.json");
  const rawManifest = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(rawManifest) as PluginManifest;
  manifest.id = manifest.id || pluginId;
  manifest.name = manifest.name || pluginId;

  const binaryName = manifest.binary || manifest.entry || `${pluginId}.wasm`;
  let wasmPath = path.join(dir, binaryName);
  try {
    await fs.access(wasmPath);
  } catch {
    const files = await fs.readdir(dir);
    const firstWasm = files.find((f) => f.toLowerCase().endsWith(".wasm"));
    if (!firstWasm) throw new Error("No .wasm found for plugin " + pluginId);
    wasmPath = path.join(dir, firstWasm);
  }
  const wasm = new Uint8Array(await fs.readFile(wasmPath));
  return { manifest, wasm };
}

function sendPluginBundle(target: ClientInfo, bundle: { manifest: PluginManifest; wasm: Uint8Array }) {
  const chunkSize = 16 * 1024;
  const wasm = bundle.wasm;
  const totalChunks = Math.ceil(wasm.length / chunkSize);
  const initPayload = {
    manifest: bundle.manifest,
    size: wasm.length,
    chunks: totalChunks,
  };
  target.ws.send(
    encodeMessage({
      type: "command",
      commandType: "plugin_load_init",
      id: uuidv4(),
      payload: initPayload,
    })
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, wasm.length);
    const chunk = wasm.slice(start, end);
    target.ws.send(
      encodeMessage({
        type: "command",
        commandType: "plugin_load_chunk",
        id: uuidv4(),
        payload: { pluginId: bundle.manifest.id, index: i, data: chunk },
      })
    );
  }

  target.ws.send(
    encodeMessage({
      type: "command",
      commandType: "plugin_load_finish",
      id: uuidv4(),
      payload: { pluginId: bundle.manifest.id },
    })
  );
}


async function startBuildProcess(
  buildId: string,
  config: {
    platforms: string[];
    serverUrl?: string;
    customId?: string;
    countryCode?: string;
    stripDebug?: boolean;
    disableCgo?: boolean;
    enablePersistence?: boolean;
  }
) {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  
  const build: BuildStream = {
    id: buildId,
    controllers: [],
    status: "running",
    startTime: now,
    expiresAt: now + SEVEN_DAYS_MS,
    files: [],
  };
  
  buildManager.addBuildStream(buildId, build);
  
  const sendToStream = (data: any) => {
    const encoder = new TextEncoder();
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = encoder.encode(message);
    
    
    if (data.type === "output") {
      logger.info(`[build:${buildId.substring(0, 8)}] ${data.text.trimEnd()}`);
    } else if (data.type === "status") {
      logger.info(`[build:${buildId.substring(0, 8)}] STATUS: ${data.text}`);
    } else if (data.type === "error") {
      logger.error(`[build:${buildId.substring(0, 8)}] ERROR: ${data.error}`);
    }
    
    build.controllers.forEach(controller => {
      try {
        controller.enqueue(encoded);
      } catch (err) {
        logger.error("[build] Failed to send to stream:", err);
      }
    });
  };
  
  try {
    sendToStream({ type: "status", text: "Preparing build environment..." });
    
    
    try {
      const goCheck = await $`go version`.quiet();
      const goVersion = goCheck.stdout.toString().trim();
      logger.info(`[build:${buildId.substring(0, 8)}] Using ${goVersion}`);
      sendToStream({ type: "output", text: `Using ${goVersion}\n`, level: "info" });
    } catch (err: any) {
      const errorMsg = "Go is not installed or not in PATH. Please install Go from https://golang.org/dl/ and ensure it's in your system PATH.";
      logger.error(`[build:${buildId.substring(0, 8)}] ${errorMsg}`);
      sendToStream({ type: "output", text: `ERROR: ${errorMsg}\n`, level: "error" });
      sendToStream({ type: "error", error: errorMsg });
      sendToStream({ type: "complete", success: false });
      build.status = "failed";
      return;
    }
    
    // TODO: Add support for building from remote repository or configurable paths
    
    const serverDir = process.cwd();
    const rootDir = path.resolve(serverDir, "..");
    const clientDir = path.join(rootDir, "Overlord-Client");
    const outDir = path.join(rootDir, "dist-clients");
    
    
    await Bun.$`mkdir -p ${outDir}`.quiet();
    
    sendToStream({ type: "output", text: `Build directory: ${outDir}\n`, level: "info" });
    
    
    let configJson = null;
    if (config.customId || config.countryCode) {
      configJson = {
        id: config.customId || "",
        hwid: "",
        country: config.countryCode || "",
        version: "0",
      };
      
      const configDir = `${clientDir}/config`;
      await Bun.$`mkdir -p ${configDir}`.quiet();
      
      const configPath = `${configDir}/settings.json`;
      await Bun.write(configPath, JSON.stringify(configJson, null, 2));
      sendToStream({ type: "output", text: `Created config file: ${configPath}\n`, level: "info" });
    }
    
    
    const platformsToBuild = (config.platforms || []).filter((p) => ALLOWED_PLATFORMS.has(p));
    if (platformsToBuild.length !== (config.platforms || []).length) {
      throw new Error("One or more requested platforms are not allowed");
    }

    for (const platform of platformsToBuild) {
      const [os, arch, ...rest] = platform.split("-");
      const goarm = rest[0] === "armv7" ? "7" : undefined;
      const actualArch = goarm ? "arm" : arch;
      const outputName = sanitizeOutputName(platform.includes("windows")
        ? `agent-${platform}.exe`
        : `agent-${platform}`);

      sendToStream({ type: "status", text: `Building ${platform}...` });
      sendToStream({ type: "output", text: `\n=== Building ${platform} ===\n`, level: "info" });

      const env = {
        ...process.env,
        GOOS: os,
        GOARCH: actualArch,
        CGO_ENABLED: config.disableCgo !== false ? "0" : "1",
        ...(goarm ? { GOARM: goarm } : {}),
      };

      let ldflags = config.stripDebug !== false ? "-s -w" : "";
      
      const tokenFlag = `-X overlord-client/cmd/agent/config.DefaultAgentToken=${getConfig().auth.agentToken}`;
      ldflags = ldflags ? `${ldflags} ${tokenFlag}` : tokenFlag;
      
      if (config.serverUrl) {
        const serverFlag = `-X overlord-client/cmd/agent/config.DefaultServerURL=${config.serverUrl}`;
        ldflags = `${ldflags} ${serverFlag}`;
        sendToStream({ type: "output", text: `Server URL: ${config.serverUrl}\n`, level: "info" });
      }
      
      if (config.enablePersistence) {
        const persistenceFlag = "-X overlord-client/cmd/agent/config.DefaultPersistence=true";
        ldflags = ldflags ? `${ldflags} ${persistenceFlag}` : persistenceFlag;
        sendToStream({ type: "output", text: `Persistence enabled for ${platform}\n`, level: "info" });
      }

      try {
        logger.info(`[build:${buildId.substring(0, 8)}] Building: go build ${ldflags ? `-ldflags="${ldflags}" ` : ""}-o ${outDir}/${outputName} ./cmd/agent`);
        logger.info(`[build:${buildId.substring(0, 8)}] Environment: GOOS=${os} GOARCH=${actualArch} CGO_ENABLED=${env.CGO_ENABLED}`);

        const buildCmd = ldflags
          ? $`go build -ldflags=${ldflags} -o ${outDir}/${outputName} ./cmd/agent`
          : $`go build -o ${outDir}/${outputName} ./cmd/agent`;

        const proc = buildCmd.env(env).cwd(clientDir).nothrow();

        for await (const line of proc.lines()) {
          sendToStream({ type: "output", text: line + "\n", level: "info" });
        }

        const result = await proc;
        logger.info(`[build:${buildId.substring(0, 8)}] Process exited with code: ${result.exitCode}`);

        if (result.exitCode !== 0) {
          const stderrText = result.stderr.toString();
          if (stderrText) {
            sendToStream({ type: "output", text: stderrText, level: "error" });
          }
          const errorMsg = `Build failed with exit code ${result.exitCode}\n`;
          sendToStream({ type: "output", text: errorMsg, level: "error" });
          throw new Error(`Build failed for ${platform}`);
        }

        const filePath = `${outDir}/${outputName}`;
        const file = Bun.file(filePath);
        const size = file.size;

        build.files.push({
          name: outputName,
          filename: outputName,
          platform,
          size,
        });
      } catch (err: any) {
        const errorMsg = `✗ Failed to build ${platform}: ${err.message || err}\n`;
        logger.error(`[build:${buildId.substring(0, 8)}] ${errorMsg.trim()}`);
        sendToStream({ type: "output", text: errorMsg, level: "error" });
        throw err;
      }
    }
    
    
    if (configJson) {
      try {
        await Bun.$`rm -f ${clientDir}/config/settings.json`.quiet();
      } catch (err) {
        
      }
    }
    
    build.status = "completed";
    logger.info(`[build:${buildId.substring(0, 8)}] Build completed successfully! Built ${build.files.length} file(s)`);
    sendToStream({ type: "output", text: `\n✓ Build completed successfully!\n`, level: "success" });
    sendToStream({ type: "complete", success: true, files: build.files, buildId, expiresAt: build.expiresAt });
    
    
    saveBuild({
      id: build.id,
      status: build.status,
      startTime: build.startTime,
      expiresAt: build.expiresAt,
      files: build.files as any,
    });
    
    
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    setTimeout(() => {
      logger.info(`[build:${buildId.substring(0, 8)}] Cleaning up expired build`);
      buildManager.deleteBuildStream(buildId);
    }, SEVEN_DAYS_MS);
    
  } catch (err: any) {
    build.status = "failed";
    logger.error(`[build:${buildId.substring(0, 8)}] Build failed:`, err);
    sendToStream({ type: "error", error: err.message || String(err) });
    sendToStream({ type: "complete", success: false, buildId });
    
    
    setTimeout(() => {
      logger.info(`[build:${buildId.substring(0, 8)}] Cleaning up failed build stream`);
      buildManager.deleteBuildStream(buildId);
    }, 60 * 60 * 1000);
  }
}


















function safeSendViewer(ws: ServerWebSocket<SocketData>, payload: unknown) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    logger.error("[console] viewer send failed", err);
  }
}

function safeSendViewerFrame(ws: ServerWebSocket<SocketData>, bytes: Uint8Array, header?: any): number {
  try {
    
    
    const meta = new Uint8Array(8);
    meta[0] = 0x46; 
    meta[1] = 0x52; 
    meta[2] = 0x4d; 
    meta[3] = 1;    
    meta[4] = (header?.monitor ?? 0) & 0xff;
    meta[5] = (header?.fps ?? 0) & 0xff;
    const fmt = header?.format === "blocks" ? 2 : header?.format === "blocks_raw" ? 3 : 1;
    meta[6] = fmt;    
    meta[7] = 0;

    const buf = new Uint8Array(meta.length + bytes.length);
    buf.set(meta, 0);
    buf.set(bytes, meta.length);
    ws.send(buf);
    
    
    metrics.recordBytesSent(buf.length);
    
    return buf.length;
  } catch (err) {
    logger.error("[rd] viewer frame send failed", err);
    return 0;
  }
}

const rdSendStats = { lastLog: 0, frames: 0, sendMs: 0, bytes: 0 };
// Track streaming state per client to prevent duplicate commands
const rdStreamingState = new Map<string, { isStreaming: boolean; display: number; quality: number }>();

type PendingScript = {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
};
const pendingScripts = new Map<string, PendingScript>();
function logRdSend(header?: any) {
  const now = Date.now();
  if (now - rdSendStats.lastLog < 5000) return;
  const frames = rdSendStats.frames || 1;
  const avgMs = rdSendStats.sendMs / frames;
  const avgBytes = rdSendStats.bytes / frames;
  const fpsAgent = header?.fps ?? "?";
  logger.debug(`[rd] send avg=${avgMs.toFixed(2)}ms size=${Math.round(avgBytes)}B frames=${rdSendStats.frames} agent_fps=${fpsAgent}`);
  rdSendStats.lastLog = now;
  rdSendStats.frames = 0;
  rdSendStats.sendMs = 0;
  rdSendStats.bytes = 0;
}

function sendConsoleCommand(target: ClientInfo | undefined, commandType: string, payload: Record<string, unknown>) {
  if (!target) return false;
  try {
    target.ws.send(encodeMessage({ type: "command", commandType: commandType as any, payload, id: uuidv4() }));
    metrics.recordCommand(commandType);
    return true;
  } catch (err) {
    logger.error("[console] send command failed", err);
    return false;
  }
}
function sendDesktopCommand(target: ClientInfo | undefined, commandType: string, payload: Record<string, unknown>) {
  if (!target) return false;
  try {
    logger.debug(`[rd] send command ${commandType} -> ${target.id}`);
    target.ws.send(encodeMessage({ type: "command", commandType: commandType as any, payload, id: uuidv4() }));
    metrics.recordCommand(commandType);
    return true;
  } catch (err) {
    logger.error("[rd] send command failed", err);
    return false;
  }
}

function startConsoleForViewer(target: ClientInfo | undefined, sessionId: string, cols = 120, rows = 36) {
  return sendConsoleCommand(target, "console_start", { sessionId, cols, rows });
}

function stopConsoleOnTarget(target: ClientInfo | undefined, sessionId: string) {
  return sendConsoleCommand(target, "console_stop", { sessionId });
}

function notifyConsoleClosed(clientId: string, reason: string) {
  for (const [sessionId, session] of sessionManager.getAllConsoleSessions().entries()) {
    if (session.clientId !== clientId) continue;
    safeSendViewer(session.viewer, { type: "status", status: "closed", reason, sessionId });
    sessionManager.deleteConsoleSession(sessionId);
  }
}

function handleConsoleViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId, sessionId } = ws.data;
  const target = clientManager.getClient(clientId);
  const session: ConsoleSession = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.addConsoleSession(session);
  safeSendViewer(ws, {
    type: "ready",
    sessionId,
    clientId,
    clientOnline: !!target,
    host: target?.host || clientId,
    os: target?.os,
    user: target?.user,
  });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
    return;
  }
  safeSendViewer(ws, { type: "status", status: "connecting", sessionId });
  startConsoleForViewer(target, sessionId);
}
function handleRemoteDesktopViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session: RemoteDesktopViewer = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.getAllRdSessions().set(sessionId, session);
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
    return;
  }
}
function handleRemoteDesktopViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  let json = typeof raw === "string" ? raw : textDecoder.decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  let payload: any;
  try { payload = JSON.parse(json); } catch { return; }
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) { safeSendViewer(ws, { type: "status", status: "offline" }); return; }
  
  const state = rdStreamingState.get(clientId) || { isStreaming: false, display: 0, quality: 90 };
  
  logger.debug(`[rd] inbound viewer msg type=${payload.type} client=${clientId}`);
  switch (payload.type) {
    case "desktop_start":
      if (!state.isStreaming) {
        sendDesktopCommand(target, "desktop_start", {});
        state.isStreaming = true;
        rdStreamingState.set(clientId, state);
        logger.debug(`[rd] started streaming for client ${clientId}`);
      } else {
        logger.debug(`[rd] ignoring duplicate desktop_start for client ${clientId}`);
      }
      break;
    case "desktop_stop":
      if (state.isStreaming) {
        sendDesktopCommand(target, "desktop_stop", {});
        state.isStreaming = false;
        rdStreamingState.set(clientId, state);
        logger.debug(`[rd] stopped streaming for client ${clientId}`);
      }
      break;
    case "desktop_select_display": {
      const newDisplay = Number(payload.display) || 0;
      if (state.display !== newDisplay) {
        logger.debug(`[rd] changing display from ${state.display} to ${newDisplay}`);
        sendDesktopCommand(target, "desktop_select_display", { display: newDisplay });
        state.display = newDisplay;
        rdStreamingState.set(clientId, state);
      } else {
        logger.debug(`[rd] ignoring duplicate display select ${newDisplay}`);
      }
      break;
    }
    case "desktop_set_quality": {
      const newQuality = Number(payload.quality) || 90;
      if (state.quality !== newQuality) {
        sendDesktopCommand(target, "desktop_set_quality", { quality: newQuality, codec: payload.codec || "" });
        state.quality = newQuality;
        rdStreamingState.set(clientId, state);
        logger.debug(`[rd] set quality to ${newQuality}`);
      }
      break;
    }
    case "desktop_enable_mouse": sendDesktopCommand(target, "desktop_enable_mouse", { enabled: !!payload.enabled }); break;
    case "desktop_enable_keyboard": sendDesktopCommand(target, "desktop_enable_keyboard", { enabled: !!payload.enabled }); break;
    case "desktop_enable_cursor": sendDesktopCommand(target, "desktop_enable_cursor", { enabled: !!payload.enabled }); break;
    case "mouse_move": sendDesktopCommand(target, "desktop_mouse_move", { x: Number(payload.x)||0, y: Number(payload.y)||0 }); break;
    case "mouse_down": sendDesktopCommand(target, "desktop_mouse_down", { button: Number(payload.button)||0 }); break;
    case "mouse_up": sendDesktopCommand(target, "desktop_mouse_up", { button: Number(payload.button)||0 }); break;
    case "key_down": sendDesktopCommand(target, "desktop_key_down", { key: payload.key||'', code: payload.code||'' }); break;
    case "key_up": sendDesktopCommand(target, "desktop_key_up", { key: payload.key||'', code: payload.code||'' }); break;
    default: break;
  }
}
function handleRemoteDesktopFrame(payload: any) {
  const clientId = payload.clientId as string;
  const header = payload.header;
  const bytes = payload.data as Uint8Array;
  const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  for (const session of sessionManager.getAllRdSessions().values()) {
    if (session.clientId !== clientId) continue;
    const sentBytes = safeSendViewerFrame(session.viewer, bytes, header);
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    rdSendStats.frames += 1;
    rdSendStats.bytes += sentBytes;
    rdSendStats.sendMs += t1 - t0;
  }
  logRdSend(header);
}

(globalThis as any).__rdBroadcast = (clientId: string, bytes: Uint8Array, header?: any): boolean => {
  let sent = false;
  const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  for (const session of sessionManager.getAllRdSessions().values()) {
    if (session.clientId !== clientId) continue;
    const sentBytes = safeSendViewerFrame(session.viewer, bytes, header);
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    rdSendStats.frames += 1;
    rdSendStats.bytes += sentBytes;
    rdSendStats.sendMs += t1 - t0;
    sent = true;
  }
  logRdSend(header);
  return sent; 
};

function handleFileBrowserViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session: FileBrowserViewer = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.getAllFileBrowserSessions().set(sessionId, session);
  ws.data.sessionId = sessionId;
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
    return;
  }
}

function handleFileBrowserViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  let json = typeof raw === "string" ? raw : textDecoder.decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  let payload: any;
  try { payload = JSON.parse(json); } catch { return; }
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  logger.debug(`[DEBUG] File browser message from viewer for client ${clientId}:`, payload.type, payload.commandType || '');
  const target = clientManager.getClient(clientId);
  if (!target) { 
    logger.debug(`[DEBUG] Client ${clientId} not found - sending offline status`);
    safeSendViewer(ws, { type: "status", status: "offline" }); 
    return; 
  }
  
  const commandId = uuidv4();
  
  
  if (payload.type === "command") {
    if (typeof payload.commandType !== "string") {
      return;
    }
    logger.debug(`[DEBUG] Handling command type: ${payload.commandType}`);
    const actualPayload = payload.payload || {};
    switch (payload.commandType) {
      case "file_read":
        logger.debug(`[DEBUG] Forwarding file_read to client ${clientId}:`, actualPayload.path);
        target.ws.send(encodeMessage({ type: "command", commandType: "file_read", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_read");
        break;
      case "file_write":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_write", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_write");
        break;
      case "file_search":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_search", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_search");
        break;
      case "file_copy":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_copy", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_copy");
        break;
      case "file_move":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_move", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_move");
        break;
      case "file_chmod":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_chmod", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_chmod");
        break;
      case "file_execute":
        logger.debug(`[DEBUG] Forwarding file_execute to client ${clientId}:`, actualPayload.path);
        target.ws.send(encodeMessage({ type: "command", commandType: "file_execute", id: payload.id || commandId, payload: actualPayload }));
        metrics.recordCommand("file_execute");
        break;
      default:
        break;
    }
    return;
  }
  
  
  switch (payload.type) {
    case "file_list":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_list", id: commandId, payload: { path: payload.path || "" } }));
      metrics.recordCommand("file_list");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_LIST,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_download":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_download", id: commandId, payload: { path: payload.path || "" } }));
      metrics.recordCommand("file_download");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_DOWNLOAD,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_upload": {
      
      const base64Data = payload.data || "";
      const binaryString = atob(base64Data);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "file_upload", id: commandId, payload: { path: payload.path || "", data, offset: payload.offset || 0 } }));
      metrics.recordCommand("file_upload");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_UPLOAD,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "", size: data.length, offset: payload.offset || 0 }),
        success: true,
      });
      break;
    }
    case "file_delete":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_delete", id: commandId, payload: { path: payload.path || "" } }));
      metrics.recordCommand("file_delete");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_DELETE,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_mkdir":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_mkdir", id: commandId, payload: { path: payload.path || "" } }));
      metrics.recordCommand("file_mkdir");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_MKDIR,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_zip":
      const zipCommandId = payload.commandId || commandId;
      target.ws.send(encodeMessage({ type: "command", commandType: "file_zip", id: zipCommandId, payload: { path: payload.path || "" } }));
      metrics.recordCommand("file_zip");
      logAudit({
        timestamp: Date.now(),
        username: ws.data.username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_ZIP,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "command_abort":
      
      target.ws.send(encodeMessage({ type: "command_abort", commandId: payload.commandId }));
      break;
    default: 
      break;
  }
}

function handleFileBrowserMessage(clientId: string, payload: any) {
  logger.debug(`[DEBUG] handleFileBrowserMessage from client ${clientId}:`, payload.type);
  for (const session of sessionManager.getAllFileBrowserSessions().values()) {
    if (session.clientId !== clientId) continue;
    logger.debug(`[DEBUG] Forwarding ${payload.type} to file browser viewer`);
    
    if (payload.type === 'file_download' && payload.data) {
      const encodedPayload = {
        ...payload,
        data: Buffer.from(payload.data).toString('base64')
      };
      safeSendViewer(session.viewer, encodedPayload);
    } else {
      safeSendViewer(session.viewer, payload);
    }
  }
}

function handleProcessViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session: ProcessViewer = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.getAllProcessSessions().set(sessionId, session);
  ws.data.sessionId = sessionId;
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
    return;
  }
}

function handleProcessViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  let json = typeof raw === "string" ? raw : textDecoder.decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
  let payload: any;
  try { payload = JSON.parse(json); } catch { return; }
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) { safeSendViewer(ws, { type: "status", status: "offline" }); return; }
  
  const commandId = uuidv4();
  switch (payload.type) {
    case "process_list":
      target.ws.send(encodeMessage({ type: "command", commandType: "process_list", id: commandId }));
      metrics.recordCommand("process_list");
      break;
    case "process_kill":
      target.ws.send(encodeMessage({ type: "command", commandType: "process_kill", id: commandId, payload: { pid: payload.pid } }));
      metrics.recordCommand("process_kill");
      break;
    default: 
      break;
  }
}

function handleProcessMessage(clientId: string, payload: any) {
  for (const session of sessionManager.getAllProcessSessions().values()) {
    if (session.clientId !== clientId) continue;
    safeSendViewer(session.viewer, payload);
  }
}

function markPluginLoaded(clientId: string, pluginId: string) {
  if (!clientId || !pluginId) return;
  let set = pluginLoadedByClient.get(clientId);
  if (!set) {
    set = new Set();
    pluginLoadedByClient.set(clientId, set);
  }
  set.add(pluginId);
  pluginLoadingByClient.get(clientId)?.delete(pluginId);
}

function isPluginLoaded(clientId: string, pluginId: string): boolean {
  return pluginLoadedByClient.get(clientId)?.has(pluginId) ?? false;
}

function isPluginLoading(clientId: string, pluginId: string): boolean {
  return pluginLoadingByClient.get(clientId)?.has(pluginId) ?? false;
}

function markPluginLoading(clientId: string, pluginId: string) {
  if (!clientId || !pluginId) return;
  let set = pluginLoadingByClient.get(clientId);
  if (!set) {
    set = new Set();
    pluginLoadingByClient.set(clientId, set);
  }
  set.add(pluginId);
}

function enqueuePluginEvent(clientId: string, pluginId: string, event: string, payload: any) {
  const key = `${clientId}:${pluginId}`;
  const list = pendingPluginEvents.get(key) || [];
  list.push({ event, payload });
  pendingPluginEvents.set(key, list);
}

function flushPluginEvents(clientId: string, pluginId: string) {
  const key = `${clientId}:${pluginId}`;
  const list = pendingPluginEvents.get(key);
  if (!list || list.length === 0) return;
  const target = clientManager.getClient(clientId);
  if (!target) return;
  for (const item of list) {
    target.ws.send(
      encodeMessage({
        type: "plugin_event",
        pluginId,
        event: item.event,
        payload: item.payload,
      })
    );
  }
  pendingPluginEvents.delete(key);
}

function handlePluginEvent(clientId: string, payload: any) {
  const pluginId = (payload as any).pluginId || "";
  const event = (payload as any).event || "";
  const error = (payload as any).error || "";
  logger.debug(`[plugin] client=${clientId} plugin=${pluginId} event=${event} error=${error}`);
  if (event === "loaded") {
    markPluginLoaded(clientId, pluginId);
    flushPluginEvents(clientId, pluginId);
    if (pluginId) {
      pluginState.lastError[pluginId] = "";
      void savePluginState();
    }
  }
  if (event === "unloaded") {
    pluginLoadedByClient.get(clientId)?.delete(pluginId);
  }
  if (event === "error" || error) {
    if (pluginId) {
      pluginState.lastError[pluginId] = error || String((payload as any).message || "plugin error");
      void savePluginState();
    }
  }
}

function handleConsoleViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  let json = "";
  if (typeof raw === "string") {
    json = raw;
  } else if (raw instanceof Uint8Array) {
    json = textDecoder.decode(raw);
  } else {
    json = textDecoder.decode(new Uint8Array(raw));
  }

  let payload: any;
  try {
    payload = JSON.parse(json);
  } catch {
    return;
  }
  if (!payload || typeof payload.type !== "string") {
    return;
  }

  const { clientId, sessionId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
    return;
  }

  switch (payload.type) {
    case "input": {
      const data = typeof payload.data === "string" ? payload.data : "";
      sendConsoleCommand(target, "console_input", { sessionId, data });
      break;
    }
    case "resize": {
      const cols = Number(payload.cols) || 120;
      const rows = Number(payload.rows) || 36;
      sendConsoleCommand(target, "console_resize", { sessionId, cols, rows });
      break;
    }
    case "stop": {
      stopConsoleOnTarget(target, sessionId);
      break;
    }
    default:
      break;
  }
}

function handleConsoleOutput(payload: any) {
  const sessionId = payload.sessionId as string;
  if (!sessionId) return;
  const session = sessionManager.getConsoleSession(sessionId);
  if (!session) return;
  const data = payload.data ? textDecoder.decode(payload.data as Uint8Array) : "";
  safeSendViewer(session.viewer, {
    type: "output",
    sessionId,
    data,
    exitCode: payload.exitCode,
    error: payload.error,
  });
  if (payload.exitCode !== undefined || payload.error) {
    const reason = payload.error ? payload.error : `Process exited (${payload.exitCode ?? ""})`;
    safeSendViewer(session.viewer, { type: "status", status: "closed", reason, sessionId });
    sessionManager.deleteConsoleSession(sessionId);
  }
}

async function startServer() {
  
  logger.info("[TLS] TLS/HTTPS is always enabled for security");
  await loadPluginState();
  
  
  if (!certificatesExist(TLS_CERT_PATH, TLS_KEY_PATH)) {
    logger.info("[TLS] Certificates not found, generating self-signed certificates...");
    
    
    if (!(await isOpenSSLAvailable())) {
      logger.error("[TLS] ERROR: OpenSSL is not installed or not in PATH");
      logger.error("[TLS] Please install OpenSSL:");
      logger.error("[TLS]   - Linux: apt install openssl / yum install openssl");
      logger.error("[TLS]   - macOS: brew install openssl");
      logger.error("[TLS]   - Windows: choco install openssl or download from https://slproweb.com/products/Win32OpenSSL.html");
      throw new Error("OpenSSL is required for certificate generation");
    }

    
    const localIPs = getLocalIPs();
    const hostname = process.env.OVERLORD_HOSTNAME || "localhost";
    
    try {
      await generateSelfSignedCert({
        certPath: TLS_CERT_PATH,
        keyPath: TLS_KEY_PATH,
        commonName: hostname,
        daysValid: 3650, 
        additionalIPs: localIPs,
      });
    } catch (err) {
      logger.error("[TLS] Failed to generate certificates:", err);
      throw err;
    }
  } else {
    logger.info(`[TLS] Using existing certificates: ${TLS_CERT_PATH}`);
  }

  
  let tlsOptions: { cert?: string; key?: string; ca?: string };
  try {
    const certFile = Bun.file(TLS_CERT_PATH);
    const keyFile = Bun.file(TLS_KEY_PATH);
    
    tlsOptions = {
      cert: await certFile.text(),
      key: await keyFile.text(),
    };

    
    if (TLS_CA_PATH) {
      const caFile = Bun.file(TLS_CA_PATH);
      if (await caFile.exists()) {
        tlsOptions.ca = await caFile.text();
        logger.info("[TLS] Client certificate verification enabled");
      }
    }
  } catch (err) {
    logger.error("[TLS] Failed to load certificates:", err);
    throw err;
  }

  const server = Bun.serve<SocketData>({
    port: PORT,
    hostname: HOST,
    tls: tlsOptions,
    idleTimeout: 255,
    websocket: {
      perMessageDeflate: true,
    }, 
    async fetch(req, server) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        return new Response("", { headers: CORS_HEADERS });
      }

      
      if (req.method === "POST" && url.pathname === "/api/login") {
        const ip = server.requestIP(req)?.address || "unknown";
        
        
        const rateLimitCheck = isRateLimited(ip);
        if (rateLimitCheck.limited) {
          logAudit({
            timestamp: Date.now(),
            username: "unknown",
            ip,
            action: AuditAction.LOGIN_FAILED,
            success: false,
            errorMessage: "Rate limited",
          });
          
          return new Response(
            JSON.stringify({ 
              ok: false, 
              error: `Too many failed attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.` 
            }), 
            { 
              status: 429, 
              headers: { 
                "Content-Type": "application/json",
                "Retry-After": String(rateLimitCheck.retryAfter)
              } 
            }
          );
        }

        try {
          const body = await req.json();
          const username = body?.user || "";
          const password = body?.pass || "";
          
          const user = await authenticateUser(username, password);
          
          if (user) {
            const token = await generateToken(user);
            
            
            logger.info(`[auth] User ${user.username} logged in. must_change_password =`, user.must_change_password, `(type: ${typeof user.must_change_password})`);
            
            
            logAudit({
              timestamp: Date.now(),
              username: user.username,
              ip,
              action: AuditAction.LOGIN,
              success: true,
            });
            
            
            recordSuccessfulAttempt(ip);
            
            return new Response(JSON.stringify({ 
              ok: true, 
              token,
              user: {
                username: user.username,
                role: user.role,
                id: user.id,
                mustChangePassword: Boolean(user.must_change_password),
              }
            }), {
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": `overlord_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` 
              },
            });
          }
          
          
          recordFailedAttempt(ip);
          logAudit({
            timestamp: Date.now(),
            username,
            ip,
            action: AuditAction.LOGIN_FAILED,
            success: false,
            errorMessage: "Invalid credentials",
          });
        } catch (error) {
          logger.error("[auth] Login error:", error);
          logAudit({
            timestamp: Date.now(),
            username: "unknown",
            ip,
            action: AuditAction.LOGIN_FAILED,
            success: false,
            errorMessage: String(error),
          });
        }
        
        return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), { 
          status: 401, 
          headers: { "Content-Type": "application/json" } 
        });
      }

      
      if (req.method === "POST" && url.pathname === "/api/logout") {
        const ip = server.requestIP(req)?.address || "unknown";
        const user = await getUserFromRequest(req);
        const token = extractTokenFromRequest(req);
        
        if (token) {
          revokeToken(token);
        }
        
        logAudit({
          timestamp: Date.now(),
          username: user?.username || "unknown",
          ip,
          action: AuditAction.LOGOUT,
          success: true,
        });
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `overlord_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` 
          },
        });
      }

      
      if (req.method === "GET" && url.pathname === "/api/auth/me") {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response(JSON.stringify({ error: "Not authenticated" }), { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        
        
        const dbUser = getUserById(user.userId);
        
        return new Response(JSON.stringify({
          username: user.username,
          role: user.role,
          userId: user.userId,
          mustChangePassword: dbUser ? Boolean(dbUser.must_change_password) : false,
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      
      if (req.method === "GET" && url.pathname === "/api/metrics") {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response(JSON.stringify({ error: "Not authenticated" }), { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        
        
        const snapshot = metrics.getSnapshot();
        
        
        const clientList = listClients({ page: 1, pageSize: 10000, search: "", sort: "last_seen_desc" });
        logger.debug(`[metrics] Database reports: total=${clientList.total}, online=${clientList.online}, items=${clientList.items.length}`);
        logger.debug(`[metrics] In-memory clients map size: ${clientManager.getClientCount()}`);
        
        snapshot.clients.total = clientList.total;
        snapshot.clients.online = clientList.online;
        snapshot.clients.offline = clientList.total - clientList.online;
        
        
        const byOS: Record<string, number> = {};
        const byCountry: Record<string, number> = {};
        for (const item of clientList.items) {
          
          if (!item.online) continue;
          
          if (item.os) {
            byOS[item.os] = (byOS[item.os] || 0) + 1;
          }
          if (item.country) {
            byCountry[item.country] = (byCountry[item.country] || 0) + 1;
          }
        }
        snapshot.clients.byOS = byOS;
        snapshot.clients.byCountry = byCountry;
        
        
        snapshot.sessions.console = sessionManager.getConsoleSessionCount();
        snapshot.sessions.remoteDesktop = sessionManager.getRdSessionCount();
        snapshot.sessions.fileBrowser = sessionManager.getFileBrowserSessionCount();
        snapshot.sessions.process = sessionManager.getProcessSessionCount();
        
        
        metrics.recordHistoryEntry(snapshot);
        
        
        const history = metrics.getHistory();
        
        return new Response(JSON.stringify({
          snapshot,
          history,
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      
      if (url.pathname.startsWith("/api/users")) {
        try {
          const user = await authenticateRequest(req);
          
          
          if (req.method === "GET" && url.pathname === "/api/users") {
            requirePermission(user, "users:manage");
            const users = listUsers();
            return Response.json({ users });
          }
          
          
          if (req.method === "POST" && url.pathname === "/api/users") {
            const authedUser = requirePermission(user, "users:manage");
            const body = await req.json();
            const { username, password, role } = body;
            
            if (!username || !password || !role) {
              return Response.json({ error: "Missing required fields" }, { status: 400 });
            }
            
            if (!["admin", "operator", "viewer"].includes(role)) {
              return Response.json({ error: "Invalid role" }, { status: 400 });
            }
            
            const result = await createUser(username, password, role, authedUser.username);
            
            if (result.success) {
              const ip = server.requestIP(req)?.address || "unknown";
              logAudit({
                timestamp: Date.now(),
                username: authedUser.username,
                ip,
                action: AuditAction.COMMAND,
                details: `Created user: ${username} (${role})`,
                success: true,
              });
              
              return Response.json({ success: true, userId: result.userId });
            } else {
              return Response.json({ error: result.error }, { status: 400 });
            }
          }
          
          
          if (req.method === "PUT" && url.pathname.match(/^\/api\/users\/\d+\/password$/)) {
            const userId = parseInt(url.pathname.split("/")[3]);
            const body = await req.json();
            const { password, newPassword, currentPassword } = body;
            
            
            const canChange = user.userId === userId || user.role === "admin";
            
            if (!canChange) {
              return Response.json({ error: "Permission denied" }, { status: 403 });
            }
            
            
            if (user.userId === userId && currentPassword) {
              const targetUser = getUserById(userId);
              if (!targetUser) {
                return Response.json({ error: "User not found" }, { status: 404 });
              }
              
              const isValid = await Bun.password.verify(currentPassword, targetUser.password_hash);
              if (!isValid) {
                return Response.json({ error: "Current password is incorrect" }, { status: 400 });
              }
            }
            
            const finalPassword = newPassword || password;
            if (!finalPassword) {
              return Response.json({ error: "Password required" }, { status: 400 });
            }
            
            const result = await updateUserPassword(userId, finalPassword);
            
            if (result.success) {
              const targetUser = getUserById(userId);
              const ip = server.requestIP(req)?.address || "unknown";
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.COMMAND,
                details: `Updated password for user: ${targetUser?.username}`,
                success: true,
              });
              
              
              if (user.userId === userId && targetUser) {
                const newToken = await generateToken(targetUser);
                return new Response(JSON.stringify({ 
                  success: true,
                  token: newToken
                }), {
                  headers: {
                    "Content-Type": "application/json",
                    "Set-Cookie": `overlord_token=${newToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` 
                  },
                });
              }
              
              return Response.json({ success: true });
            } else {
              return Response.json({ error: result.error }, { status: 400 });
            }
          }
          
          
          if (req.method === "PUT" && url.pathname.match(/^\/api\/users\/\d+\/role$/)) {
            const authedUser = requirePermission(user, "users:manage");
            const userId = parseInt(url.pathname.split("/")[3]);
            const body = await req.json();
            const { role } = body;
            
            if (!role || !["admin", "operator", "viewer"].includes(role)) {
              return Response.json({ error: "Invalid role" }, { status: 400 });
            }
            
            
            if (userId === authedUser.userId) {
              return Response.json({ error: "Cannot change your own role" }, { status: 400 });
            }
            
            const result = updateUserRole(userId, role);
            
            if (result.success) {
              const targetUser = getUserById(userId);
              const ip = server.requestIP(req)?.address || "unknown";
              logAudit({
                timestamp: Date.now(),
                username: authedUser.username,
                ip,
                action: AuditAction.COMMAND,
                details: `Updated role for user: ${targetUser?.username} to ${role}`,
                success: true,
              });
              
              return Response.json({ success: true });
            } else {
              return Response.json({ error: result.error }, { status: 400 });
            }
          }
          
          
          if (req.method === "DELETE" && url.pathname.match(/^\/api\/users\/\d+$/)) {
            const authedUser = requirePermission(user, "users:manage");
            const userId = parseInt(url.pathname.split("/")[3]);
            
            
            if (userId === authedUser.userId) {
              return Response.json({ error: "Cannot delete your own account" }, { status: 400 });
            }
            
            const targetUser = getUserById(userId);
            const result = deleteUser(userId);
            
            if (result.success) {
              const ip = server.requestIP(req)?.address || "unknown";
              logAudit({
                timestamp: Date.now(),
                username: authedUser.username,
                ip,
                action: AuditAction.COMMAND,
                details: `Deleted user: ${targetUser?.username}`,
                success: true,
              });
              
              return Response.json({ success: true });
            } else {
              return Response.json({ error: result.error }, { status: 400 });
            }
          }
          
          return new Response("Not found", { status: 404 });
        } catch (error) {
          if (error instanceof Response) {
            return error;
          }
          logger.error("[users] API error:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      }

      
      if (url.pathname.startsWith("/api/build")) {
        try {
          const user = await authenticateRequest(req);
          
          
          if (req.method === "POST" && url.pathname === "/api/build/start") {
            requirePermission(user, "clients:control");
            
            const body = await req.json();
            const { platforms, serverUrl, customId, countryCode, stripDebug, disableCgo, enablePersistence } = body;
            
            if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
              return Response.json({ error: "No platforms specified" }, { status: 400 });
            }

            
            const safeCustomId = typeof customId === "string" && customId.length <= 64 ? customId : undefined;
            const safeCountry = typeof countryCode === "string" && /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : undefined;
            const sanitizedPlatforms = platforms.filter((p: string) => typeof p === "string");
            if (sanitizedPlatforms.length !== platforms.length) {
              return Response.json({ error: "Invalid platform entries" }, { status: 400 });
            }
            
            const buildId = uuidv4();
            const ip = server.requestIP(req)?.address || "unknown";
            
            logAudit({
              timestamp: Date.now(),
              username: user.username,
              ip,
              action: AuditAction.COMMAND,
              details: `Started build ${buildId} for platforms: ${sanitizedPlatforms.join(", ")}`,
              success: true,
            });
            
            
            startBuildProcess(buildId, { platforms: sanitizedPlatforms, serverUrl, customId: safeCustomId, countryCode: safeCountry, stripDebug, disableCgo, enablePersistence });
            
            return Response.json({ buildId });
          }
          
          
          if (req.method === "GET" && url.pathname === "/api/build/list") {
            requirePermission(user, "clients:control");
            
            const builds = getAllBuilds();
            return Response.json({ builds });
          }
          
          
          if (req.method === "DELETE" && url.pathname.match(/^\/api\/build\/(.+)\/delete$/)) {
            requirePermission(user, "clients:control");
            
            const buildId = url.pathname.split("/")[3];
            
            
            buildManager.deleteBuildStream(buildId);
            
            
            deleteBuild(buildId);
            
            const ip = server.requestIP(req)?.address || "unknown";
            logAudit({
              timestamp: Date.now(),
              username: user.username,
              ip,
              action: AuditAction.COMMAND,
              details: `Deleted build ${buildId}`,
              success: true,
            });
            
            return Response.json({ success: true });
          }
          
          
          if (req.method === "GET" && url.pathname.match(/^\/api\/build\/(.+)\/stream$/)) {
            requirePermission(user, "clients:control");
            
            const buildId = url.pathname.split("/")[3];
            const build = buildManager.getBuildStream(buildId);
            
            if (!build) {
              return Response.json({ error: "Build not found" }, { status: 404 });
            }
            
            logger.info(`[build:${buildId.substring(0, 8)}] Client connected to stream`);
            
            
            const stream = new ReadableStream({
              start(controller) {
                
                build.controllers.push(controller);
                logger.info(`[build:${buildId.substring(0, 8)}] Added controller, total: ${build.controllers.length}`);
                
                
                const encoder = new TextEncoder();
                try {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "status", text: "Connected to build stream" })}\n\n`));
                } catch (err) {
                  logger.error(`[build:${buildId.substring(0, 8)}] Failed to send initial message:`, err);
                }
              },
              cancel() {
                const index = build.controllers.indexOf(this);
                if (index > -1) {
                  build.controllers.splice(index, 1);
                  logger.info(`[build:${buildId.substring(0, 8)}] Controller removed, remaining: ${build.controllers.length}`);
                }
              }
            });
            
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no", 
              },
            });
          }
          
          
          if (req.method === "GET" && url.pathname.match(/^\/api\/build\/(.+)\/info$/)) {
            requirePermission(user, "clients:control");
            
            const buildId = url.pathname.split("/")[3];
            let build = buildManager.getBuildStream(buildId);
            
            
            if (!build) {
              const dbBuild = getBuild(buildId);
              if (!dbBuild) {
                return Response.json({ error: "Build not found" }, { status: 404 });
              }
              return Response.json({
                id: dbBuild.id,
                status: dbBuild.status,
                startTime: dbBuild.startTime,
                expiresAt: dbBuild.expiresAt,
                files: dbBuild.files,
              });
            }
            
            return Response.json({
              id: build.id,
              status: build.status,
              startTime: build.startTime,
              expiresAt: build.expiresAt,
              files: build.files,
            });
          }
          
          
          if (req.method === "GET" && url.pathname.match(/^\/api\/build\/download\//)) {
            requirePermission(user, "clients:control");
            
            const fileName = url.pathname.split("/api/build/download/")[1];
            
            const serverDir = process.cwd();
            const rootDir = path.resolve(serverDir, "..");
            const filePath = path.join(rootDir, "dist-clients", fileName);
            
            const file = Bun.file(filePath);
            if (!(await file.exists())) {
              return Response.json({ error: "File not found" }, { status: 404 });
            }
            
            return new Response(file, {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${fileName}"`,
              },
            });
          }
          
          return new Response("Not found", { status: 404 });
        } catch (error) {
          if (error instanceof Response) {
            return error;
          }
          logger.error("[build] API error:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      }

      
      
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        const file = Bun.file(`${PUBLIC_ROOT}${url.pathname}`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType(url.pathname)) });
        }
        return new Response("Not found", { status: 404 });
      }

      
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const authed = await authenticateRequest(req);
        
        
        if (authed) {
          const dbUser = getUserById(authed.userId);
          if (dbUser && dbUser.must_change_password) {
            const changePassFile = Bun.file(`${PUBLIC_ROOT}/change-password.html`);
            if (await changePassFile.exists()) {
              return new Response(changePassFile, { headers: secureHeaders(mimeType("/change-password.html")) });
            }
          }
        }
        
        const filePath = authed ? "/index.html" : "/login.html";
        const file = Bun.file(`${PUBLIC_ROOT}${filePath}`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType(filePath)) });
        }
      }
      
      
      if (req.method === "GET" && url.pathname === "/change-password.html") {
        const file = Bun.file(`${PUBLIC_ROOT}/change-password.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("/change-password.html")) });
        }
      }

      if (req.method === "GET" && url.pathname === "/remotedesktop") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        const dbUser = getUserById(user.userId);
        if (dbUser && dbUser.must_change_password) {
          const changePassFile = Bun.file(`${PUBLIC_ROOT}/change-password.html`);
          if (await changePassFile.exists()) {
            return new Response(changePassFile, { headers: secureHeaders(mimeType("/change-password.html")) });
          }
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const file = Bun.file(`${PUBLIC_ROOT}/remotedesktop.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("remotedesktop.html")) });
        }
      }

      
      if (req.method === "GET" && url.pathname === "/metrics") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        
        const dbUser = getUserById(user.userId);
        if (dbUser && dbUser.must_change_password) {
          const changePassFile = Bun.file(`${PUBLIC_ROOT}/change-password.html`);
          if (await changePassFile.exists()) {
            return new Response(changePassFile, { headers: secureHeaders(mimeType("/change-password.html")) });
          }
        }
        
        const file = Bun.file(`${PUBLIC_ROOT}/metrics.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("metrics.html")) });
        }
      }

      
      if (req.method === "GET" && url.pathname === "/users") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        
        const dbUser = getUserById(user.userId);
        if (dbUser && dbUser.must_change_password) {
          const changePassFile = Bun.file(`${PUBLIC_ROOT}/change-password.html`);
          if (await changePassFile.exists()) {
            return new Response(changePassFile, { headers: secureHeaders(mimeType("/change-password.html")) });
          }
        }
        
        
        if (user.role !== "admin") {
          return new Response("Forbidden: Admin access required", { status: 403 });
        }
        
        const file = Bun.file(`${PUBLIC_ROOT}/users.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("users.html")) });
        }
      }

      
      if (req.method === "GET" && url.pathname === "/build") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        
        if (user.role !== "admin" && user.role !== "operator") {
          return new Response("Forbidden: Admin or operator access required", { status: 403 });
        }
        
        const file = Bun.file(`${PUBLIC_ROOT}/build.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("build.html")) });
        }
      }

      if (req.method === "GET" && url.pathname === "/plugins") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }

        if (user.role !== "admin" && user.role !== "operator") {
          return new Response("Forbidden: Admin or operator access required", { status: 403 });
        }

        const file = Bun.file(`${PUBLIC_ROOT}/plugins.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("plugins.html")) });
        }
      }

      const consolePageMatch = url.pathname.match(/^\/(.+)\/console$/);
      if (req.method === "GET" && consolePageMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const file = Bun.file(`${PUBLIC_ROOT}/console.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("console.html")) });
        }
      }

      if (url.pathname === "/health") {
        return new Response("ok", { headers: CORS_HEADERS });
      }

      
      if (req.method === "GET" && url.pathname === "/api/plugins") {
        if (!(await authenticateRequest(req))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const plugins = await listPluginManifests();
        const enriched = plugins.map((p) => ({
          ...p,
          enabled: pluginState.enabled[p.id] !== false,
          lastError: pluginState.lastError[p.id] || "",
        }));
        return Response.json({ plugins: enriched });
      }

      const clientPluginsMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins$/);
      if (req.method === "GET" && clientPluginsMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          requirePermission(user, "clients:control");
        } catch (error) {
          if (error instanceof Response) return error;
          return new Response("Forbidden", { status: 403 });
        }

        const clientId = clientPluginsMatch[1];
        const loaded = pluginLoadedByClient.get(clientId) || new Set<string>();
        const manifests = await listPluginManifests();
        const plugins = manifests.map((manifest) => ({
          id: manifest.id,
          name: manifest.name || manifest.id,
          loaded: loaded.has(manifest.id),
          enabled: pluginState.enabled[manifest.id] !== false,
          lastError: pluginState.lastError[manifest.id] || "",
        }));
        return Response.json({ plugins });
      }

      if (req.method === "POST" && url.pathname === "/api/plugins/upload") {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (user.role !== "admin" && user.role !== "operator") {
          return new Response("Forbidden: Admin or operator access required", { status: 403 });
        }

        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
          return new Response("Missing file", { status: 400 });
        }

        const filename = file.name || "plugin.zip";
        if (!filename.toLowerCase().endsWith(".zip")) {
          return new Response("Only .zip files are supported", { status: 400 });
        }

        const base = path.basename(filename, path.extname(filename));
        let pluginId = "";
        try {
          pluginId = sanitizePluginId(base);
        } catch (err) {
          return new Response("Invalid plugin name", { status: 400 });
        }

        await fs.mkdir(PLUGIN_ROOT, { recursive: true });
        const zipPath = path.join(PLUGIN_ROOT, `${pluginId}.zip`);
        const data = new Uint8Array(await file.arrayBuffer());
        await fs.writeFile(zipPath, data);

        try {
          await ensurePluginExtracted(pluginId);
        } catch (err) {
          return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
        }

        if (pluginState.enabled[pluginId] === undefined) {
          pluginState.enabled[pluginId] = true;
          await savePluginState();
        }

        return Response.json({ ok: true, id: pluginId });
      }

      const pluginEnableMatch = url.pathname.match(/^\/api\/plugins\/(.+)\/enable$/);
      if (req.method === "POST" && pluginEnableMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (user.role !== "admin" && user.role !== "operator") {
          return new Response("Forbidden: Admin or operator access required", { status: 403 });
        }
        let pluginId = "";
        try {
          pluginId = sanitizePluginId(pluginEnableMatch[1]);
        } catch {
          return new Response("Invalid plugin id", { status: 400 });
        }
        let body: any = {};
        try {
          body = await req.json();
        } catch {}
        const enabled = !!body.enabled;
        pluginState.enabled[pluginId] = enabled;
        await savePluginState();
        return Response.json({ ok: true, id: pluginId, enabled });
      }

      const pluginDeleteMatch = url.pathname.match(/^\/api\/plugins\/(.+)$/);
      if (req.method === "DELETE" && pluginDeleteMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (user.role !== "admin" && user.role !== "operator") {
          return new Response("Forbidden: Admin or operator access required", { status: 403 });
        }

        let pluginId = "";
        try {
          pluginId = sanitizePluginId(pluginDeleteMatch[1]);
        } catch {
          return new Response("Invalid plugin id", { status: 400 });
        }

        const zipPath = path.join(PLUGIN_ROOT, `${pluginId}.zip`);
        const pluginDir = path.join(PLUGIN_ROOT, pluginId);

        try {
          await fs.rm(zipPath, { force: true });
        } catch {}

        try {
          await fs.rm(pluginDir, { recursive: true, force: true });
        } catch {}

        pluginLoadedByClient.forEach((set) => set.delete(pluginId));
        pluginLoadingByClient.forEach((set) => set.delete(pluginId));
        delete pluginState.enabled[pluginId];
        delete pluginState.lastError[pluginId];
        await savePluginState();

        return Response.json({ ok: true, id: pluginId });
      }

      const pluginFrameMatch = url.pathname.match(/^\/plugins\/([^/]+)\/frame$/);
      if (req.method === "GET" && pluginFrameMatch) {
        let pluginId = "";
        try {
          pluginId = sanitizePluginId(pluginFrameMatch[1]);
        } catch {
          return new Response("Invalid plugin id", { status: 400 });
        }

        const htmlFile = path.join(PLUGIN_ROOT, pluginId, "assets", `${pluginId}.html`);
        const file = Bun.file(htmlFile);
        if (!(await file.exists())) {
          return new Response("Not found", { status: 404 });
        }

        const raw = await file.text();
        const baseTag = `<base href="/plugins/${pluginId}/assets/" />`;
        const bridgeTag = `<script src="/assets/plugin-bridge.js"></script>`;
        let injected = raw;

        const headMatch = raw.match(/<head[^>]*>/i);
        if (headMatch) {
          injected = raw.replace(headMatch[0], `${headMatch[0]}\n    ${baseTag}`);
        }

        if (injected.includes("</head>")) {
          injected = injected.replace("</head>", `    ${bridgeTag}\n  </head>`);
        } else if (injected.includes("</body>")) {
          injected = injected.replace("</body>", `  ${bridgeTag}\n</body>`);
        } else {
          injected = `${bridgeTag}\n${injected}`;
        }

        return new Response(injected, { headers: { ...securePluginHeaders(), "Content-Type": "text/html; charset=utf-8" } });
      }

      const pluginPageMatch = url.pathname.match(/^\/plugins\/([^/]+)$/);
      if (req.method === "GET" && pluginPageMatch) {
        let pluginId = "";
        try {
          pluginId = sanitizePluginId(pluginPageMatch[1]);
        } catch {
          return new Response("Invalid plugin id", { status: 400 });
        }

        const clientId = url.searchParams.get("clientId") || "";
        const bridgeToken = uuidv4();
        const origin = url.origin;
        const iframeSrc = `/plugins/${pluginId}/frame?clientId=${encodeURIComponent(clientId)}&token=${encodeURIComponent(bridgeToken)}&origin=${encodeURIComponent(origin)}`;

        const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pluginId} - Overlord Plugin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
      rel="stylesheet"
    />
    <script src="https://cdn.tailwindcss.com"></script>
    <link
      rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
      crossorigin="anonymous"
      referrerpolicy="no-referrer"
    />
    <link rel="stylesheet" href="/assets/main.css" />
  </head>
  <body class="min-h-screen bg-slate-950 text-slate-100">
    <header id="top-nav"></header>
    <main class="px-5 py-6">
      <div class="max-w-6xl mx-auto">
        <div class="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <iframe
            id="plugin-frame"
            src="${iframeSrc}"
            sandbox="allow-scripts"
            class="w-full h-[calc(100vh-220px)] bg-slate-950"
          ></iframe>
        </div>
      </div>
    </main>
    <div
      id="plugin-host"
      data-bridge-token="${bridgeToken}"
    ></div>
    <script type="module" src="/assets/nav.js"></script>
    <script src="/assets/plugin-host.js"></script>
  </body>
</html>`;

        return new Response(html, { headers: secureHeaders("text/html; charset=utf-8") });
      }

      
      const pluginAssetMatch = url.pathname.match(/^\/plugins\/([^/]+)\/assets\/(.+)$/);
      if (req.method === "GET" && pluginAssetMatch) {
        const [, pluginId, assetPath] = pluginAssetMatch;
        const safePath = assetPath.replace(/\\/g, "/").replace(/\.\.+/g, "");
        const file = Bun.file(path.join(PLUGIN_ROOT, pluginId, "assets", safePath));
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType(assetPath)) });
        }
        return new Response("Not found", { status: 404 });
      }

      if (url.pathname === "/api/clients") {
        if (!(await authenticateRequest(req))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") || 12));
        const search = (url.searchParams.get("q") || "").toLowerCase().trim();
        const sort = url.searchParams.get("sort") || "last_seen_desc";
        const result = listClients({ page, pageSize, search, sort });
        return Response.json(result, { headers: CORS_HEADERS });
      }

      // Request thumbnail generation for a specific client
      const thumbnailMatch = url.pathname.match(/^\/api\/clients\/(.+)\/thumbnail$/);
      if (req.method === "POST" && thumbnailMatch) {
        if (!(await authenticateRequest(req))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const clientId = thumbnailMatch[1];
        const { generateThumbnail } = await import("./thumbnails");
        const success = generateThumbnail(clientId);
        return Response.json({ ok: success }, { headers: CORS_HEADERS });
      }

      if (req.method === "POST") {
        const cmdMatch = url.pathname.match(/^\/api\/clients\/(.+)\/command$/);
        if (cmdMatch) {
          const user = await authenticateRequest(req);
          if (!user) return new Response("Unauthorized", { status: 401 });
          
          
          try {
            requirePermission(user, "clients:control");
          } catch (error) {
            if (error instanceof Response) return error;
            return new Response("Forbidden", { status: 403 });
          }
          
          const targetId = cmdMatch[1];
          const target = clientManager.getClient(targetId);
          const ip = server.requestIP(req)?.address || "unknown";
          
          if (!target) return new Response("Not found", { status: 404 });
          try {
            const body = await req.json();
            const action = body?.action;
            
            let success = true;
            if (action === "ping") {
              const ts = Date.now();
              target.lastPingSent = ts;
              target.ws.send(encodeMessage({ type: "ping", ts }));
            } else if (action === "ping_bulk") {
              const count = Math.max(1, Math.min(1000, Number(body?.count || 1)));
              for (let i = 0; i < count; i++) {
                const ts = Date.now();
                target.lastPingSent = ts;
                target.ws.send(encodeMessage({ type: "ping", ts }));
              }
            } else if (action === "disconnect") {
              target.ws.send(encodeMessage({ type: "command", commandType: "disconnect", id: uuidv4() }));
              metrics.recordCommand("disconnect");
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.DISCONNECT,
                targetClientId: targetId,
                success: true,
              });
            } else if (action === "reconnect") {
              target.ws.send(encodeMessage({ type: "command", commandType: "reconnect", id: uuidv4() }));
              metrics.recordCommand("reconnect");
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.RECONNECT,
                targetClientId: targetId,
                success: true,
              });
            } else if (action === "screenshot") {
              target.ws.send(encodeMessage({ type: "command", commandType: "screenshot", id: uuidv4() }));
              metrics.recordCommand("screenshot");
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.SCREENSHOT,
                targetClientId: targetId,
                success: true,
              });
            } else if (action === "desktop_start") {
              target.ws.send(encodeMessage({ type: "command", commandType: "desktop_start", id: uuidv4() }));
              metrics.recordCommand("desktop_start");
            } else if (action === "script_exec") {
              const scriptContent = body?.script || "";
              const scriptType = body?.scriptType || "powershell";
              const cmdId = uuidv4();
              
              const resultPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  pendingScripts.delete(cmdId);
                  reject(new Error("Script execution timed out after 5 minutes"));
                }, 5 * 60 * 1000); // 5 minute timeout
                
                pendingScripts.set(cmdId, { resolve, reject, timeout });
              });
              
              target.ws.send(encodeMessage({ 
                type: "command", 
                commandType: "script_exec", 
                id: cmdId, 
                payload: { script: scriptContent, type: scriptType } 
              }));
              
              metrics.recordCommand("script_exec");
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.SCRIPT_EXECUTE,
                targetClientId: targetId,
                success: true,
                details: `script_exec (${scriptType})`,
              });
              
              // Wait for result
              try {
                const result = await resultPromise;
                return Response.json(result);
              } catch (error: any) {
                return Response.json({ ok: false, error: error.message }, { status: 500 });
              }
            } else if (action === "uninstall") {
              target.ws.send(encodeMessage({ type: "command", commandType: "uninstall", id: uuidv4() }));
              metrics.recordCommand("uninstall");
              logAudit({
                timestamp: Date.now(),
                username: user.username,
                ip,
                action: AuditAction.UNINSTALL,
                targetClientId: targetId,
                details: "Agent uninstall requested - persistence will be removed",
                success: true,
              });
            } else {
              success = false;
              return new Response("Bad request", { status: 400 });
            }
            
            
            logAudit({
              timestamp: Date.now(),
              username: user.username,
              ip,
              action: AuditAction.COMMAND,
              targetClientId: targetId,
              details: action,
              success,
            });
            
            return Response.json({ ok: true });
          } catch (error) {
            logAudit({
              timestamp: Date.now(),
              username: user.username,
              ip,
              action: AuditAction.COMMAND,
              targetClientId: targetId,
              success: false,
              errorMessage: String(error),
            });
            return new Response("Bad request", { status: 400 });
          }
        }

        const pluginLoadMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/load$/);
        if (pluginLoadMatch) {
          const user = await authenticateRequest(req);
          if (!user) return new Response("Unauthorized", { status: 401 });
          try {
            requirePermission(user, "clients:control");
          } catch (error) {
            if (error instanceof Response) return error;
            return new Response("Forbidden", { status: 403 });
          }
          const targetId = pluginLoadMatch[1];
          const pluginId = pluginLoadMatch[2];
          const target = clientManager.getClient(targetId);
          if (!target) return new Response("Not found", { status: 404 });
          if (isPluginLoaded(targetId, pluginId)) {
            return Response.json({ ok: true, alreadyLoaded: true });
          }
          if (isPluginLoading(targetId, pluginId)) {
            return Response.json({ ok: true, loading: true });
          }
          try {
            const bundle = await loadPluginBundle(pluginId);
            markPluginLoading(targetId, pluginId);
            sendPluginBundle(target, bundle);
            metrics.recordCommand("plugin_load");
            return Response.json({ ok: true });
          } catch (err) {
            return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
          }
        }

        const pluginEventMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/event$/);
        if (pluginEventMatch) {
          const user = await authenticateRequest(req);
          if (!user) return new Response("Unauthorized", { status: 401 });
          try {
            requirePermission(user, "clients:control");
          } catch (error) {
            if (error instanceof Response) return error;
            return new Response("Forbidden", { status: 403 });
          }

          const targetId = pluginEventMatch[1];
          const pluginId = pluginEventMatch[2];
          const target = clientManager.getClient(targetId);
          if (!target) return new Response("Not found", { status: 404 });
          if (pluginState.enabled[pluginId] === false) {
            return Response.json({ ok: false, error: "Plugin disabled" }, { status: 400 });
          }

          let body: any = {};
          try {
            body = await req.json();
          } catch {
            body = {};
          }
          const event = typeof body.event === "string" ? body.event : "";
          const payload = body.payload;
          if (!event) {
            return new Response("Bad request", { status: 400 });
          }

          if (!isPluginLoaded(targetId, pluginId)) {
            enqueuePluginEvent(targetId, pluginId, event, payload);
            if (!isPluginLoading(targetId, pluginId)) {
              try {
                const bundle = await loadPluginBundle(pluginId);
                markPluginLoading(targetId, pluginId);
                sendPluginBundle(target, bundle);
                metrics.recordCommand("plugin_load");
              } catch (err) {
                return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
              }
            }
            metrics.recordCommand("plugin_event");
            return Response.json({ ok: true, queued: true });
          }

          target.ws.send(
            encodeMessage({
              type: "plugin_event",
              pluginId,
              event,
              payload,
            })
          );
          metrics.recordCommand("plugin_event");
          return Response.json({ ok: true });
        }

        const pluginUnloadMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/unload$/);
        if (pluginUnloadMatch) {
          const user = await authenticateRequest(req);
          if (!user) return new Response("Unauthorized", { status: 401 });
          try {
            requirePermission(user, "clients:control");
          } catch (error) {
            if (error instanceof Response) return error;
            return new Response("Forbidden", { status: 403 });
          }

          const targetId = pluginUnloadMatch[1];
          const pluginId = pluginUnloadMatch[2];
          const target = clientManager.getClient(targetId);
          if (!target) return new Response("Not found", { status: 404 });

          target.ws.send(
            encodeMessage({
              type: "command",
              commandType: "plugin_unload",
              id: uuidv4(),
              payload: { pluginId },
            })
          );

          pluginLoadedByClient.get(targetId)?.delete(pluginId);
          pluginLoadingByClient.get(targetId)?.delete(pluginId);
          pendingPluginEvents.delete(`${targetId}:${pluginId}`);

          return Response.json({ ok: true, id: pluginId });
        }

      }

      const consoleWsMatch = url.pathname.match(/^\/api\/clients\/(.+)\/console\/ws$/);
      if (consoleWsMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const clientId = consoleWsMatch[1];
        const sessionId = uuidv4();
        const ip = server.requestIP(req)?.address || "";
        if (server.upgrade(req, { data: { role: "console_viewer", clientId, sessionId, ip, userRole: user.role } })) {
          return new Response();
        }
        return new Response("Upgrade failed", { status: 500 });
      }

      const wsMatch = url.pathname.match(/^\/api\/clients\/(.+)\/stream\/ws$/);
      if (wsMatch) {
        logger.info(`[auth] Checking agent authorization for client connection`);
        if (!isAuthorizedAgentRequest(req, url)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const clientId = wsMatch[1];
        const role = (url.searchParams.get("role") as ClientRole) || "viewer";
        const ip = server.requestIP(req)?.address || "";
        if (server.upgrade(req, { data: { role, clientId, ip } })) {
          return new Response();
        }
        return new Response("Upgrade failed", { status: 500 });
      }

      const rdMatch = url.pathname.match(/^\/api\/clients\/(.+)\/rd\/ws$/);
      if (rdMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const clientId = rdMatch[1];
        const ip = server.requestIP(req)?.address || "";
        if (server.upgrade(req, { data: { role: "rd_viewer", clientId, ip, userRole: user.role } })) {
          return new Response();
        }
        return new Response("Upgrade failed", { status: 500 });
      }

      const fbMatch = url.pathname.match(/^\/api\/clients\/(.+)\/files\/ws$/);
      if (fbMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const clientId = fbMatch[1];
        const ip = server.requestIP(req)?.address || "";
        if (server.upgrade(req, { data: { role: "file_browser_viewer", clientId, ip, userRole: user.role } })) {
          return new Response();
        }
        return new Response("Upgrade failed", { status: 500 });
      }

      const processMatch = url.pathname.match(/^\/api\/clients\/(.+)\/processes\/ws$/);
      if (processMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const clientId = processMatch[1];
        const ip = server.requestIP(req)?.address || "";
        if (server.upgrade(req, { data: { role: "process_viewer", clientId, ip, userRole: user.role } })) {
          return new Response();
        }
        return new Response("Upgrade failed", { status: 500 });
      }

      const filesPageMatch = url.pathname.match(/^\/(.+)\/files$/);
      if (req.method === "GET" && filesPageMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const file = Bun.file(`${PUBLIC_ROOT}/filebrowser.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("filebrowser.html")) });
        }
      }

      const processesPageMatch = url.pathname.match(/^\/(.+)\/processes$/);
      if (req.method === "GET" && processesPageMatch) {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
        }
        const file = Bun.file(`${PUBLIC_ROOT}/processes.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("processes.html")) });
        }
      }

      
      if (req.method === "GET" && url.pathname === "/users") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        
        const file = Bun.file(`${PUBLIC_ROOT}/users.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("users.html")) });
        }
      }

      
      if (req.method === "GET" && url.pathname === "/scripts") {
        const user = await authenticateRequest(req);
        if (!user) {
          const loginFile = Bun.file(`${PUBLIC_ROOT}/login.html`);
          if (await loginFile.exists()) {
            return new Response(loginFile, { headers: secureHeaders(mimeType("/login.html")) });
          }
          return new Response("Unauthorized", { status: 401 });
        }
        
        
        if (user.role === "viewer") {
          return new Response("Forbidden: Viewers cannot execute scripts", { status: 403 });
        }
        
        const file = Bun.file(`${PUBLIC_ROOT}/scripts.html`);
        if (await file.exists()) {
          return new Response(file, { headers: secureHeaders(mimeType("scripts.html")) });
        }
      }

      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const { role, clientId, ip } = ws.data;
        if (role === "console_viewer") {
          handleConsoleViewerOpen(ws as ServerWebSocket<SocketData>);
          return;
        }
        if (role === "rd_viewer") {
          handleRemoteDesktopViewerOpen(ws as ServerWebSocket<SocketData>);
          return;
        }
        if (role === "file_browser_viewer") {
          handleFileBrowserViewerOpen(ws as ServerWebSocket<SocketData>);
          return;
        }
        if (role === "process_viewer") {
          handleProcessViewerOpen(ws as ServerWebSocket<SocketData>);
          return;
        }
        const id = clientId || uuidv4();
        const info: ClientInfo = { id, role, ws, lastSeen: Date.now(), country: "" };
        clientManager.addClient(id, info);
        
        ws.data.clientId = id;
        ws.data.ip = ip;
        upsertClientRow({ id, role, lastSeen: info.lastSeen, online: 1 });
        logger.info(`[open] ${id} role=${role}`);
        ws.send(encodeMessage({ type: "hello_ack", id }));
        
        
        if (role === "client") {
          metrics.recordConnection();
        }
      },
      message(ws, message) {
        const size = getMessageByteLength(message as any);
        const role = ws.data?.role as SocketRole | undefined;
        const limit = role === "client" ? MAX_WS_MESSAGE_BYTES_CLIENT : MAX_WS_MESSAGE_BYTES_VIEWER;
        if (size > limit) {
          logger.warn(`[ws] closing socket due to oversized message (${size} > ${limit}) role=${role || "unknown"}`);
          try {
            ws.close(1009, "Message too large");
          } catch {}
          return;
        }
        if (ws.data.role === "console_viewer") {
          handleConsoleViewerMessage(ws as ServerWebSocket<SocketData>, message);
          return;
        }
        if (ws.data.role === "rd_viewer") {
          handleRemoteDesktopViewerMessage(ws as ServerWebSocket<SocketData>, message);
          return;
        }
        if (ws.data.role === "file_browser_viewer") {
          handleFileBrowserViewerMessage(ws as ServerWebSocket<SocketData>, message);
          return;
        }
        if (ws.data.role === "process_viewer") {
          handleProcessViewerMessage(ws as ServerWebSocket<SocketData>, message);
          return;
        }
        const { clientId, ip } = ws.data;
        const info = clientManager.getClient(clientId);
        if (!info) return;
        info.lastSeen = Date.now();

        try {
          const payload = decodeMessage(message as Uint8Array) as WireMessage;
          if (!payload || typeof (payload as any).type !== "string") {
            return;
          }
          if (!ALLOWED_CLIENT_MESSAGE_TYPES.has((payload as any).type)) {
            logger.warn(`[message] Dropping unknown client message type: ${(payload as any).type}`);
            return;
          }
          switch (payload?.type) {
            case "hello":
              handleHello(info, payload, ws, ip);
              clientManager.addClient(info.id, info);
              break;
            case "ping":
              handlePing(info, payload, ws);
              break;
            case "pong":
              handlePong(info, payload);
              break;
            case "frame":
              handleFrame(info, payload);
              break;
            case "console_output":
              handleConsoleOutput(payload);
              break;
            case "file_list_result":
            case "file_download":
            case "file_upload_result":
            case "file_read_result":
            case "file_search_result":
            case "command_result":
              
              handleFileBrowserMessage(info.id, payload);
              break;
            case "command_progress":
              
              handleFileBrowserMessage(info.id, payload);
              break;
            case "process_list_result":
              
              handleProcessMessage(info.id, payload);
              break;
            case "script_result":
              logger.debug(`[script] client=${info.id} ok=${payload.ok} output_length=${payload.output?.length || 0}`);
              const cmdId = (payload as any).commandId;
              if (cmdId && pendingScripts.has(cmdId)) {
                const pending = pendingScripts.get(cmdId)!;
                clearTimeout(pending.timeout);
                pending.resolve({
                  ok: (payload as any).ok,
                  result: (payload as any).output || "",
                  error: (payload as any).error,
                });
                pendingScripts.delete(cmdId);
              }
              break;
            case "plugin_event":
              handlePluginEvent(info.id, payload);
              break;
            default:
              break;
          }
        } catch (err) {
          logger.error("[message] decode error", err);
        }
      },
      close(ws, code, reason) {
        const { clientId, role, sessionId } = ws.data;
        if (role === "console_viewer") {
          if (sessionId) {
            sessionManager.deleteConsoleSession(sessionId);
            const target = clientManager.getClient(clientId);
            stopConsoleOnTarget(target, sessionId);
          }
          return;
        }
        if (role === "rd_viewer") {
          let removedClientId = clientId;
          for (const [sid, sess] of sessionManager.getAllRdSessions().entries()) {
            if (sess.viewer === ws) {
              removedClientId = sess.clientId;
              sessionManager.getAllRdSessions().delete(sid);
              break;
            }
          }
          
          const stillViewing = Array.from(sessionManager.getAllRdSessions().values()).some((s) => s.clientId === removedClientId);
          if (!stillViewing) {
            const target = clientManager.getClient(removedClientId);
            sendDesktopCommand(target, "desktop_stop", {});
            // Clean up streaming state
            rdStreamingState.delete(removedClientId);
            logger.debug(`[rd] cleaned up state for client ${removedClientId}`);
          }
          return;
        }
        if (role === "file_browser_viewer") {
          if (sessionId) {
            sessionManager.getAllFileBrowserSessions().delete(sessionId);
          }
          return;
        }
        if (role === "process_viewer") {
          if (sessionId) {
            sessionManager.getAllProcessSessions().delete(sessionId);
          }
          return;
        }
        clientManager.deleteClient(clientId);
        notifyConsoleClosed(clientId, "Client disconnected");
        setOnlineState(clientId, false);
        logger.info(`[close] ${clientId} code=${code} reason=${reason}`);
        
        
        if (role === "client") {
          metrics.recordDisconnection();
        }
      },
    },
  });

  
  markAllClientsOffline();
  
  
  deleteExpiredBuilds();
  logger.info(`[db] Cleaned up expired builds`);

  
  setInterval(pruneStale, 2000);
  
  const localIPs = getLocalIPs();
  logger.info(`========================================`);
  logger.info(`Overlord Server - SECURE MODE (TLS Always On)`);
  logger.info(`========================================`);
  logger.info(`HTTPS: https://${server.hostname}:${server.port}`);
  logger.info(`WSS:   wss://${server.hostname}:${server.port}/api/clients/{id}/stream/ws`);
  if (localIPs.length > 0) {
    logger.info(`\nLocal network addresses:`);
    localIPs.forEach(ip => logger.info(`  - https://${ip}:${server.port}`));
  }
  logger.info(`\n⚠️  Using self-signed certificate`);
  logger.info(`   Clients must trust: ${TLS_CERT_PATH}`);
  logger.info(`   Or use: OVERLORD_TLS_INSECURE_SKIP_VERIFY=true (dev only)`);
  logger.info(`========================================`);
}

startServer();


process.on("SIGINT", () => {
  logger.info("\n[server] Shutting down gracefully...");
  flushAuditLogsSync();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("\n[server] Shutting down gracefully...");
  flushAuditLogsSync();
  process.exit(0);
});
