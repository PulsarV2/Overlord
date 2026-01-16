const hostEl = document.getElementById("plugin-host");
const frame = document.getElementById("plugin-frame");
if (!hostEl || !frame) {
  console.error("plugin host not initialized");
}

const bridgeToken = hostEl?.dataset.bridgeToken || "";
const allowedPrefixes = [
  "/api/clients/",
  "/api/plugins",
  "/api/plugins/",
];
const allowedMethods = new Set(["GET", "POST", "DELETE", "PUT", "PATCH"]);

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    return allowedPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function filterHeaders(headers) {
  const filtered = {};
  if (!headers) return filtered;
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "content-type" || lower === "accept") {
      filtered[key] = value;
    }
  }
  return filtered;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

window.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "plugin-fetch") return;
  if (frame && event.source !== frame.contentWindow) return;
  if (event.data.token !== bridgeToken) return;

  const { id, request } = event.data;
  if (!request || !request.url) return;

  if (!allowedMethods.has(String(request.method || "GET").toUpperCase())) {
    event.source?.postMessage(
      { type: "plugin-fetch-response", id, error: "method_not_allowed" },
      "*",
    );
    return;
  }

  if (!isAllowedUrl(request.url)) {
    event.source?.postMessage(
      { type: "plugin-fetch-response", id, error: "url_not_allowed" },
      "*",
    );
    return;
  }

  try {
    const res = await fetch(request.url, {
      method: request.method || "GET",
      headers: filterHeaders(request.headers),
      body: request.body || undefined,
      credentials: "include",
    });

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "";
    const text = new TextDecoder().decode(buffer);
    const base64 = arrayBufferToBase64(buffer);

    event.source?.postMessage(
      {
        type: "plugin-fetch-response",
        id,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        contentType,
        bodyText: text,
        bodyBase64: base64,
      },
      "*",
    );
  } catch (err) {
    event.source?.postMessage(
      {
        type: "plugin-fetch-response",
        id,
        error: "fetch_failed",
        message: String(err),
      },
      "*",
    );
  }
});

const wsSessions = new Map();
let wsSeq = 0;

function isAllowedWsUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    return /^\/api\/clients\/[^/]+\/rd\/ws$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

window.addEventListener("message", (event) => {
  if (!event.data || !event.data.type) return;
  if (frame && event.source !== frame.contentWindow) return;
  if (event.data.token !== bridgeToken) return;

  if (event.data.type === "plugin-ws-open") {
    const { url } = event.data;
    if (!isAllowedWsUrl(url)) {
      event.source?.postMessage(
        { type: "plugin-ws-error", error: "ws_url_not_allowed" },
        "*",
      );
      return;
    }

    const id = `ws_${Date.now()}_${wsSeq++}`;
    const wsUrl = url.replace("https:", "wss:").replace("http:", "ws:");
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsSessions.set(id, ws);

    ws.addEventListener("open", () => {
      event.source?.postMessage({ type: "plugin-ws-opened", id }, "*");
    });
    ws.addEventListener("message", (ev) => {
      const payload =
        ev.data instanceof ArrayBuffer
          ? { kind: "binary", data: arrayBufferToBase64(ev.data) }
          : { kind: "text", data: String(ev.data) };
      event.source?.postMessage(
        { type: "plugin-ws-message", id, payload },
        "*",
      );
    });
    ws.addEventListener("close", () => {
      wsSessions.delete(id);
      event.source?.postMessage({ type: "plugin-ws-closed", id }, "*");
    });
    ws.addEventListener("error", () => {
      event.source?.postMessage({ type: "plugin-ws-error", id }, "*");
    });
    return;
  }

  if (event.data.type === "plugin-ws-send") {
    const { id, data, kind } = event.data;
    const ws = wsSessions.get(id);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (kind === "binary") {
      const buffer = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      ws.send(buffer);
    } else {
      ws.send(data);
    }
    return;
  }

  if (event.data.type === "plugin-ws-close") {
    const { id } = event.data;
    const ws = wsSessions.get(id);
    if (ws) {
      ws.close();
      wsSessions.delete(id);
    }
  }
});
