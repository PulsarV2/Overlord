export function countryToFlag(code) {
  const fallback = `<span class="fi fi-so"></span>`;
  if (!code) return fallback;
  const cc = String(code).trim().toLowerCase();

  if (!/^[a-z]{2}$/.test(cc) || cc === "zz") return fallback;
  return `<span class="fi fi-${cc}"></span>`;
}

export function formatPing(ms) {
  if (ms === null || ms === undefined) return "measuring…";
  return `${ms} ms`;
}

export function formatAgo(ts) {
  const delta = Date.now() - ts;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function shortId(id = "") {
  if (!id) return "unknown";
  return id.length <= 8 ? id : `${id.slice(0, 6)}…${id.slice(-2)}`;
}

export function osBadge(osRaw = "") {
  const os = osRaw.toLowerCase();
  const base = {
    label: osRaw || "Unknown",
    icon: "fa-linux",
    tone: "pill-unknown",
  };
  if (os.includes("windows"))
    return { label: "Windows", icon: "fa-brands fa-windows", tone: "pill-win" };
  if (os.includes("mac") || os.includes("darwin"))
    return { label: "macOS", icon: "fa-brands fa-apple", tone: "pill-mac" };
  if (os.includes("ubuntu"))
    return { label: "Ubuntu", icon: "fa-brands fa-linux", tone: "pill-ubuntu" };
  if (os.includes("debian"))
    return { label: "Debian", icon: "fa-brands fa-linux", tone: "pill-debian" };
  if (os.includes("arch"))
    return { label: "Arch", icon: "fa-brands fa-linux", tone: "pill-arch" };
  if (os.includes("kali"))
    return { label: "Kali", icon: "fa-brands fa-linux", tone: "pill-kali" };
  if (os.includes("fedora"))
    return { label: "Fedora", icon: "fa-brands fa-linux", tone: "pill-fedora" };
  if (os.includes("linux"))
    return { label: "Linux", icon: "fa-brands fa-linux", tone: "pill-linux" };
  return base;
}

export function archBadge(archRaw = "") {
  const arch = archRaw.toLowerCase();
  if (arch.includes("arm"))
    return { label: archRaw || "ARM", icon: "fa-microchip", tone: "pill-arm" };
  if (arch.includes("64") || arch.includes("x86") || arch.includes("amd"))
    return { label: archRaw || "x64", icon: "fa-microchip", tone: "pill-x64" };
  if (!archRaw)
    return { label: "arch?", icon: "fa-microchip", tone: "pill-unknown" };
  return { label: archRaw, icon: "fa-microchip", tone: "pill-ghost" };
}

export function versionBadge(versionRaw = "") {
  const label = versionRaw ? `v${versionRaw}` : "v0";
  return {
    label,
    icon: "fa-tag",
    tone: versionRaw ? "pill-version" : "pill-unknown",
  };
}

export function monitorsBadge(count) {
  const n = Number(count) || 1;
  const label = `${n} monitor${n > 1 ? "s" : ""}`;
  return { label, icon: "fa-display", tone: "pill-ghost" };
}
