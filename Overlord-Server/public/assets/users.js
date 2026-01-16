let currentUser = null;
let users = [];

const usersTableBody = document.getElementById("users-table-body");
const addUserBtn = document.getElementById("add-user-btn");
const userModal = document.getElementById("user-modal");
const modalTitle = document.getElementById("modal-title");
const userForm = document.getElementById("user-form");
const closeModal = document.getElementById("close-modal");
const cancelBtn = document.getElementById("cancel-btn");
const errorMessage = document.getElementById("error-message");
const errorText = document.getElementById("error-text");
const logoutBtn = document.getElementById("logout-btn");
const currentUserEl = document.getElementById("username-display");
const currentRoleEl = document.getElementById("role-badge");

async function getCurrentUser() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      currentUser = await res.json();
      currentUserEl.textContent = currentUser.username;

      const roleBadges = {
        admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
        operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
        viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
      };
      currentRoleEl.innerHTML =
        roleBadges[currentUser.role] || currentUser.role;

      if (currentUser.role === "admin") {
        currentRoleEl.classList.add(
          "bg-purple-900/50",
          "text-purple-300",
          "border",
          "border-purple-800",
        );
      } else if (currentUser.role === "operator") {
        currentRoleEl.classList.add(
          "bg-blue-900/50",
          "text-blue-300",
          "border",
          "border-blue-800",
        );
      } else {
        currentRoleEl.classList.add(
          "bg-slate-700",
          "text-slate-300",
          "border",
          "border-slate-600",
        );
      }

      if (currentUser.role === "admin") {
        document.getElementById("metrics-link")?.classList.remove("hidden");
        document.getElementById("scripts-link")?.classList.remove("hidden");
        document.getElementById("build-link")?.classList.remove("hidden");
        document.getElementById("users-link")?.classList.remove("hidden");
        document.getElementById("plugins-link")?.classList.remove("hidden");
      } else if (currentUser.role === "operator") {
        document.getElementById("metrics-link")?.classList.remove("hidden");
        document.getElementById("scripts-link")?.classList.remove("hidden");
        document.getElementById("build-link")?.classList.remove("hidden");
      }

      if (currentUser.role !== "admin") {
        alert("Access denied. Admin role required.");
        window.location.href = "/";
      }
    } else {
      window.location.href = "/login.html";
    }
  } catch (err) {
    console.error("Failed to get current user:", err);
    window.location.href = "/login.html";
  }
}

if (logoutBtn && !logoutBtn.dataset.boundLogout) {
  logoutBtn.dataset.boundLogout = "true";
  logoutBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to logout?")) return;

    try {
      const res = await fetch("/api/logout", { method: "POST" });
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

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    if (!res.ok) {
      throw new Error("Failed to load users");
    }

    const data = await res.json();
    users = data.users || [];
    renderUsers();
  } catch (err) {
    console.error("Load users error:", err);
    usersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-12 text-center text-red-400">
          <i class="fa-solid fa-exclamation-triangle mr-2"></i>
          Failed to load users
        </td>
      </tr>
    `;
  }
}

function renderUsers() {
  if (users.length === 0) {
    usersTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-12 text-center text-slate-400">
          <i class="fa-solid fa-users mr-2"></i>
          No users found
        </td>
      </tr>
    `;
    return;
  }

  usersTableBody.innerHTML = users
    .map(
      (user) => `
    <tr class="hover:bg-slate-800/30 transition-colors">
      <td class="px-6 py-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-user text-slate-400"></i>
          <span class="font-medium text-slate-200">${escapeHtml(user.username)}</span>
          ${user.id === currentUser?.userId ? '<span class="text-xs text-blue-400">(You)</span>' : ""}
        </div>
      </td>
      <td class="px-6 py-4">
        ${getRoleBadge(user.role)}
      </td>
      <td class="px-6 py-4 text-sm text-slate-400">
        ${formatDate(user.created_at)}
      </td>
      <td class="px-6 py-4 text-sm text-slate-400">
        ${user.last_login ? formatDate(user.last_login) : '<span class="text-slate-500">Never</span>'}
      </td>
      <td class="px-6 py-4 text-sm text-slate-400">
        ${escapeHtml(user.created_by || "System")}
      </td>
      <td class="px-6 py-4">
        <div class="flex items-center justify-end gap-2">
          ${
            user.id !== currentUser?.userId
              ? `
            <button 
              class="user-action-btn px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
              data-action="change-password"
              data-user-id="${user.id}"
              data-username="${escapeHtml(user.username)}"
              title="Change Password"
            >
              <i class="fa-solid fa-key"></i>
            </button>
            <button 
              class="user-action-btn px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
              data-action="change-role"
              data-user-id="${user.id}"
              data-username="${escapeHtml(user.username)}"
              data-role="${user.role}"
              title="Change Role"
            >
              <i class="fa-solid fa-user-tag"></i>
            </button>
            <button 
              class="user-action-btn px-3 py-1.5 text-sm bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded border border-red-800 transition-colors"
              data-action="delete"
              data-user-id="${user.id}"
              data-username="${escapeHtml(user.username)}"
              title="Delete User"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          `
              : '<span class="text-slate-500 text-sm italic">Cannot edit yourself</span>'
          }
        </div>
      </td>
    </tr>
  `,
    )
    .join("");

  attachActionListeners();
}

function getRoleBadge(role) {
  const badges = {
    admin:
      '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-900/30 text-purple-300 border border-purple-800"><i class="fa-solid fa-crown mr-1"></i>Admin</span>',
    operator:
      '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/30 text-blue-300 border border-blue-800"><i class="fa-solid fa-sliders mr-1"></i>Operator</span>',
    viewer:
      '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-300 border border-slate-600"><i class="fa-solid fa-eye mr-1"></i>Viewer</span>',
  };
  return badges[role] || role;
}

function attachActionListeners() {
  const oldListener = usersTableBody._actionListener;
  if (oldListener) {
    usersTableBody.removeEventListener("click", oldListener);
  }

  const listener = (e) => {
    const btn = e.target.closest(".user-action-btn");
    if (!btn) return;

    const action = btn.dataset.action;
    const userId = parseInt(btn.dataset.userId);
    const username = btn.dataset.username;
    const role = btn.dataset.role;

    switch (action) {
      case "change-password":
        changePassword(userId, username);
        break;
      case "change-role":
        changeRole(userId, username, role);
        break;
      case "delete":
        deleteUser(userId, username);
        break;
    }
  };

  usersTableBody.addEventListener("click", listener);
  usersTableBody._actionListener = listener;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showModal(title) {
  modalTitle.textContent = title;
  userModal.classList.remove("hidden");
  errorMessage.classList.add("hidden");
  userForm.reset();
}

function hideModal() {
  userModal.classList.add("hidden");
  userForm.reset();
}

function showError(message) {
  errorText.textContent = message;
  errorMessage.classList.remove("hidden");
}

addUserBtn.addEventListener("click", () => {
  showModal("Add User");
  document.getElementById("password-field").classList.remove("hidden");
  document.getElementById("password").required = true;
});

closeModal.addEventListener("click", hideModal);
cancelBtn.addEventListener("click", hideModal);

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(userForm);
  const username = formData.get("username");
  const password = formData.get("password");
  const role = formData.get("role");

  try {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });

    const data = await res.json();

    if (res.ok) {
      hideModal();
      await loadUsers();
    } else {
      showError(data.error || "Failed to create user");
    }
  } catch (err) {
    console.error("Create user error:", err);
    showError("Network error. Please try again.");
  }
});

window.changePassword = async function (userId, username) {
  const password = prompt(`Enter new password for ${username}:`);
  if (!password) return;

  if (password.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  try {
    const res = await fetch(`/api/users/${userId}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (res.ok) {
      alert("Password updated successfully");
    } else {
      alert(data.error || "Failed to update password");
    }
  } catch (err) {
    console.error("Update password error:", err);
    alert("Network error. Please try again.");
  }
};

window.changeRole = async function (userId, username, currentRole) {
  const roles = ["viewer", "operator", "admin"];
  const roleNames = { viewer: "Viewer", operator: "Operator", admin: "Admin" };

  const message = `Select new role for ${username}:\n\n1. Viewer (Read-only)\n2. Operator (Control clients)\n3. Admin (Full access)\n\nCurrent: ${roleNames[currentRole]}`;
  const choice = prompt(message);

  if (!choice || !["1", "2", "3"].includes(choice)) return;

  const newRole = roles[parseInt(choice) - 1];

  if (newRole === currentRole) {
    alert("No change made");
    return;
  }

  if (!confirm(`Change ${username}'s role to ${roleNames[newRole]}?`)) return;

  try {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });

    const data = await res.json();

    if (res.ok) {
      alert("Role updated successfully");
      await loadUsers();
    } else {
      alert(data.error || "Failed to update role");
    }
  } catch (err) {
    console.error("Update role error:", err);
    alert("Network error. Please try again.");
  }
};

window.deleteUser = async function (userId, username) {
  if (
    !confirm(
      `Are you sure you want to delete user "${username}"? This action cannot be undone.`,
    )
  ) {
    return;
  }

  try {
    const res = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (res.ok) {
      alert("User deleted successfully");
      await loadUsers();
    } else {
      alert(data.error || "Failed to delete user");
    }
  } catch (err) {
    console.error("Delete user error:", err);
    alert("Network error. Please try again.");
  }
};

getCurrentUser();
loadUsers();
