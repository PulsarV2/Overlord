window.handleLogout = async function () {
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
};
