const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const pluginList = document.getElementById("plugin-list");
const refreshBtn = document.getElementById("refresh-btn");
const uploadStatus = document.getElementById("upload-status");

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    const usernameDisplay = document.getElementById("username-display");
    const roleBadge = document.getElementById("role-badge");
    if (usernameDisplay) {
      usernameDisplay.textContent = data.username;
    }

    if (roleBadge) {
      const roleBadges = {
        admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
        operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
        viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
      };
      roleBadge.innerHTML = roleBadges[data.role] || data.role;

      if (data.role === "admin") {
        roleBadge.classList.add(
          "bg-purple-900/50",
          "text-purple-300",
          "border",
          "border-purple-800",
        );
      } else if (data.role === "operator") {
        roleBadge.classList.add(
          "bg-blue-900/50",
          "text-blue-300",
          "border",
          "border-blue-800",
        );
      } else {
        roleBadge.classList.add(
          "bg-slate-700",
          "text-slate-300",
          "border",
          "border-slate-600",
        );
      }
    }

    if (data.role === "admin") {
      document.getElementById("build-link")?.classList.remove("hidden");
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("plugins-link")?.classList.remove("hidden");
    } else if (data.role === "operator") {
      document.getElementById("build-link")?.classList.remove("hidden");
    }

    if (data.role !== "viewer") {
      document.getElementById("scripts-link")?.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    window.location.href = "/login.html";
  }
}

function setStatus(text, isError = false) {
  uploadStatus.textContent = text;
  uploadStatus.className = `mt-3 text-sm ${isError ? "text-red-400" : "text-slate-400"}`;
}

async function fetchPlugins() {
  const res = await fetch("/api/plugins");
  if (!res.ok) {
    setStatus("Failed to load plugins", true);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data.plugins) ? data.plugins : [];
}

function renderPlugins(plugins) {
  pluginList.innerHTML = "";
  if (!plugins.length) {
    pluginList.innerHTML =
      '<div class="text-slate-400">No plugins installed.</div>';
    return;
  }
  for (const plugin of plugins) {
    const card = document.createElement("div");
    card.className =
      "rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 flex items-center justify-between";
    const meta = document.createElement("div");
    meta.innerHTML = `
      <div class="font-semibold">${plugin.name || plugin.id}</div>
      <div class="text-sm text-slate-400">${plugin.id}${plugin.version ? ` • v${plugin.version}` : ""}</div>
    `;
    const actions = document.createElement("div");
    actions.className = "flex items-center gap-2";

    const toggle = document.createElement("button");
    toggle.className =
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg border" +
      (plugin.enabled
        ? " border-emerald-600 text-emerald-200 bg-emerald-900/40"
        : " border-slate-600 text-slate-300 bg-slate-800/60");
    toggle.innerHTML = plugin.enabled
      ? '<i class="fa-solid fa-toggle-on"></i> Enabled'
      : '<i class="fa-solid fa-toggle-off"></i> Disabled';
    toggle.addEventListener("click", async () => {
      const res = await fetch(`/api/plugins/${plugin.id}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !plugin.enabled }),
      });
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Enable failed: ${text}`, true);
        return;
      }
      await refresh();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className =
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 border border-red-700/60 hover:bg-red-800/60 text-red-100";
    removeBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Remove';
    removeBtn.addEventListener("click", async () => {
      if (!confirm(`Remove plugin ${plugin.name || plugin.id}?`)) return;
      const res = await fetch(`/api/plugins/${plugin.id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        setStatus(`Remove failed: ${text}`, true);
        return;
      }
      setStatus("Plugin removed.");
      await refresh();
    });
    actions.appendChild(toggle);
    actions.appendChild(removeBtn);
    card.appendChild(meta);
    card.appendChild(actions);

    if (plugin.lastError) {
      const errorRow = document.createElement("div");
      errorRow.className = "mt-2 text-xs text-red-300";
      errorRow.textContent = `Last error: ${plugin.lastError}`;
      card.appendChild(errorRow);
    }
    pluginList.appendChild(card);
  }
}

async function refresh() {
  const plugins = await fetchPlugins();
  renderPlugins(plugins);
}

async function uploadFile(file) {
  if (!file) return;
  setStatus(`Uploading ${file.name}...`);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/plugins/upload", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    setStatus(`Upload failed: ${text}`, true);
    return;
  }
  setStatus("Upload complete.");
  await refresh();
}

if (dropzone) {
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("border-emerald-500", "text-emerald-300");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("border-emerald-500", "text-emerald-300");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("border-emerald-500", "text-emerald-300");
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });
}

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) uploadFile(file);
});

refreshBtn?.addEventListener("click", refresh);

checkAuth();
refresh();
