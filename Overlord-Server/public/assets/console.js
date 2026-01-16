import { ansiToHtml } from "./ansi.js";
const outputEl = document.getElementById("console-output");
const statusPill = document.getElementById("status-pill");
const clientLabel = document.getElementById("client-label");
const hostLabel = document.getElementById("host-label");
const userLabel = document.getElementById("user-label");
const osLabel = document.getElementById("os-label");
const form = document.getElementById("console-form");
const input = document.getElementById("console-input");
const ctrlcBtn = document.getElementById("ctrlc-btn");

const clientId = decodeURIComponent(
  location.pathname.split("/").filter(Boolean)[0] || "",
);
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${wsProto}://${location.host}/api/clients/${encodeURIComponent(clientId)}/console/ws`;
let ws = null;
let connected = false;
let outputBuffer = "";
let hasOutput = false;

const urlParams = new URLSearchParams(window.location.search);
const prefilledCommand = urlParams.get("cmd");
if (prefilledCommand && input) {
  setTimeout(() => {
    input.value = prefilledCommand;
    input.focus();
  }, 1000);
}

function setStatus(label, tone = "pill-offline") {
  if (!statusPill) return;
  statusPill.className = `pill ${tone}`;
  statusPill.innerHTML = `<i class="fa-solid fa-circle"></i> ${label}`;
}

function appendSystem(text) {
  outputBuffer += `\n[system] ${text}\n`;
  renderOutput();
}

function appendOutput(text) {
  outputBuffer += text;
  renderOutput();
}

function renderOutput() {
  if (!outputEl) return;
  outputEl.innerHTML = ansiToHtml(outputBuffer);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function connect() {
  appendSystem("Connecting to console...");
  setStatus("Connecting...", "pill-offline");
  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    connected = true;
    setStatus("Connected", "pill-online");
  });

  ws.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (payload.type) {
      case "ready":
        if (clientLabel) clientLabel.textContent = payload.clientId || "unknown";
        if (hostLabel) hostLabel.textContent = payload.host || "unknown";
        if (userLabel) userLabel.textContent = payload.user || "unknown";
        if (osLabel) osLabel.textContent = payload.os || "unknown";
        setStatus("Connected", "pill-online");
        break;
      case "status":
        if (payload.status === "offline") {
          setStatus("Offline", "pill-offline");
          appendSystem(payload.reason || "Client offline");
        } else if (payload.status === "connecting" && !hasOutput) {
          setStatus("Connecting...", "pill-ghost");
        } else if (payload.status === "closed") {
          setStatus("Closed", "pill-offline");
          appendSystem(payload.reason || "Console closed");
        }
        break;
      case "output": {
        if (payload.data) {
          hasOutput = true;
          setStatus("Live", "pill-online");
          appendOutput(payload.data);
        }
        if (payload.error) appendSystem(payload.error);
        if (payload.exitCode !== undefined) {
          appendSystem(`Process exited (${payload.exitCode})`);
          setStatus("Closed", "pill-offline");
        }
        break;
      }
      default:
        break;
    }
  });

  ws.addEventListener("close", () => {
    if (!connected) return;
    connected = false;
    setStatus("Disconnected", "pill-offline");
    appendSystem("Connection closed");
  });

  ws.addEventListener("error", () => {
    setStatus("Error", "pill-offline");
  });
}

function sendInput(value) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    appendSystem("Socket not ready");
    return;
  }
  ws.send(JSON.stringify({ type: "input", data: value }));
}

function wireInput() {
  if (!form || !input) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value;
    if (!value.trim()) {
      input.value = "";
      return;
    }
    const text = value.endsWith("\n") ? value : `${value}\n`;
    sendInput(text);
    input.value = "";
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
  });

  ctrlcBtn?.addEventListener("click", () => {
    sendInput("\u0003");
  });
}
wireInput();
connect();
