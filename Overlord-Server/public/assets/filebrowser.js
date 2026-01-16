const clientId = window.location.pathname.split("/")[1];
let ws = null;
let currentPath = "";
let pathHistory = [];
let selectedFiles = new Set();
let fileDownloads = new Map();
let fileUploads = new Map();
let activeTransfers = new Map();
let currentEditingFile = null;

const statusEl = document.getElementById("status-indicator");
const breadcrumbEl = document.getElementById("breadcrumb");
const fileListEl = document.getElementById("file-list");
const refreshBtn = document.getElementById("refresh-btn");
const uploadBtn = document.getElementById("upload-btn");
const mkdirBtn = document.getElementById("mkdir-btn");
const searchBtn = document.getElementById("search-btn");
const fileInput = document.getElementById("file-input");
const contextMenu = document.getElementById("context-menu");
const clientIdHeader = document.getElementById("client-id-header");
const backBtn = document.getElementById("back-btn");
const homeBtn = document.getElementById("home-btn");
const pathInput = document.getElementById("path-input");
const pathGoBtn = document.getElementById("path-go-btn");
const transferPanel = document.getElementById("transfer-panel");
const transferList = document.getElementById("transfer-list");

const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");
const searchContentCheckbox = document.getElementById(
  "search-content-checkbox",
);
const searchExecuteBtn = document.getElementById("search-execute-btn");
const searchCloseBtn = document.getElementById("search-close-btn");
const bulkActionsBar = document.getElementById("bulk-actions-bar");
const selectedCountEl = document.getElementById("selected-count");
const bulkDownloadBtn = document.getElementById("bulk-download-btn");
const bulkDeleteBtn = document.getElementById("bulk-delete-btn");
const bulkMoveBtn = document.getElementById("bulk-move-btn");
const bulkCopyBtn = document.getElementById("bulk-copy-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const fileEditorModal = document.getElementById("file-editor-modal");
const editorTextarea = document.getElementById("editor-textarea");
const editorFileName = document.getElementById("editor-file-name");
const editorStatus = document.getElementById("editor-status");
const editorSaveBtn = document.getElementById("editor-save-btn");
const editorCancelBtn = document.getElementById("editor-cancel-btn");
const editorCloseBtn = document.getElementById("editor-close-btn");

if (clientIdHeader) {
  clientIdHeader.textContent = `${clientId} - File Browser`;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/clients/${clientId}/files/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("File browser connected");
    updateStatus("connected", "Connected");
    enableControls(true);
    listFiles(currentPath || ".");
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
    console.log("File browser disconnected");
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
  uploadBtn.disabled = !enabled;
  mkdirBtn.disabled = !enabled;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log(
      "[DEBUG] Sending message:",
      msg.type,
      msg.commandType || "",
      "to server",
    );
    ws.send(JSON.stringify(msg));
  } else {
    console.error(
      "[DEBUG] Cannot send - WebSocket not open. State:",
      ws?.readyState,
    );
  }
}

function handleMessage(msg) {
  console.log("[DEBUG] Received message:", msg.type, msg);

  switch (msg.type) {
    case "ready":
      console.log("Session ready:", msg.sessionId);
      break;
    case "status":
      console.log("[DEBUG] Status message:", msg);
      if (msg.status === "offline") {
        updateStatus("error", "Client Offline");
        enableControls(false);
      }
      break;
    case "file_list_result":
      handleFileList(msg);
      break;
    case "file_download":
      handleFileDownload(msg);
      break;
    case "file_upload_result":
      handleFileUploadResult(msg);
      break;
    case "file_read_result":
      console.log("[DEBUG] Routing to handleFileReadResult");
      handleFileReadResult(msg);
      break;
    case "file_search_result":
      handleFileSearchResult(msg);
      break;
    case "command_result":
      console.log("[DEBUG] Command result:", msg);
      handleCommandResult(msg);
      break;
    case "command_progress":
      console.log("[DEBUG] Command progress:", msg);
      handleCommandProgress(msg);
      break;
    default:
      console.log("[DEBUG] Unknown message type:", msg.type, msg);
  }
}

function listFiles(path) {
  if (currentPath && currentPath !== path) {
    pathHistory.push(currentPath);
  }
  currentPath = path;
  send({ type: "file_list", path });
  updateBreadcrumb(path);
  updatePathInput(path);
  updateBackButton();
}

function updatePathInput(path) {
  pathInput.value = path || ".";
}

function updateBackButton() {
  backBtn.disabled = pathHistory.length === 0;
  backBtn.classList.toggle("opacity-50", pathHistory.length === 0);
  backBtn.classList.toggle("cursor-not-allowed", pathHistory.length === 0);
}

function goBack() {
  if (pathHistory.length > 0) {
    const previousPath = pathHistory.pop();
    currentPath = previousPath;
    send({ type: "file_list", path: previousPath });
    updateBreadcrumb(previousPath);
    updatePathInput(previousPath);
    updateBackButton();
  }
}

function goHome() {
  pathHistory = [];
  listFiles(".");
}

function updateBreadcrumb(path) {
  const parts = path.split(/[\/\\]/).filter((p) => p && p !== ".");
  breadcrumbEl.innerHTML = "";

  const root = document.createElement("span");
  root.className = "breadcrumb-item hover:text-blue-400 transition-colors";
  root.innerHTML =
    '<i class="fa-solid fa-hard-drive"></i> <span class="text-xs">Drives</span>';
  root.onclick = () => listFiles(".");
  breadcrumbEl.appendChild(root);

  if (!path || path === ".") {
    return;
  }

  let accumulated = "";
  parts.forEach((part, idx) => {
    accumulated += (accumulated ? "/" : "") + part;
    const pathSegment = accumulated;

    const separator = document.createElement("span");
    separator.className = "text-slate-600 mx-1";
    separator.innerHTML = '<i class="fa-solid fa-chevron-right text-xs"></i>';
    breadcrumbEl.appendChild(separator);

    const crumb = document.createElement("span");
    crumb.className = "breadcrumb-item hover:text-blue-400 transition-colors";
    crumb.textContent = part;
    crumb.onclick = () => listFiles(pathSegment);
    breadcrumbEl.appendChild(crumb);
  });
}

function handleFileList(msg) {
  if (msg.error) {
    fileListEl.innerHTML = `<div class="px-4 py-6 text-center text-red-400"><i class="fa-solid fa-exclamation-triangle mr-2"></i>${escapeHtml(msg.error)}</div>`;
    return;
  }

  currentPath = msg.path;
  const entries = msg.entries || [];

  selectedFiles.clear();
  updateSelectionUI();

  fileListEl.style.opacity = "0";
  fileListEl.style.transform = "translateX(20px)";

  setTimeout(() => {
    fileListEl.innerHTML = "";

    const canGoUp = shouldShowParentDirectory(currentPath);
    if (canGoUp) {
      const parentPath = getParentPath(currentPath);
      const parentRow = createParentRow(parentPath);
      fileListEl.appendChild(parentRow);
    }

    if (entries.length === 0 && !canGoUp) {
      fileListEl.innerHTML =
        '<div class="px-4 py-6 text-center text-slate-400"><i class="fa-solid fa-folder-open mr-2"></i>Empty directory</div>';
      fileListEl.style.opacity = "1";
      fileListEl.style.transform = "translateX(0)";
      return;
    }

    entries.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((entry, index) => {
      const row = createFileRow(entry);
      row.style.animationDelay = `${index * 0.02}s`;
      row.classList.add("card-animate");
      fileListEl.appendChild(row);
    });

    fileListEl.style.transition =
      "opacity 0.3s ease-out, transform 0.3s ease-out";
    fileListEl.style.opacity = "1";
    fileListEl.style.transform = "translateX(0)";
  }, 150);
}

function shouldShowParentDirectory(path) {
  if (!path || path === ".") {
    return false;
  }

  return true;
}

function getParentPath(path) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p);

  if (parts.length === 1 && parts[0].match(/^[A-Za-z]:$/)) {
    return ".";
  }

  if (parts.length <= 1) {
    return ".";
  }

  parts.pop();
  let parentPath = parts.join("/");

  if (parentPath.match(/^[A-Za-z]:?$/)) {
    return parentPath.replace(/^([A-Za-z]):?$/, "$1:\\");
  }

  return parentPath || ".";
}

function createParentRow(parentPath) {
  const row = document.createElement("div");
  row.className =
    "file-item grid grid-cols-12 gap-3 px-4 py-3 border border-transparent cursor-pointer transition-colors hover:bg-slate-800/50";
  row.dataset.path = parentPath;
  row.dataset.isDir = "true";

  row.innerHTML = `
    <div class="col-span-6 flex items-center gap-2">
      <i class="fa-solid fa-folder-arrow-up text-blue-400"></i>
      <span class="font-semibold text-blue-300">..</span>
      <span class="text-xs text-slate-500">(parent directory)</span>
    </div>
    <div class="col-span-2 text-sm text-slate-400">-</div>
    <div class="col-span-3 text-sm text-slate-400">-</div>
    <div class="col-span-1"></div>
  `;

  row.ondblclick = () => listFiles(parentPath);
  row.onclick = () => listFiles(parentPath);

  return row;
}

function createFileRow(entry) {
  const row = document.createElement("div");
  row.className =
    "file-item grid grid-cols-12 gap-3 px-4 py-3 border border-transparent cursor-pointer transition-colors";
  row.dataset.path = entry.path;
  row.dataset.isDir = entry.isDir;

  const icon = entry.isDir
    ? '<i class="fa-solid fa-folder text-yellow-400"></i>'
    : '<i class="fa-solid fa-file text-slate-400"></i>';

  const size = entry.isDir ? "-" : formatBytes(entry.size);
  const modTime = new Date(entry.modTime * 1000).toLocaleString();

  row.innerHTML = `
    <input type="checkbox" class="file-checkbox" data-path="${escapeHtml(entry.path)}">
    <div class="col-span-6 flex items-center gap-2 truncate pl-3">
      ${icon}
      <span class="truncate">${escapeHtml(entry.name)}</span>
    </div>
    <div class="col-span-2 text-sm text-slate-400 file-size-col">${size}</div>
    <div class="col-span-3 text-sm text-slate-400 file-modified-col">${modTime}</div>
    <div class="col-span-1 flex items-center justify-end gap-1 action-buttons">
      ${!entry.isDir ? '<button class="action-btn px-2 py-1 rounded hover:bg-slate-700" data-action="download" title="Download"><i class="fa-solid fa-download"></i></button>' : ""}
      ${entry.isDir ? '<button class="action-btn px-2 py-1 rounded hover:bg-slate-700" data-action="zip" title="Zip & Download"><i class="fa-solid fa-file-zipper"></i></button>' : ""}
      <button class="action-btn px-2 py-1 rounded hover:bg-slate-700 text-red-400" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;

  const nameDiv = row.querySelector(".col-span-6");
  const mobileMetaDiv = document.createElement("div");
  mobileMetaDiv.className = "file-meta";
  mobileMetaDiv.innerHTML = `<span>${size}</span><span>${modTime}</span>`;
  nameDiv.appendChild(mobileMetaDiv);

  row.onclick = (e) => {
    if (e.target.closest(".file-checkbox") || e.target.closest(".action-btn")) {
      return;
    }

    if (entry.isDir) {
      listFiles(entry.path);
    } else {
      openFileInEditor(entry.path);
    }
  };

  const checkbox = row.querySelector(".file-checkbox");
  checkbox.onclick = (e) => {
    e.stopPropagation();
  };

  checkbox.onchange = (e) => {
    if (e.target.checked) {
      selectedFiles.add(entry.path);
      row.classList.add("selected");
    } else {
      selectedFiles.delete(entry.path);
      row.classList.remove("selected");
    }
    updateSelectionUI();
  };

  row.querySelectorAll(".action-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      handleFileAction(action, entry);
    };
  });

  row.oncontextmenu = (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, entry);
  };

  return row;
}

function toggleSelection(row, path) {
  const checkbox = row.querySelector(".file-checkbox");
  if (selectedFiles.has(path)) {
    selectedFiles.delete(path);
    row.classList.remove("selected");
    if (checkbox) checkbox.checked = false;
  } else {
    selectedFiles.add(path);
    row.classList.add("selected");
    if (checkbox) checkbox.checked = true;
  }
  updateSelectionUI();
}

function handleFileAction(action, entry) {
  switch (action) {
    case "edit":
      openFileInEditor(entry.path);
      break;
    case "download":
      downloadFile(entry.path);
      break;
    case "zip":
      zipAndDownload(entry.path);
      break;
    case "copy":
      const copyDest = prompt("Copy to:", entry.path + "_copy");
      if (copyDest) {
        send({
          type: "command",
          commandType: "file_copy",
          id: `copy-${Date.now()}`,
          payload: { source: entry.path, dest: copyDest },
        });
        setTimeout(() => listFiles(currentPath), 500);
      }
      break;
    case "move":
      const moveDest = prompt("Move to:", entry.path);
      if (moveDest) {
        send({
          type: "command",
          commandType: "file_move",
          id: `move-${Date.now()}`,
          payload: { source: entry.path, dest: moveDest },
        });
        setTimeout(() => listFiles(currentPath), 500);
      }
      break;
    case "chmod":
      const mode = prompt(
        "Enter permissions (octal, e.g., 0755):",
        entry.mode || "0644",
      );
      if (mode) {
        send({
          type: "command",
          commandType: "file_chmod",
          id: `chmod-${Date.now()}`,
          payload: { path: entry.path, mode },
        });
        setTimeout(() => listFiles(currentPath), 500);
      }
      break;
    case "delete":
      deleteFile(entry.path);
      break;
  }
}

function downloadFile(path) {
  console.log("Requesting download:", path);
  const transferId = `download-${Date.now()}-${Math.random()}`;
  const fileName = path.split(/[\/\\]/).pop();

  const transfer = {
    id: transferId,
    type: "download",
    path,
    fileName,
    progress: 0,
    total: 0,
    received: 0,
    chunks: [],
    cancelled: false,
  };

  fileDownloads.set(path, transfer);
  activeTransfers.set(transferId, transfer);
  addTransferToUI(transfer);

  send({ type: "file_download", path, transferId });
  updateStatus("connected", `Downloading ${fileName}...`);
}

function handleFileDownload(msg) {
  if (msg.error) {
    alert(`Download failed: ${msg.error}`);
    const download = fileDownloads.get(msg.path);
    if (download) {
      removeTransfer(download.id);
      fileDownloads.delete(msg.path);
    }
    return;
  }

  let download = fileDownloads.get(msg.path);
  if (!download) {
    return;
  }

  if (download.cancelled) {
    fileDownloads.delete(msg.path);
    return;
  }

  if (msg.data && msg.data.length > 0) {
    const data = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
    download.chunks.push(data);
    download.received += data.length;
  }

  if (msg.total) {
    download.total = msg.total;
  }

  if (download.total > 0) {
    download.progress = Math.round((download.received / download.total) * 100);
    updateTransferProgress(
      download.id,
      download.progress,
      download.received,
      download.total,
    );
  }

  if (download.total > 0 && download.received >= download.total) {
    const fullData = new Uint8Array(download.received);
    let offset = 0;
    download.chunks.forEach((chunk) => {
      fullData.set(chunk, offset);
      offset += chunk.length;
    });

    const blob = new Blob([fullData]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = download.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("Download complete:", msg.path, `${download.received} bytes`);
    removeTransfer(download.id);
    fileDownloads.delete(msg.path);
    updateStatus("connected", "Connected");
  }
}

function zipAndDownload(path) {
  console.log("Requesting zip:", path);

  const zipPath = path + ".zip";
  fileDownloads.set(zipPath, { chunks: [], total: 0 });

  const commandId = "zip_" + Date.now();
  send({ type: "file_zip", path, commandId });

  showProgressNotification(commandId, "Starting zip operation...", path);
}

let activeProgressNotifications = new Map();

function showProgressNotification(commandId, message, path) {
  hideProgressNotification(commandId);

  const notification = document.createElement("div");
  notification.id = `progress-${commandId}`;
  notification.className =
    "fixed bottom-4 right-4 bg-slate-800 border border-slate-700 rounded-lg shadow-lg p-4 min-w-[320px] z-50";
  notification.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-2">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-file-zipper text-blue-400"></i>
        <span class="font-semibold text-slate-200">Zipping Directory</span>
      </div>
      <button class="text-slate-400 hover:text-red-400 transition-colors" data-command-id="${escapeHtml(commandId)}" onclick="cancelZipOperation(this.dataset.commandId)">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="text-sm text-slate-400 mb-2" id="progress-message-${escapeHtml(commandId)}">${escapeHtml(message)}</div>
    <div class="text-xs text-slate-500 truncate" title="${escapeHtml(path)}">${escapeHtml(path)}</div>
  `;

  document.body.appendChild(notification);
  activeProgressNotifications.set(commandId, notification);
}

function updateProgressNotification(commandId, message) {
  const messageEl = document.getElementById(`progress-message-${commandId}`);
  if (messageEl) {
    messageEl.textContent = message;
  }
}

function hideProgressNotification(commandId) {
  const notification = activeProgressNotifications.get(commandId);
  if (notification) {
    notification.remove();
    activeProgressNotifications.delete(commandId);
  }
}

function cancelZipOperation(commandId) {
  if (confirm("Cancel this zip operation?")) {
    send({ type: "command_abort", commandId });
    hideProgressNotification(commandId);
    updateStatus("connected", "Zip operation cancelled");
  }
}

function handleCommandProgress(msg) {
  if (msg.commandId) {
    updateProgressNotification(msg.commandId, msg.message || "Processing...");
  }
}

function deleteFile(path) {
  if (!confirm(`Are you sure you want to delete ${path}?`)) return;
  console.log("Deleting:", path);
  send({ type: "file_delete", path });
}

function handleFileUploadResult(msg) {
  if (msg.ok) {
    console.log("Upload complete:", msg.path);
    updateStatus("connected", "Connected");
    showToast("File uploaded successfully", "success", 5000);
    listFiles(currentPath);
  } else {
    showToast(`Upload failed: ${msg.error}`, "error", 5000);
    updateStatus("connected", "Connected");
  }
}

function handleCommandResult(msg) {
  if (msg.commandId && activeProgressNotifications.has(msg.commandId)) {
    setTimeout(() => hideProgressNotification(msg.commandId), 2000);
  }

  if (currentEditingFile && editorStatus.textContent === "Saving...") {
    if (msg.ok) {
      editorStatus.textContent = "Saved successfully!";
      showToast("File saved successfully", "success", 5000);
      setTimeout(closeEditor, 1000);
    } else {
      editorStatus.textContent = `Error: ${msg.message || "Save failed"}`;
      showToast(
        `Save failed: ${msg.message || "Unknown error"}`,
        "error",
        5000,
      );
      editorSaveBtn.disabled = false;
    }
    return;
  }

  if (!msg.ok) {
    showToast(
      `Operation failed: ${msg.message || "Unknown error"}`,
      "error",
      5000,
    );
  } else {
    showToast("Operation completed successfully", "success", 5000);

    listFiles(currentPath);
  }
}

function showContextMenu(x, y, entry) {
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.add("show");
  contextMenu.dataset.path = entry.path;
  contextMenu.dataset.isDir = entry.isDir;

  const editItem = contextMenu.querySelector('[data-action="edit"]');
  const zipItem = contextMenu.querySelector('[data-action="zip"]');
  const chmodItem = contextMenu.querySelector('[data-action="chmod"]');

  if (editItem) editItem.style.display = entry.isDir ? "none" : "block";
  if (zipItem) zipItem.style.display = entry.isDir ? "block" : "none";
  if (chmodItem) chmodItem.style.display = entry.mode ? "block" : "none";
}

function hideContextMenu() {
  contextMenu.classList.remove("show");
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

refreshBtn.onclick = () => listFiles(currentPath);

uploadBtn.onclick = () => fileInput.click();

fileInput.onchange = async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  for (const file of files) {
    await uploadFile(file);
  }

  fileInput.value = "";
  listFiles(currentPath);
};

async function uploadFile(file) {
  const path = currentPath ? `${currentPath}/${file.name}` : file.name;
  const transferId = `upload-${Date.now()}-${Math.random()}`;

  console.log("Uploading:", path);

  const transfer = {
    id: transferId,
    type: "upload",
    path,
    fileName: file.name,
    progress: 0,
    total: file.size,
    sent: 0,
    cancelled: false,
  };

  fileUploads.set(path, transfer);
  activeTransfers.set(transferId, transfer);
  addTransferToUI(transfer);

  const chunkSize = 512 * 1024;
  let offset = 0;

  try {
    while (offset < file.size) {
      if (transfer.cancelled) {
        console.log("Upload cancelled:", path);
        removeTransfer(transferId);
        fileUploads.delete(path);
        return;
      }

      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const base64 = btoa(String.fromCharCode(...uint8Array));

      send({ type: "file_upload", path, data: base64, offset, transferId });
      offset += chunk.size;
      transfer.sent = offset;
      transfer.progress = Math.round((offset / file.size) * 100);

      updateTransferProgress(transferId, transfer.progress, offset, file.size);

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log("Upload finished:", path);
    removeTransfer(transferId);
    fileUploads.delete(path);
  } catch (err) {
    console.error("Upload error:", err);
    removeTransfer(transferId);
    fileUploads.delete(path);
    alert(`Upload failed: ${err.message}`);
  }
}

mkdirBtn.onclick = () => {
  const name = prompt("Enter folder name:");
  if (!name) return;
  const path = currentPath ? `${currentPath}/${name}` : name;
  console.log("Creating directory:", path);
  send({ type: "file_mkdir", path });
};

backBtn.onclick = () => goBack();

homeBtn.onclick = () => goHome();

pathGoBtn.onclick = () => {
  const path = pathInput.value.trim();
  if (path) {
    pathHistory = [];
    listFiles(path);
  }
};

pathInput.onkeydown = (e) => {
  if (e.key === "Enter") {
    const path = pathInput.value.trim();
    if (path) {
      pathHistory = [];
      listFiles(path);
    }
  }
};

document.addEventListener("click", (e) => {
  if (!e.target.closest("#context-menu")) {
    hideContextMenu();
  }
});

updateStatus("connecting", "Connecting...");
updateBackButton();
connect();

function addTransferToUI(transfer) {
  const transferItem = document.createElement("div");
  transferItem.id = `transfer-${transfer.id}`;
  transferItem.className =
    "transfer-item bg-slate-800/50 border border-slate-700 rounded-lg p-3";

  const icon = transfer.type === "upload" ? "fa-upload" : "fa-download";
  const color = transfer.type === "upload" ? "text-blue-400" : "text-green-400";

  transferItem.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <i class="fa-solid ${icon} ${color}"></i>
        <span class="text-sm truncate">${transfer.fileName}</span>
      </div>
      <button class="cancel-btn text-red-400 hover:text-red-300 px-2" onclick="cancelTransfer('${transfer.id}')">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="progress-bar-container w-full bg-slate-700 rounded-full h-2 mb-1">
      <div class="progress-bar bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: ${transfer.progress}%"></div>
    </div>
    <div class="flex justify-between text-xs text-slate-400">
      <span class="progress-text">${transfer.progress}%</span>
      <span class="size-text">${formatBytes(transfer.sent || transfer.received || 0)} / ${formatBytes(transfer.total)}</span>
    </div>
  `;

  transferList.appendChild(transferItem);
  transferPanel.classList.remove("hidden");
}

function updateTransferProgress(transferId, progress, current, total) {
  const transferItem = document.getElementById(`transfer-${transferId}`);
  if (!transferItem) return;

  const progressBar = transferItem.querySelector(".progress-bar");
  const progressText = transferItem.querySelector(".progress-text");
  const sizeText = transferItem.querySelector(".size-text");

  if (progressBar) progressBar.style.width = `${progress}%`;
  if (progressText) progressText.textContent = `${progress}%`;
  if (sizeText)
    sizeText.textContent = `${formatBytes(current)} / ${formatBytes(total)}`;
}

function removeTransfer(transferId) {
  const transferItem = document.getElementById(`transfer-${transferId}`);
  if (transferItem) {
    transferItem.remove();
  }

  activeTransfers.delete(transferId);

  if (transferList.children.length === 0) {
    transferPanel.classList.add("hidden");
  }
}

window.cancelTransfer = function (transferId) {
  const transfer = activeTransfers.get(transferId);
  if (transfer) {
    transfer.cancelled = true;
    removeTransfer(transferId);

    if (transfer.type === "upload") {
      fileUploads.delete(transfer.path);
    } else {
      fileDownloads.delete(transfer.path);
    }

    console.log("Transfer cancelled:", transferId);
  }
};

function updateSelectionUI() {
  const count = selectedFiles.size;
  selectedCountEl.textContent = count;

  if (count > 0) {
    bulkActionsBar.classList.remove("hidden");
  } else {
    bulkActionsBar.classList.add("hidden");
  }

  document.querySelectorAll(".file-item").forEach((row) => {
    const path = row.dataset.path;
    if (selectedFiles.has(path)) {
      row.classList.add("selected");
    } else {
      row.classList.remove("selected");
    }
  });
}

function clearSelection() {
  selectedFiles.clear();
  updateSelectionUI();
}

searchBtn.addEventListener("click", () => {
  searchBar.classList.toggle("hidden");
  if (!searchBar.classList.contains("hidden")) {
    searchInput.focus();
  }
});

searchCloseBtn.addEventListener("click", () => {
  searchBar.classList.add("hidden");
  searchInput.value = "";
  listFiles(currentPath);
});

searchExecuteBtn.addEventListener("click", () => {
  const query = searchInput.value.trim();
  if (!query) return;

  const searchContent = searchContentCheckbox.checked;
  performSearch(query, searchContent);
});

searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    searchExecuteBtn.click();
  }
});

function performSearch(pattern, searchContent) {
  const searchId = `search-${Date.now()}`;
  const cmdId = `search-cmd-${Date.now()}`;
  const msg = {
    type: "command",
    commandType: "file_search",
    id: cmdId,
    payload: {
      searchId,
      path: currentPath || ".",
      pattern,
      searchContent,
      maxResults: 500,
    },
  };

  send(msg);

  fileListEl.innerHTML =
    '<div class="px-4 py-6 text-center text-blue-400"><i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Searching...</div>';
}

function handleFileSearchResult(msg) {
  if (msg.error) {
    fileListEl.innerHTML = `<div class="px-4 py-6 text-center text-red-400"><i class="fa-solid fa-exclamation-triangle mr-2"></i>${escapeHtml(msg.error)}</div>`;
    return;
  }

  const results = msg.results || [];

  if (results.length === 0) {
    fileListEl.innerHTML =
      '<div class="px-4 py-6 text-center text-slate-400"><i class="fa-solid fa-search mr-2"></i>No results found</div>';
    return;
  }

  fileListEl.innerHTML = "";

  results.forEach((result) => {
    const row = document.createElement("div");
    row.className =
      "file-item px-4 py-3 border border-slate-700 rounded cursor-pointer hover:bg-slate-800/50 mb-2";

    const fileName = result.path.split(/[\/\\]/).pop();
    const lineInfo = result.line ? ` (line ${result.line})` : "";
    const matchPreview = result.match
      ? `<div class="text-xs text-slate-500 mt-1 font-mono">${escapeHtml(result.match.substring(0, 100))}</div>`
      : "";

    row.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-file text-slate-400"></i>
        <div class="flex-1">
          <div class="font-medium">${escapeHtml(fileName)}<span class="text-slate-500">${lineInfo}</span></div>
          <div class="text-xs text-slate-400">${escapeHtml(result.path)}</div>
          ${matchPreview}
        </div>
        <button class="px-2 py-1 rounded hover:bg-slate-700" onclick="event.stopPropagation(); downloadFile('${escapeHtml(result.path)}')">
          <i class="fa-solid fa-download"></i>
        </button>
      </div>
    `;

    row.onclick = () => {
      openFileInEditor(result.path);
    };

    fileListEl.appendChild(row);
  });
}

function openFileInEditor(path) {
  const cmdId = `file-read-${Date.now()}`;
  const msg = {
    type: "command",
    commandType: "file_read",
    id: cmdId,
    payload: {
      path,
      maxSize: 10 * 1024 * 1024,
    },
  };

  console.log("[DEBUG] Opening file in editor:", path);
  console.log(
    "[DEBUG] Sending file_read command:",
    JSON.stringify(msg, null, 2),
  );
  console.log(
    "[DEBUG] WebSocket state:",
    ws?.readyState,
    "OPEN=",
    WebSocket.OPEN,
  );

  send(msg);
  currentEditingFile = path;
  editorFileName.textContent = path.split(/[/\\\\]/).pop();
  editorStatus.textContent = "Loading...";
  fileEditorModal.classList.add("show");
}

function handleFileReadResult(msg) {
  console.log("[DEBUG] handleFileReadResult called:", {
    path: msg.path,
    hasError: !!msg.error,
    isBinary: msg.isBinary,
    contentLength: msg.content?.length,
  });

  if (msg.error) {
    alert(`Error reading file: ${escapeHtml(msg.error)}`);
    closeEditor();
    return;
  }

  if (msg.isBinary) {
    alert("Cannot edit binary file");
    closeEditor();
    return;
  }

  console.log("[DEBUG] Setting editor content, length:", msg.content?.length);

  editorTextarea.value = msg.content || "";
  editorStatus.textContent = "Ready";

  applySyntaxHighlighting();
  editorTextarea.classList.add("hidden");
  editorPreview.classList.remove("hidden");
  editorPreviewTab.classList.add("bg-blue-600");
  editorPreviewTab.classList.remove("bg-slate-700", "hover:bg-slate-600");
  editorEditTab.classList.remove("bg-blue-600");
  editorEditTab.classList.add("bg-slate-700", "hover:bg-slate-600");
}

function saveFileFromEditor() {
  if (!currentEditingFile) return;

  const content = editorTextarea.value;
  const cmdId = `file-write-${Date.now()}`;
  const msg = {
    type: "command",
    commandType: "file_write",
    id: cmdId,
    payload: {
      path: currentEditingFile,
      content,
    },
  };

  send(msg);
  editorStatus.textContent = "Saving...";
  editorSaveBtn.disabled = true;
}

function closeEditor() {
  fileEditorModal.classList.remove("show");
  editorTextarea.value = "";
  currentEditingFile = null;
  editorStatus.textContent = "Ready";
  editorSaveBtn.disabled = false;
}

function applySyntaxHighlighting() {
  const code = editorTextarea.value;
  const codeElement = document.getElementById("editor-code");
  const fileName = currentEditingFile?.split(/[/\\\\]/).pop() || "";

  const ext = fileName.split(".").pop()?.toLowerCase();
  const languageMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    go: "go",
    rs: "rust",
    sh: "bash",
    bash: "bash",
    bat: "powershell",
    cmd: "powershell",
    ps1: "powershell",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    txt: "plaintext",
  };

  const language = languageMap[ext] || "plaintext";
  codeElement.className = `language-${language}`;
  codeElement.textContent = code;

  delete codeElement.dataset.highlighted;

  if (window.hljs) {
    hljs.highlightElement(codeElement);
  }
}

const editorEditTab = document.getElementById("editor-edit-tab");
const editorPreviewTab = document.getElementById("editor-preview-tab");
const editorPreview = document.getElementById("editor-preview");

editorEditTab.addEventListener("click", () => {
  editorTextarea.classList.remove("hidden");
  editorPreview.classList.add("hidden");
  editorEditTab.classList.add("bg-blue-600");
  editorEditTab.classList.remove("bg-slate-700", "hover:bg-slate-600");
  editorPreviewTab.classList.remove("bg-blue-600");
  editorPreviewTab.classList.add("bg-slate-700", "hover:bg-slate-600");
});

editorPreviewTab.addEventListener("click", () => {
  applySyntaxHighlighting();
  editorTextarea.classList.add("hidden");
  editorPreview.classList.remove("hidden");
  editorPreviewTab.classList.add("bg-blue-600");
  editorPreviewTab.classList.remove("bg-slate-700", "hover:bg-slate-600");
  editorEditTab.classList.remove("bg-blue-600");
  editorEditTab.classList.add("bg-slate-700", "hover:bg-slate-600");
});

editorSaveBtn.addEventListener("click", saveFileFromEditor);
editorCancelBtn.addEventListener("click", closeEditor);
editorCloseBtn.addEventListener("click", closeEditor);

const editorRunBtn = document.getElementById("editor-run-btn");
editorRunBtn.addEventListener("click", () => {
  if (!currentEditingFile) return;

  const ext = currentEditingFile.split(".").pop()?.toLowerCase();
  let command = "";

  const isWindows = currentPath.includes(":\\");

  if (isWindows) {
    switch (ext) {
      case "bat":
      case "cmd":
        command = currentEditingFile;
        break;
      case "ps1":
        command = `powershell.exe -ExecutionPolicy Bypass -File "${currentEditingFile}"`;
        break;
      case "exe":
      case "com":
        command = `"${currentEditingFile}"`;
        break;
      case "py":
        command = `python "${currentEditingFile}"`;
        break;
      case "js":
        command = `node "${currentEditingFile}"`;
        break;
      default:
        command = `"${currentEditingFile}"`;
    }
  } else {
    switch (ext) {
      case "sh":
      case "bash":
        command = `bash "${currentEditingFile}"`;
        break;
      case "py":
        command = `python3 "${currentEditingFile}"`;
        break;
      case "rb":
        command = `ruby "${currentEditingFile}"`;
        break;
      case "js":
        command = `node "${currentEditingFile}"`;
        break;
      case "pl":
        command = `perl "${currentEditingFile}"`;
        break;
      default:
        command = `"${currentEditingFile}"`;
    }
  }

  window.open(
    `/${clientId}/console?cmd=${encodeURIComponent(command)}`,
    "_blank",
  );
});

bulkDownloadBtn.addEventListener("click", () => {
  selectedFiles.forEach((path) => downloadFile(path));
});

bulkDeleteBtn.addEventListener("click", () => {
  if (!confirm(`Delete ${selectedFiles.size} selected items?`)) return;

  selectedFiles.forEach((path) => {
    send({ type: "file_delete", path });
  });

  clearSelection();
  setTimeout(() => listFiles(currentPath), 500);
});

bulkMoveBtn.addEventListener("click", () => {
  const dest = prompt("Enter destination path:");
  if (!dest) return;

  selectedFiles.forEach((path) => {
    const fileName = path.split(/[\/\\]/).pop();
    const destPath = `${dest}/${fileName}`;
    send({ type: "file_move", source: path, dest: destPath });
  });

  clearSelection();
  setTimeout(() => listFiles(currentPath), 500);
});

bulkCopyBtn.addEventListener("click", () => {
  const dest = prompt("Enter destination path:");
  if (!dest) return;

  selectedFiles.forEach((path) => {
    const fileName = path.split(/[\/\\]/).pop();
    const destPath = `${dest}/${fileName}`;
    send({ type: "file_copy", source: path, dest: destPath });
  });

  clearSelection();
  setTimeout(() => listFiles(currentPath), 500);
});

clearSelectionBtn.addEventListener("click", clearSelection);

contextMenu.querySelectorAll(".context-menu-item").forEach((item) => {
  item.addEventListener("click", () => {
    const action = item.dataset.action;
    const path = contextMenu.dataset.path;
    const isDir = contextMenu.dataset.isDir === "true";
    const entry = { path, isDir };

    contextMenu.classList.remove("show");
    handleFileAction(action, entry);
  });
});

connect();
