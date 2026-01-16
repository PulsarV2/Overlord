const form = document.getElementById("build-form");
const buildBtn = document.getElementById("build-btn");
const buildStatus = document.getElementById("build-status");
const buildStatusText = document.getElementById("build-status-text");
const buildOutputDiv = document.getElementById("build-output");
const buildOutputContainer = document.getElementById("build-output-container");
const buildResults = document.getElementById("build-results");
const buildFilesDiv = document.getElementById("build-files");
const logoutBtn = document.getElementById("logout-btn");
const usernameDisplay = document.getElementById("username-display");
const roleBadge = document.getElementById("role-badge");
const usersLink = document.getElementById("users-link");
const buildLink = document.getElementById("build-link");
const scriptsLink = document.getElementById("scripts-link");
const pluginsLink = document.getElementById("plugins-link");

let isBuilding = false;

init();

async function init() {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
    });

    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    usernameDisplay.textContent = data.username;

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
      usersLink.classList.remove("hidden");
      pluginsLink?.classList.remove("hidden");
    }

    if (data.role === "admin" || data.role === "operator") {
      buildLink?.classList.remove("hidden");
    }

    if (data.role !== "viewer") {
      scriptsLink?.classList.remove("hidden");
    }

    if (data.role !== "admin" && data.role !== "operator") {
      buildBtn.disabled = true;
      buildBtn.innerHTML =
        '<i class="fa-solid fa-lock"></i> <span>Build requires admin/operator role</span>';
    }

    loadSavedBuilds();
  } catch (err) {
    console.error("Failed to fetch user info:", err);
    window.location.href = "/login.html";
  }
}

if (logoutBtn && !logoutBtn.dataset.boundLogout) {
  logoutBtn.dataset.boundLogout = "true";
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
    window.location.href = "/";
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isBuilding) return;

  const platformCheckboxes = form.querySelectorAll(
    'input[name="platform"]:checked',
  );
  const platforms = Array.from(platformCheckboxes).map((cb) => cb.value);

  if (platforms.length === 0) {
    alert("Please select at least one platform to build");
    return;
  }

  const serverUrl = form.querySelector("#server-url").value.trim();
  const customId = form.querySelector("#custom-id").value.trim();
  const countryCode = form
    .querySelector("#country-code")
    .value.trim()
    .toUpperCase();
  const stripDebug = form.querySelector('input[name="strip-debug"]').checked;
  const disableCgo = form.querySelector('input[name="disable-cgo"]').checked;
  const enablePersistence = form.querySelector(
    'input[name="enable-persistence"]',
  ).checked;

  const buildConfig = {
    platforms,
    serverUrl: serverUrl || undefined,
    customId: customId || undefined,
    countryCode: countryCode || undefined,
    stripDebug,
    disableCgo,
    enablePersistence,
  };

  await startBuild(buildConfig);
});

async function startBuild(config) {
  isBuilding = true;
  buildBtn.disabled = true;
  buildBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> <span>Building...</span>';

  buildStatus.classList.remove("hidden");
  buildStatusText.textContent = "Starting build...";
  buildResults.classList.add("hidden");
  buildFilesDiv.innerHTML = "";

  buildOutputDiv.innerHTML = "";
  addBuildOutput("Starting build process...\n", "info");

  try {
    const res = await fetch("/api/build/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(config),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Build failed to start");
    }

    const data = await res.json();
    const buildId = data.buildId;

    addBuildOutput(`Build ID: ${buildId}\n`, "info");
    addBuildOutput(
      `Building for platforms: ${config.platforms.join(", ")}\n\n`,
      "info",
    );

    await streamBuildOutput(buildId);
  } catch (err) {
    addBuildOutput(`\nERROR: ${err.message}\n`, "error");
    buildStatusText.textContent = "Build failed";
    buildStatus.querySelector("div").className =
      "flex items-center gap-2 p-3 rounded-lg bg-red-900/40 border border-red-700/60";
    buildStatus.querySelector("i").className = "fa-solid fa-circle-xmark";
  } finally {
    isBuilding = false;
    buildBtn.disabled = false;
    buildBtn.innerHTML =
      '<i class="fa-solid fa-hammer"></i> <span>Start Build</span>';
  }
}

async function streamBuildOutput(buildId) {
  const res = await fetch(`/api/build/${buildId}/stream`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("Failed to connect to build stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.substring(6));

          if (data.type === "output") {
            addBuildOutput(data.text, data.level || "info");
          } else if (data.type === "status") {
            buildStatusText.textContent = data.text;
          } else if (data.type === "complete") {
            buildStatusText.textContent = data.success
              ? "Build completed successfully!"
              : "Build failed";
            buildStatus.querySelector("div").className = data.success
              ? "flex items-center gap-2 p-3 rounded-lg bg-green-900/40 border border-green-700/60"
              : "flex items-center gap-2 p-3 rounded-lg bg-red-900/40 border border-red-700/60";
            buildStatus.querySelector("i").className = data.success
              ? "fa-solid fa-circle-check"
              : "fa-solid fa-circle-xmark";

            if (data.success && data.files) {
              const buildData = {
                id: data.buildId,
                status: "success",
                startTime: Date.now(),
                expiresAt: data.expiresAt,
                files: data.files,
              };
              saveBuildToStorage(data.buildId, buildData);

              buildResults.classList.remove("hidden");
              displayBuild(buildData);
            }

            reader.releaseLock();
            return;
          } else if (data.type === "error") {
            addBuildOutput(`\nERROR: ${data.error}\n`, "error");
          }
        }
      }

      buildOutputContainer.scrollTop = buildOutputContainer.scrollHeight;
    }
  } finally {
    reader.releaseLock();
  }
}

function addBuildOutput(text, level = "info") {
  const span = document.createElement("span");
  span.textContent = text;

  if (level === "error") {
    span.className = "text-red-400";
  } else if (level === "success") {
    span.className = "text-green-400";
  } else if (level === "warn") {
    span.className = "text-yellow-400";
  } else {
    span.className = "text-slate-300";
  }

  buildOutputDiv.appendChild(span);
}

function showBuildFiles(files, buildId, expiresAt) {
  buildResults.classList.remove("hidden");
  buildFilesDiv.innerHTML = "";

  const buildInfoDiv = document.createElement("div");
  buildInfoDiv.className =
    "mb-3 p-3 bg-slate-900/70 border border-slate-700 rounded-lg";
  buildInfoDiv.innerHTML = `
    <div class="flex items-center justify-between gap-2 text-sm">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-fingerprint text-slate-400"></i>
        <span class="text-slate-300">Build ID:</span>
        <code class="text-blue-400 font-mono">${buildId}</code>
      </div>
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-clock text-slate-400"></i>
        <span class="text-slate-300">Expires in:</span>
        <span id="expiration-timer" class="text-yellow-400 font-medium" data-expires="${expiresAt}">Calculating...</span>
      </div>
    </div>
  `;
  buildFilesDiv.appendChild(buildInfoDiv);

  updateExpirationTimer();
  setInterval(updateExpirationTimer, 60000);

  files.forEach((file) => {
    const fileDiv = document.createElement("div");
    fileDiv.className =
      "flex items-center justify-between gap-2 p-3 bg-slate-800/60 border border-slate-700 rounded-lg";

    const fileInfo = document.createElement("div");
    fileInfo.className = "flex items-center gap-2";
    fileInfo.innerHTML = `
      <i class="fa-solid fa-file-code text-blue-400"></i>
      <span class="font-medium">${file.name}</span>
      <span class="text-xs text-slate-500">${formatFileSize(file.size)}</span>
    `;

    const downloadBtn = document.createElement("a");
    downloadBtn.href = `/api/build/download/${file.name}`;
    downloadBtn.className =
      "inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors";
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';

    fileDiv.appendChild(fileInfo);
    fileDiv.appendChild(downloadBtn);
    buildFilesDiv.appendChild(fileDiv);
  });
}

function updateExpirationTimer(timerEl, expiresAt) {
  if (!timerEl) return;

  const now = Date.now();
  const remaining = expiresAt - now;

  if (remaining <= 0) {
    timerEl.textContent = "Expired";
    timerEl.className = "text-red-400 font-medium";
    return;
  }

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    timerEl.textContent = `${days}d ${hours}h`;
  } else if (hours > 0) {
    timerEl.textContent = `${hours}h ${minutes}m`;
  } else {
    timerEl.textContent = `${minutes}m`;
  }

  if (days >= 3) {
    timerEl.className = "text-green-400 font-medium";
  } else if (days >= 1) {
    timerEl.className = "text-yellow-400 font-medium";
  } else {
    timerEl.className = "text-orange-400 font-medium";
  }
}

async function deleteBuild(buildId) {
  if (!confirm("Are you sure you want to delete this build?")) {
    return;
  }

  try {
    const res = await fetch(`/api/build/${buildId}/delete`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("Failed to delete build");
    }

    const buildElement = document.getElementById(`build-${buildId}`);
    if (buildElement) {
      buildElement.remove();
    }

    removeBuildFromStorage(buildId);

    if (buildFilesDiv.children.length === 0) {
      buildResults.classList.add("hidden");
    }
  } catch (err) {
    console.error("Failed to delete build:", err);
    alert("Failed to delete build. Please try again.");
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function saveBuildToStorage(buildId, buildData) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    const existingIndex = builds.findIndex((b) => b.id === buildId);

    if (existingIndex >= 0) {
      builds[existingIndex] = buildData;
    } else {
      builds.push(buildData);
    }

    if (builds.length > 20) {
      builds.splice(0, builds.length - 20);
    }

    localStorage.setItem("overlord_builds", JSON.stringify(builds));
  } catch (err) {
    console.error("Failed to save build to localStorage:", err);
  }
}

function getBuildFromStorage(buildId) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    return builds.find((b) => b.id === buildId);
  } catch (err) {
    console.error("Failed to get build from localStorage:", err);
    return null;
  }
}

function getAllBuildsFromStorage() {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");

    return builds.sort((a, b) => b.startTime - a.startTime);
  } catch (err) {
    console.error("Failed to get builds from localStorage:", err);
    return [];
  }
}

function removeBuildFromStorage(buildId) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    const filtered = builds.filter((b) => b.id !== buildId);
    localStorage.setItem("overlord_builds", JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to remove build from localStorage:", err);
  }
}

async function loadSavedBuilds() {
  try {
    const res = await fetch("/api/build/list", {
      credentials: "include",
    });

    if (!res.ok) {
      console.error("Failed to fetch builds from server");
      return;
    }

    const data = await res.json();
    const builds = data.builds || [];

    const now = Date.now();
    const validBuilds = builds.filter((build) => {
      if (build.expiresAt && build.expiresAt <= now) {
        return false;
      }
      return true;
    });

    if (validBuilds.length === 0) {
      return;
    }

    buildResults.classList.remove("hidden");

    for (const build of validBuilds) {
      displayBuild(build);

      saveBuildToStorage(build.id, build);
    }
  } catch (err) {
    console.error("Failed to load builds:", err);

    const builds = getAllBuildsFromStorage();
    const now = Date.now();
    const validBuilds = builds.filter((build) => {
      if (build.expiresAt && build.expiresAt <= now) {
        removeBuildFromStorage(build.id);
        return false;
      }
      return true;
    });

    if (validBuilds.length > 0) {
      buildResults.classList.remove("hidden");
      validBuilds.forEach((build) => displayBuild(build));
    }
  }
}

function displayBuild(build) {
  const buildContainer = document.createElement("div");
  buildContainer.className =
    "build-result-item mb-6 pb-6 border-b border-gray-700 last:border-b-0";
  buildContainer.id = `build-${build.id}`;
  buildContainer.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-3">
        <i class="fa-solid fa-box text-blue-400"></i>
        <span class="text-gray-300 font-medium">Build ID: ${build.id.substring(0, 8)}</span>
        <span class="text-gray-500">•</span>
        <span class="text-sm text-gray-400">${new Date(build.startTime).toLocaleString()}</span>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-clock text-gray-400"></i>
          <span id="timer-${build.id}" class="text-gray-300 font-medium">Loading...</span>
        </div>
        <button
          id="delete-btn-${build.id}"
          class="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2 text-sm"
          title="Delete build"
        >
          <i class="fa-solid fa-trash"></i>
          <span>Delete</span>
        </button>
      </div>
    </div>
    <div id="files-${build.id}" class="space-y-2"></div>
  `;

  buildFilesDiv.appendChild(buildContainer);

  const deleteBtn = document.getElementById(`delete-btn-${build.id}`);
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => deleteBuild(build.id));
  }

  showBuildFilesForContainer(build, `files-${build.id}`, `timer-${build.id}`);
}

function showBuildFilesForContainer(build, containerId, timerId) {
  const container = document.getElementById(containerId);
  const timerEl = document.getElementById(timerId);

  if (!container || !timerEl) return;

  build.files.forEach((file) => {
    const fileDiv = document.createElement("div");
    fileDiv.className =
      "flex items-center justify-between bg-gray-700/50 p-4 rounded-lg hover:bg-gray-700 transition-colors";

    fileDiv.innerHTML = `
      <div class="flex items-center gap-3">
        <i class="fa-solid fa-file text-blue-400"></i>
        <div>
          <div class="text-white font-medium">${file.filename}</div>
          <div class="text-sm text-gray-400">${file.platform}</div>
        </div>
      </div>
      <a
        href="/api/build/download/${encodeURIComponent(file.filename)}"
        download
        class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
      >
        <i class="fa-solid fa-download"></i>
        <span>Download</span>
      </a>
    `;

    container.appendChild(fileDiv);
  });

  if (build.expiresAt) {
    updateExpirationTimer(timerEl, build.expiresAt);

    setInterval(() => updateExpirationTimer(timerEl, build.expiresAt), 60000);
  }
}
