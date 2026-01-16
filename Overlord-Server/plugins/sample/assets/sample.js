const params = new URLSearchParams(window.location.search);
const clientIdInput = document.getElementById("client-id");
const messageInput = document.getElementById("message");
const msgBoxInput = document.getElementById("msgbox");
const logEl = document.getElementById("log");
const sendBtn = document.getElementById("send-btn");
const pingBtn = document.getElementById("ping-btn");
const msgBoxBtn = document.getElementById("msgbox-btn");
const runCmdBtn = document.getElementById("run-cmd-btn");

const pluginId = "sample";
const clientIdFromUrl = params.get("clientId") || "";
clientIdInput.value = clientIdFromUrl;
messageInput.value = "hello from sample UI";
msgBoxInput.value = "Hello from Overlord";

function log(line) {
  const ts = new Date().toISOString();
  logEl.textContent = `${ts} ${line}\n` + logEl.textContent;
}

async function sendEvent(event, payload) {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    log("Missing clientId");
    return;
  }
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/plugins/${pluginId}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    log(`Send failed: ${res.status} ${text}`);
    return;
  }
  log(`Sent event: ${event}`);
}

sendBtn.addEventListener("click", () => {
  const message = messageInput.value.trim();
  sendEvent("ui_message", { message });
});

pingBtn?.addEventListener("click", async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    log("Missing clientId");
    return;
  }
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "ping_bulk", count: 100 }),
  });
  if (!res.ok) {
    const msg = await res.text();
    log(`Ping test failed: ${msg}`);
    return;
  }
  log("Ping test x100 dispatched (single request)");
});

msgBoxBtn?.addEventListener("click", async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    log("Missing clientId");
    return;
  }
  const text = msgBoxInput.value.trim() || "Hello from Overlord";
  const script = `$os = $env:OS; if ($os -ne 'Windows_NT') { exit } ; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text.replace(/'/g, "''")}') | Out-Null`;
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "script_exec", script, scriptType: "powershell" }),
  });
  if (!res.ok) {
    const msg = await res.text();
    log(`Message box failed: ${msg}`);
    return;
  }
  log("Message box command sent (Windows only)");
});

runCmdBtn?.addEventListener("click", async () => {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    log("Missing clientId");
    return;
  }
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "screenshot" }),
  });
  if (!res.ok) {
    const msg = await res.text();
    log(`Command failed: ${msg}`);
    return;
  }
  log("Command sent: screenshot");
});
