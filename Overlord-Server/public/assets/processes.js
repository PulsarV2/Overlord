const clientId = window.location.pathname.split("/")[1];
let ws = null;
let processes = [];
let processMap = new Map();
let processTree = [];
let collapsedPids = new Set();
let selectedPid = null;
let sortField = "cpu";
let sortDirection = "desc";
let searchTerm = "";

const statusEl = document.getElementById("status-indicator");
const processCountEl = document.getElementById("process-count");
const processListEl = document.getElementById("process-list");
const refreshBtn = document.getElementById("refresh-btn");
const killBtn = document.getElementById("kill-btn");
const searchInput = document.getElementById("search-input");
const clientIdHeader = document.getElementById("client-id-header");

if (clientIdHeader) {
  clientIdHeader.textContent = `${clientId} - Process Manager`;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/clients/${clientId}/processes/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("Process manager connected");
    updateStatus("connected", "Connected");
    enableControls(true);
    requestProcessList();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    updateStatus("error", "Connection Error");
  };

  ws.onclose = () => {
    console.log("Process manager disconnected");
    updateStatus("disconnected", "Disconnected");
    enableControls(false);
    setTimeout(() => connect(), 3000);
  };
}

function updateStatus(state, text) {
  const icons = {
    connecting: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
    connected: '<i class="fa-solid fa-circle text-green-400"></i>',
    error: '<i class="fa-solid fa-circle-exclamation text-red-400"></i>',
    disconnected: '<i class="fa-solid fa-circle text-slate-500"></i>',
  };

  statusEl.innerHTML = `${icons[state] || icons.disconnected} ${text}`;
  statusEl.className =
    state === "connected"
      ? "inline-flex items-center gap-2 px-3 py-2 rounded-full bg-green-900/40 text-green-100 border border-green-700/60"
      : "inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-800 text-slate-300";
}

function enableControls(enabled) {
  refreshBtn.disabled = !enabled;
  updateKillButton();
}

function updateKillButton() {
  killBtn.disabled = !selectedPid || !ws || ws.readyState !== WebSocket.OPEN;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(msg) {
  console.log("Received:", msg.type);

  switch (msg.type) {
    case "ready":
      console.log("Session ready:", msg.sessionId);
      break;
    case "status":
      if (msg.status === "offline") {
        updateStatus("error", "Client Offline");
        enableControls(false);
      }
      break;
    case "process_list_result":
      handleProcessList(msg);
      break;
    case "command_result":
      handleCommandResult(msg);
      break;
    default:
      console.log("Unknown message type:", msg.type);
  }
}

function requestProcessList() {
  send({ type: "process_list" });
  updateStatus("connected", "Loading processes...");
}

function handleProcessList(msg) {
  if (msg.error) {
    processListEl.innerHTML = `<div class="px-4 py-6 text-center text-red-400"><i class="fa-solid fa-exclamation-triangle mr-2"></i>${escapeHtml(msg.error)}</div>`;
    updateStatus("error", "Error loading processes");
    return;
  }

  processes = msg.processes || [];
  processCountEl.innerHTML = `<i class="fa-solid fa-list"></i> ${processes.length} processes`;
  updateStatus("connected", "Connected");
  buildProcessTree();
  renderProcesses();
}

function buildProcessTree() {
  processMap.clear();
  processes.forEach((proc) => {
    processMap.set(proc.pid, { ...proc, children: [] });
  });

  const roots = [];
  processMap.forEach((proc) => {
    if (proc.ppid && processMap.has(proc.ppid)) {
      processMap.get(proc.ppid).children.push(proc);
    } else {
      roots.push(proc);
    }
  });

  function sortChildren(proc) {
    if (proc.children.length > 0) {
      proc.children.sort((a, b) => {
        let aVal = a[sortField];
        let bVal = b[sortField];

        if (sortField === "name") {
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }

        if (sortDirection === "asc") {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });

      proc.children.forEach((child) => sortChildren(child));
    }
  }

  roots.forEach((proc) => sortChildren(proc));

  roots.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (sortField === "name") {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (sortDirection === "asc") {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  processTree = roots;
}

function renderProcesses() {
  const filtered = [];

  function collectMatches(proc, depth = 0) {
    const matches =
      !searchTerm ||
      proc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proc.pid.toString().includes(searchTerm) ||
      (proc.username &&
        proc.username.toLowerCase().includes(searchTerm.toLowerCase()));

    if (matches) {
      filtered.push({ ...proc, depth });
    }

    if (
      proc.children &&
      proc.children.length > 0 &&
      !collapsedPids.has(proc.pid)
    ) {
      proc.children.forEach((child) => collectMatches(child, depth + 1));
    }
  }

  processTree.forEach((proc) => collectMatches(proc, 0));

  if (filtered.length === 0) {
    processListEl.innerHTML =
      '<div class="px-4 py-6 text-center text-slate-400"><i class="fa-solid fa-inbox mr-2"></i>No processes found</div>';
    return;
  }

  processListEl.innerHTML = "";
  filtered.forEach((proc) => {
    const row = createProcessRow(proc, proc.depth);
    processListEl.appendChild(row);
  });
}

function createProcessRow(proc, depth = 0) {
  const row = document.createElement("div");
  row.className =
    "process-row grid grid-cols-12 gap-3 px-4 py-3 border border-transparent cursor-pointer transition-colors";
  row.dataset.pid = proc.pid;

  if (selectedPid === proc.pid) {
    row.classList.add("selected");
  }

  const cpuColor =
    proc.cpu > 50
      ? "text-red-400"
      : proc.cpu > 20
        ? "text-yellow-400"
        : "text-slate-400";
  const memoryStr = formatBytes(proc.memory);

  const hasChildren = proc.children && proc.children.length > 0;
  const isCollapsed = collapsedPids.has(proc.pid);
  const indent = "    ".repeat(depth);

  let treeIcon = "";
  if (hasChildren) {
    treeIcon = `<span class="tree-icon" data-pid="${escapeHtml(String(proc.pid))}">${isCollapsed ? "▶" : "▼"}</span>`;
  } else if (depth > 0) {
    treeIcon = '<span class="tree-indent"></span>';
  }

  let nameColor = "text-slate-200";
  let iconColor = "text-blue-400";
  if (proc.type === "system") {
    nameColor = "text-purple-400";
    iconColor = "text-purple-400";
  } else if (proc.type === "service") {
    nameColor = "text-cyan-400";
    iconColor = "text-cyan-400";
  } else if (proc.type === "own") {
    nameColor = "text-green-300";
    iconColor = "text-green-400";
  }

  row.innerHTML = `
    <div class="col-span-1 text-sm font-mono text-slate-400">${proc.pid}</div>
    <div class="col-span-4 flex items-center gap-1 truncate">
      ${indent}${treeIcon}<i class="fa-solid fa-microchip ${iconColor}"></i>
      <span class="truncate ${nameColor}">${escapeHtml(proc.name)}</span>
    </div>
    <div class="col-span-2 text-sm ${cpuColor} font-semibold">${proc.cpu.toFixed(1)}%</div>
    <div class="col-span-2 text-sm text-slate-400">${memoryStr}</div>
    <div class="col-span-3 text-sm text-slate-500 truncate">${escapeHtml(proc.username || "-")}</div>
  `;

  row.onclick = (e) => {
    if (e.target.classList.contains("tree-icon")) {
      toggleCollapse(proc.pid);
      return;
    }
    selectProcess(proc.pid);
  };

  row.ondblclick = () => {
    selectProcess(proc.pid);
    killProcess();
  };

  return row;
}

function toggleCollapse(pid) {
  if (collapsedPids.has(pid)) {
    collapsedPids.delete(pid);
  } else {
    collapsedPids.add(pid);
  }
  renderProcesses();
}

function selectProcess(pid) {
  selectedPid = pid;
  updateKillButton();
  renderProcesses();
}

function killProcess() {
  if (!selectedPid) return;

  const proc = processes.find((p) => p.pid === selectedPid);
  if (!proc) return;

  if (!confirm(`Kill process "${proc.name}" (PID: ${proc.pid})?`)) return;

  console.log("Killing process:", selectedPid);
  send({ type: "process_kill", pid: selectedPid });
  updateStatus("connected", "Killing process...");
}

function handleCommandResult(msg) {
  if (!msg.ok) {
    alert(`Operation failed: ${msg.message || "Unknown error"}`);
    updateStatus("connected", "Connected");
  } else {
    setTimeout(() => requestProcessList(), 500);
  }
}
function setSortField(field) {
  if (sortField === field) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = field === "name" ? "asc" : "desc";
  }
  buildProcessTree();
  renderProcesses();
  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('[id^="sort-"]').forEach((el) => {
    const field = el.id.replace("sort-", "");
    const icon = el.querySelector("i");
    if (field === sortField) {
      icon.className =
        sortDirection === "asc"
          ? "fa-solid fa-sort-up"
          : "fa-solid fa-sort-down";
    } else {
      icon.className = "fa-solid fa-sort";
    }
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

refreshBtn.onclick = () => requestProcessList();
killBtn.onclick = () => killProcess();

searchInput.oninput = (e) => {
  searchTerm = e.target.value;
  renderProcesses();
};

document.getElementById("sort-pid").onclick = () => setSortField("pid");
document.getElementById("sort-name").onclick = () => setSortField("name");
document.getElementById("sort-cpu").onclick = () => setSortField("cpu");
document.getElementById("sort-memory").onclick = () => setSortField("memory");

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    requestProcessList();
  }
}, 3000);

updateStatus("connecting", "Connecting...");
connect();
updateSortIndicators();
