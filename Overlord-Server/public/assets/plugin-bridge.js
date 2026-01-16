(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || "";
  const origin = params.get("origin") || "";
  let seq = 0;
  const pending = new Map();

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64 || "");
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function makeResponse(payload) {
    const headers = new Map(Object.entries(payload.headers || {}));
    const bodyText = payload.bodyText || "";
    const bodyBase64 = payload.bodyBase64 || "";
    const response = {
      ok: Boolean(payload.ok),
      status: payload.status || 0,
      statusText: payload.statusText || "",
      headers,
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText || "{}"),
      arrayBuffer: async () => base64ToArrayBuffer(bodyBase64),
      blob: async () => new Blob([base64ToArrayBuffer(bodyBase64)], {
        type: payload.contentType || "application/octet-stream",
      }),
    };
    return response;
  }

  async function bridgeFetch(input, init = {}) {
    const requestUrl = typeof input === "string" ? input : input.url;
    const id = `req_${Date.now()}_${seq++}`;

    const request = {
      url: requestUrl,
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body || undefined,
    };

    const responsePromise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.parent.postMessage(
        { type: "plugin-fetch", id, token, request },
        origin || "*",
      );

      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("plugin fetch timeout"));
      }, 30_000);
    });

    const payload = await responsePromise;
    if (payload.error) {
      throw new Error(payload.message || payload.error);
    }
    return makeResponse(payload);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "plugin-fetch-response") return;
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    waiter.resolve(data);
  });

  window.fetch = bridgeFetch;

  let wsSeq = 0;
  const wsWaiters = new Map();
  const wsHandlers = new Map();

  function createPluginWebSocket(url) {
    const id = `pws_${Date.now()}_${wsSeq++}`;
    const handlers = { onopen: null, onmessage: null, onclose: null, onerror: null };
    wsHandlers.set(id, handlers);

    window.parent.postMessage(
      { type: "plugin-ws-open", id, token, url },
      origin || "*",
    );

    return {
      id,
      set onopen(fn) {
        handlers.onopen = fn;
      },
      set onmessage(fn) {
        handlers.onmessage = fn;
      },
      set onclose(fn) {
        handlers.onclose = fn;
      },
      set onerror(fn) {
        handlers.onerror = fn;
      },
      send(data) {
        if (data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(data);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
          }
          window.parent.postMessage(
            { type: "plugin-ws-send", id, token, kind: "binary", data: btoa(binary) },
            origin || "*",
          );
          return;
        }
        window.parent.postMessage(
          { type: "plugin-ws-send", id, token, kind: "text", data: String(data) },
          origin || "*",
        );
      },
      close() {
        window.parent.postMessage(
          { type: "plugin-ws-close", id, token },
          origin || "*",
        );
        wsHandlers.delete(id);
      },
    };
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || !data.type) return;
    if (!data.id) return;
    const handlers = wsHandlers.get(data.id);
    if (!handlers) return;

    if (data.type === "plugin-ws-opened") {
      handlers.onopen?.();
      return;
    }
    if (data.type === "plugin-ws-closed") {
      handlers.onclose?.();
      wsHandlers.delete(data.id);
      return;
    }
    if (data.type === "plugin-ws-error") {
      handlers.onerror?.(new Error(data.error || "ws_error"));
      return;
    }
    if (data.type === "plugin-ws-message") {
      if (data.payload?.kind === "binary") {
        const buffer = base64ToArrayBuffer(data.payload.data);
        handlers.onmessage?.({ data: buffer });
      } else {
        handlers.onmessage?.({ data: data.payload?.data ?? "" });
      }
    }
  });

  window.createPluginWebSocket = createPluginWebSocket;
})();
