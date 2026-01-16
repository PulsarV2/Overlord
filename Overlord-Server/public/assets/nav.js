const host = document.getElementById("top-nav");
if (host) {
  host.className =
    "sticky top-0 z-10 w-full px-5 py-3 bg-slate-950/80 backdrop-blur border-b border-slate-800";

  host.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
      <div class="flex items-center justify-between gap-3">
        <a href="/" class="flex items-center gap-2 font-semibold tracking-wide">
          <i class="fa-solid fa-crown header-crown"></i> Overlord
        </a>
        <button
          id="nav-toggle"
          class="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700"
          aria-expanded="false"
          aria-controls="nav-panel"
        >
          <i class="fa-solid fa-bars"></i>
          <span>Menu</span>
        </button>
      </div>
      <div
        id="nav-panel"
        class="hidden md:flex md:flex-1 md:items-center md:justify-between gap-3"
      >
      <nav class="flex flex-col md:flex-row md:items-center gap-2 md:flex-1 md:justify-center">
        <a
          href="/"
          id="nav-clients"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-display"></i> Clients</a
        >
        <a
          href="/metrics"
          id="metrics-link"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-chart-line"></i> Metrics</a
        >
        <a
          href="/scripts"
          id="scripts-link"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-code"></i> Scripts</a
        >
        <a
          href="/plugins"
          id="plugins-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-puzzle-piece"></i> Plugins</a
        >
        <a
          href="/build"
          id="build-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-hammer"></i> Builder</a
        >
        <a
          href="/users"
          id="users-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-users"></i> Users</a
        >
      </nav>
      <div class="flex items-center gap-2 md:justify-end md:shrink-0">
        <div
          class="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-800 text-slate-100"
        >
          <i class="fa-solid fa-user-shield"></i>
          <span id="username-display">Loading...</span>
          <span
            id="role-badge"
            class="text-xs px-2 py-0.5 rounded-full bg-slate-700"
          ></span>
        </div>
        <button
          id="logout-btn"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-700/60 transition-colors"
          title="Logout"
        >
          <i class="fa-solid fa-right-from-bracket"></i>
          <span class="hidden sm:inline">Logout</span>
        </button>
      </div>
      </div>
    </div>
  `;

  const toggle = document.getElementById("nav-toggle");
  const panel = document.getElementById("nav-panel");
  toggle?.addEventListener("click", () => {
    const isHidden = panel?.classList.contains("hidden");
    if (!panel) return;
    panel.classList.toggle("hidden", !isHidden ? true : false);
    toggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
  });

  const path = window.location.pathname;
  const activeMap = {
    "/": "nav-clients",
    "/metrics": "metrics-link",
    "/scripts": "scripts-link",
    "/plugins": "plugins-link",
    "/build": "build-link",
    "/users": "users-link",
  };
  const activeId = activeMap[path];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.classList.remove("bg-slate-900/70", "text-slate-300");
      el.classList.add("bg-slate-800", "text-slate-50");
    }
  }
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

  const usernameDisplay = document.getElementById("username-display");
  const roleBadge = document.getElementById("role-badge");
  const usersLink = document.getElementById("users-link");
  const buildLink = document.getElementById("build-link");
  const pluginsLink = document.getElementById("plugins-link");
  const scriptsLink = document.getElementById("scripts-link");

  async function loadCurrentUser() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        return;
      }
      const user = await res.json();
      if (!user || !usernameDisplay || !roleBadge) return;
      usernameDisplay.textContent = user.username || "unknown";

      const roleBadges = {
        admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
        operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
        viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
      };
      roleBadge.innerHTML = roleBadges[user.role] || user.role || "user";
      roleBadge.classList.remove(
        "bg-purple-900/50",
        "text-purple-300",
        "border",
        "border-purple-800",
        "bg-blue-900/50",
        "text-blue-300",
        "border-blue-800",
        "bg-slate-700",
        "text-slate-300",
        "border-slate-600",
      );

      if (user.role === "admin") {
        roleBadge.classList.add(
          "bg-purple-900/50",
          "text-purple-300",
          "border",
          "border-purple-800",
        );
      } else if (user.role === "operator") {
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

      if (user.role === "admin") {
        usersLink?.classList.remove("hidden");
        pluginsLink?.classList.remove("hidden");
      }
      if (user.role === "admin" || user.role === "operator") {
        buildLink?.classList.remove("hidden");
      }
      if (user.role !== "viewer") {
        scriptsLink?.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  }

  if (usernameDisplay && roleBadge) {
    loadCurrentUser();
  }
}
