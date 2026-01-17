import {
  startNotificationClient,
  subscribeNotifications,
  subscribeReady,
  subscribeStatus,
  markAllNotificationsRead,
} from "./notify-client.js";

const wsStatus = document.getElementById("ws-status");
const listEl = document.getElementById("notification-list");
const emptyState = document.getElementById("empty-state");
const keywordInput = document.getElementById("keyword-input");
const saveKeywordsBtn = document.getElementById("save-keywords");
const keywordHint = document.getElementById("keyword-hint");

const MAX_ROWS = 200;

function setStatus(text, tone = "neutral") {
  if (!wsStatus) return;
  const icon = wsStatus.querySelector("i");
  const label = wsStatus.querySelector("span");
  if (label) label.textContent = text;
  if (icon) {
    icon.className = "fa-solid fa-circle-dot";
    icon.classList.remove("text-green-400", "text-red-400", "text-yellow-400", "text-slate-400");
    if (tone === "ok") icon.classList.add("text-green-400");
    else if (tone === "error") icon.classList.add("text-red-400");
    else if (tone === "warn") icon.classList.add("text-yellow-400");
    else icon.classList.add("text-slate-400");
  }
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function renderRow(item, prepend = true) {
  if (!listEl) return;
  const row = document.createElement("tr");
  row.className = "border-t border-slate-800/60";
  row.innerHTML = `
    <td class="py-2 pr-4 whitespace-nowrap text-slate-400">${formatTime(item.ts)}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${item.clientId || "-"}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${item.user || "-"}</td>
    <td class="py-2 pr-4 max-w-xl truncate" title="${item.title || ""}">${item.title || ""}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${item.process || "-"}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${item.keyword || "-"}</td>
  `;

  if (prepend) {
    listEl.prepend(row);
  } else {
    listEl.appendChild(row);
  }

  const rows = listEl.querySelectorAll("tr");
  if (rows.length > MAX_ROWS) {
    rows[rows.length - 1].remove();
  }

  if (emptyState) {
    emptyState.classList.toggle("hidden", listEl.children.length > 0);
  }
}

function handleNotification(item) {
  console.log("[notifications] item", item);
  renderRow(item, true);
  markAllNotificationsRead();
}


function parseKeywords(text) {
  return text
    .split(/\r?\n/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function renderKeywordHint(count) {
  if (!keywordHint) return;
  keywordHint.textContent = `${count} keyword${count === 1 ? "" : "s"}`;
}

async function loadKeywords() {
  if (!keywordInput) return;
  try {
    const res = await fetch("/api/notifications/config");
    if (!res.ok) return;
    const data = await res.json();
    const keywords = data?.notifications?.keywords || [];
    keywordInput.value = keywords.join("\n");
    renderKeywordHint(keywords.length);
  } catch {}
}

function wireKeywordSave() {
  if (!saveKeywordsBtn || !keywordInput) return;
  saveKeywordsBtn.addEventListener("click", async () => {
    const keywords = parseKeywords(keywordInput.value);
    try {
      const res = await fetch("/api/notifications/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) {
        window.showToast?.("Failed to save keywords", "error", 4000);
        return;
      }
      const data = await res.json();
      const updated = data?.notifications?.keywords || keywords;
      keywordInput.value = updated.join("\n");
      renderKeywordHint(updated.length);
      window.showToast?.("Keywords updated", "success", 3000);
    } catch {
      window.showToast?.("Failed to save keywords", "error", 4000);
    }
  });

  keywordInput.addEventListener("input", () => {
    const keywords = parseKeywords(keywordInput.value);
    renderKeywordHint(keywords.length);
  });
}


function connect() {
  startNotificationClient();
  subscribeStatus((status) => {
    if (status === "connected") setStatus("Connected", "ok");
    if (status === "error") setStatus("Error", "error");
    if (status === "disconnected") setStatus("Disconnected", "warn");
  });
  subscribeReady((history) => {
    if (listEl) listEl.innerHTML = "";
    history.reverse().forEach((item) => renderRow(item, false));
    if (emptyState) {
      emptyState.classList.toggle("hidden", history.length > 0);
    }
    markAllNotificationsRead();
  });
  subscribeNotifications(handleNotification);
}

wireKeywordSave();
loadKeywords();
connect();
