let clientsChart = null;
let commandsChart = null;

function initCharts() {
  const clientsCtx = document.getElementById("clients-chart");
  const commandsCtx = document.getElementById("commands-chart");

  clientsChart = new Chart(clientsCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Clients Online",
          data: [],
          borderColor: "rgb(96, 165, 250)",
          backgroundColor: "rgba(96, 165, 250, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: "#94a3b8", stepSize: 1 },
          grid: { color: "rgba(100, 116, 139, 0.1)" },
        },
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 10 },
          grid: { color: "rgba(100, 116, 139, 0.1)" },
        },
      },
    },
  });

  commandsChart = new Chart(commandsCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Commands/Min",
          data: [],
          borderColor: "rgb(192, 132, 252)",
          backgroundColor: "rgba(192, 132, 252, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(100, 116, 139, 0.1)" },
        },
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 10 },
          grid: { color: "rgba(100, 116, 139, 0.1)" },
        },
      },
    },
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function animateCounter(element, newValue, duration = 800) {
  const oldValue = parseInt(element.textContent.replace(/,/g, "")) || 0;
  if (oldValue === newValue) return;

  const startTime = performance.now();
  const diff = newValue - oldValue;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const easeOutQuad = progress * (2 - progress);
    const current = Math.round(oldValue + diff * easeOutQuad);

    element.textContent = current.toLocaleString();
    element.classList.add("counter-animate");

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      setTimeout(() => element.classList.remove("counter-animate"), 500);
    }
  }

  requestAnimationFrame(update);
}

function updateMetrics(data) {
  animateCounter(
    document.getElementById("clients-online"),
    data.clients.online,
  );
  animateCounter(document.getElementById("clients-total"), data.clients.total);

  const totalSessions =
    data.sessions.console +
    data.sessions.remoteDesktop +
    data.sessions.fileBrowser +
    data.sessions.process;
  animateCounter(document.getElementById("active-sessions"), totalSessions);

  animateCounter(
    document.getElementById("commands-hour"),
    data.commands.lastHour,
  );
  animateCounter(
    document.getElementById("commands-minute"),
    data.commands.lastMinute,
  );
  animateCounter(
    document.getElementById("commands-total"),
    data.commands.total,
  );

  const totalRate =
    data.bandwidth.sentPerSecond + data.bandwidth.receivedPerSecond;
  document.getElementById("bandwidth-rate").textContent =
    formatBytes(totalRate) + "/s";
  document.getElementById("bandwidth-sent").textContent = formatBytes(
    data.bandwidth.sent,
  );
  document.getElementById("bandwidth-received").textContent = formatBytes(
    data.bandwidth.received,
  );

  document.getElementById("server-uptime").textContent = formatDuration(
    data.server.uptime,
  );
  document.getElementById("server-memory").textContent = formatBytes(
    data.server.memoryUsage.heapUsed,
  );
  animateCounter(
    document.getElementById("total-connections"),
    data.connections.totalConnections,
  );

  if (data.ping.count > 0) {
    document.getElementById("ping-avg").textContent =
      Math.round(data.ping.avg) + " ms";
    document.getElementById("ping-min").textContent =
      Math.round(data.ping.min) + " ms";
    document.getElementById("ping-max").textContent =
      Math.round(data.ping.max) + " ms";
    animateCounter(document.getElementById("ping-count"), data.ping.count);
  } else {
    document.getElementById("ping-avg").textContent = "-";
    document.getElementById("ping-min").textContent = "-";
    document.getElementById("ping-max").textContent = "-";
    document.getElementById("ping-count").textContent = "0";
  }

  const osList = document.getElementById("clients-by-os");
  if (Object.keys(data.clients.byOS).length > 0) {
    osList.innerHTML = Object.entries(data.clients.byOS)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([os, count]) => `
        <div class="flex justify-between items-center">
          <span class="text-slate-400">${os}</span>
          <span class="font-semibold">${count}</span>
        </div>
      `,
      )
      .join("");
  } else {
    osList.innerHTML = '<div class="text-slate-500">No clients</div>';
  }

  const commandTypesList = document.getElementById("command-types");
  if (Object.keys(data.commands.byType).length > 0) {
    const topCommands = Object.entries(data.commands.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    commandTypesList.innerHTML = topCommands
      .map(
        ([type, count]) => `
      <div class="bg-slate-800/50 rounded p-3">
        <div class="text-xs text-slate-400 mb-1">${type}</div>
        <div class="text-xl font-bold">${count.toLocaleString()}</div>
      </div>
    `,
      )
      .join("");
  } else {
    commandTypesList.innerHTML =
      '<div class="text-slate-500 col-span-full text-center py-4">No commands executed yet</div>';
  }

  document.getElementById("last-update").textContent =
    new Date().toLocaleTimeString();
}

function updateCharts(history, snapshot) {
  if (history.length === 0) {
    const now = new Date();
    const label = formatTime(now.getTime());

    clientsChart.data.labels = [label];
    clientsChart.data.datasets[0].data = [snapshot.clients.online];
    clientsChart.update("none");

    commandsChart.data.labels = [label];
    commandsChart.data.datasets[0].data = [snapshot.commands.lastMinute];
    commandsChart.update("none");
    return;
  }

  const labels = history.map((h) => formatTime(h.timestamp));
  const clientsData = history.map((h) => h.clientsOnline);

  clientsChart.data.labels = labels;
  clientsChart.data.datasets[0].data = clientsData;
  clientsChart.update("none");

  const commandsData = history.map((h) => h.commandsPerMinute);

  commandsChart.data.labels = labels;
  commandsChart.data.datasets[0].data = commandsData;
  commandsChart.update("none");
}

async function fetchMetrics() {
  try {
    const response = await fetch("/api/metrics", {
      credentials: "include",
    });

    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    if (!response.ok) {
      throw new Error("Failed to fetch metrics");
    }

    const data = await response.json();
    updateMetrics(data.snapshot);
    updateCharts(data.history, data.snapshot);

    document.getElementById("status-text").textContent = "Live";
  } catch (err) {
    console.error("Error fetching metrics:", err);
    document.getElementById("status-text").textContent = "Error";
  }
}

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
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
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
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

document.addEventListener("DOMContentLoaded", async () => {
  await checkAuth();

  initCharts();

  await fetchMetrics();

  setInterval(fetchMetrics, 2000);

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn && !logoutBtn.dataset.boundLogout) {
    logoutBtn.dataset.boundLogout = "true";
    logoutBtn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to logout?")) return;

      try {
        const res = await fetch("/api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (res.ok) {
          window.location.href = "/";
        } else {
          alert("Logout failed. Please try again.");
        }
      } catch (err) {
        console.error("Logout error:", err);
        alert("Logout failed. Please try again.");
      }
    });
  }
});
