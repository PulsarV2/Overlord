import { decodeMsgpack } from "./msgpack-helpers.js";

const STORAGE_KEY = "overlord_notifications_enabled";
const UNREAD_KEY = "overlord_notifications_unread";
let enabled = localStorage.getItem(STORAGE_KEY);
if (enabled === null) {
  enabled = "1";
  localStorage.setItem(STORAGE_KEY, enabled);
}
if (localStorage.getItem(UNREAD_KEY) === null) {
  localStorage.setItem(UNREAD_KEY, "0");
}
let ws = null;
let started = false;
let readyHandlers = new Set();
let notificationHandlers = new Set();
let statusHandlers = new Set();
let unreadHandlers = new Set();
let lastHistory = [];

function emitStatus(status) {
  for (const handler of statusHandlers) {
    try {
      handler(status);
    } catch {}
  }
}

function emitReady(history) {
  lastHistory = Array.isArray(history) ? history : [];
  for (const handler of readyHandlers) {
    try {
      handler(lastHistory);
    } catch {}
  }
}

function emitNotification(item) {
  for (const handler of notificationHandlers) {
    try {
      handler(item);
    } catch {}
  }
}

function shouldNotify() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getUnreadCount() {
  return Number(localStorage.getItem(UNREAD_KEY) || "0");
}

function setUnreadCount(value) {
  const next = Math.max(0, Number(value) || 0);
  localStorage.setItem(UNREAD_KEY, String(next));
  for (const handler of unreadHandlers) {
    try {
      handler(next);
    } catch {}
  }
}

function incrementUnread() {
  setUnreadCount(getUnreadCount() + 1);
}

function handleMessage(payload) {
  if (!payload || typeof payload.type !== "string") return;
  if (payload.type === "ready") {
    emitReady(payload.history || []);
    return;
  }
  if (payload.type === "notification" && payload.item) {
    console.log("[notifications] received", payload.item);
    emitNotification(payload.item);
    if (shouldNotify()) {
      incrementUnread();
    }
  }
}

let msgpackLoadPromise = null;
function ensureMsgpackrLoaded() {
  const globalObj = typeof globalThis !== "undefined" ? globalThis : window;
  if (globalObj.msgpackr) {
    return Promise.resolve();
  }
  if (msgpackLoadPromise) return msgpackLoadPromise;
  msgpackLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/msgpackr@1.11.8/dist/index.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
  return msgpackLoadPromise;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/notifications/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[notifications] ws open", wsUrl);
    emitStatus("connected");
  };

  ws.onmessage = (event) => {
    console.log("[notifications] ws message", event.data);
    if (typeof event.data === "string") {
      let parsed = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        parsed = decodeMsgpack(event.data);
      }
      if (parsed) handleMessage(parsed);
      return;
    }

    if (event.data instanceof Blob) {
      event.data
        .arrayBuffer()
        .then((buf) => {
          const parsed = decodeMsgpack(buf);
          if (parsed) handleMessage(parsed);
        })
        .catch(() => {});
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      const parsed = decodeMsgpack(event.data);
      if (parsed) handleMessage(parsed);
    }
  };

  ws.onerror = () => {
    console.warn("[notifications] ws error");
    emitStatus("error");
  };

  ws.onclose = () => {
    console.warn("[notifications] ws closed");
    emitStatus("disconnected");
    setTimeout(connect, 3000);
  };
}

export async function startNotificationClient() {
  if (started) return;
  started = true;
  console.log("[notifications] start client");
  try {
    await ensureMsgpackrLoaded();
  } catch (err) {
    console.warn("[notifications] failed to load msgpackr", err);
  }
  connect();
}

export function subscribeNotifications(handler) {
  notificationHandlers.add(handler);
  return () => notificationHandlers.delete(handler);
}

export function subscribeUnread(handler) {
  unreadHandlers.add(handler);
  try {
    handler(getUnreadCount());
  } catch {}
  return () => unreadHandlers.delete(handler);
}

export function subscribeReady(handler) {
  readyHandlers.add(handler);
  if (lastHistory.length) {
    try {
      handler(lastHistory);
    } catch {}
  }
  return () => readyHandlers.delete(handler);
}

export function subscribeStatus(handler) {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

export function setNotificationsEnabled(value) {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
}

export function getNotificationsEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function markAllNotificationsRead() {
  setUnreadCount(0);
}
