import {
  formatAgo,
  formatPing,
  countryToFlag,
  osBadge,
  archBadge,
  versionBadge,
  monitorsBadge,
  shortId,
} from "./viewUtils.js";

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function createRenderer({
  grid,
  totalPill,
  pageLabel,
  openMenu,
  openModal,
  requestPreview,
  requestThumbnail,
  userRole,
}) {
  const isViewer = userRole === "viewer";

  function renderMerge(data) {
    totalPill.textContent = `${data.online ?? data.total} online / ${data.total} total`;
    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    pageLabel.textContent = `Page ${data.page} of ${totalPages}`;
    prevBtnState(data.page, totalPages);

    const seen = new Set();
    let cardIndex = 0;

    data.items.forEach((client) => {
      seen.add(client.id);
      const existing = grid.querySelector(`article[data-id="${client.id}"]`);
      if (existing) {
        updateCard(existing, client);
        return;
      }
      const card = buildCard(client);
      card.classList.add("card-animate");
      card.style.animationDelay = `${cardIndex * 0.05}s`;
      cardIndex++;
      grid.appendChild(card);
    });

    Array.from(grid.querySelectorAll("article[data-id]"))
      .filter((el) => !seen.has(el.dataset.id))
      .forEach((el) => el.remove());
  }

  function prevBtnState(currentPage, totalPages) {
    const prevBtn = document.getElementById("prev");
    const nextBtn = document.getElementById("next");
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  }

  function buildCard(client) {
    const card = document.createElement("article");
    card.dataset.id = client.id;
    card.dataset.hwid = client.hwid || "";
    updateCard(card, client);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!client.online || isViewer) return;
      const { clientX, clientY } = e;
      openMenu(client.id, clientX, clientY);
    });

    if (typeof anime !== "undefined") {
      card.style.opacity = "0";
      card.style.transform = "translateY(10px)";
      requestAnimationFrame(() => {
        anime({
          targets: card,
          opacity: [0, 1],
          translateY: [10, 0],
          duration: 400,
          easing: "easeOutQuad",
        });
      });
    }

    return card;
  }

  function updateCard(card, client) {
    const oldCheckbox = card.querySelector(".client-checkbox");
    const wasChecked = oldCheckbox?.checked || false;

    card.dataset.online = String(!!client.online);
    const os = osBadge(client.os || "unknown");
    const arch = archBadge(client.arch || "");
    const ver = versionBadge(client.version || "");
    const mons = monitorsBadge(client.monitors);
    const deviceId = shortId(client.id);
    const hwid = shortId(client.hwid || "");
    card.className = `card rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg ${client.online ? "" : "opacity-70"} tone-${os.tone}`;
    const cardThumb = client.thumbnail
      ? (() => {
          const wrapper = document.createElement("div");
          wrapper.className = "flex-shrink-0";
          const img = document.createElement("img");
          img.className =
            "w-40 h-24 rounded-lg border border-slate-800 object-cover cursor-pointer thumb-img";
          img.alt = "preview";
          img.src = client.thumbnail;
          wrapper.appendChild(img);
          return wrapper;
        })()
      : (() => {
          const wrapper = document.createElement("div");
          wrapper.className = "flex-shrink-0";
          wrapper.innerHTML = `<div class="w-40 h-24 rounded-lg border border-dashed border-slate-700 bg-slate-800/40 flex items-center justify-center text-slate-500"><i class="fa-regular fa-image"></i></div>`;
          return wrapper;
        })();

    card.innerHTML = `
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex-shrink-0 flex items-center">
          <input type="checkbox" class="client-checkbox w-5 h-5 rounded border-slate-600 bg-slate-800 checked:bg-blue-600" data-id="${escapeHtml(client.id)}" ${client.online ? "" : "disabled"}>
        </div>
        <div class="flex-shrink-0"></div>
        <div class="flex-1 min-w-[240px] flex flex-col gap-2">
          <div class="flex items-center gap-3 flex-wrap text-lg font-semibold">
            <span class="text-2xl">${countryToFlag(client.country)}</span>
            <span>${escapeHtml(client.host || deviceId)}</span>
            <span class="text-slate-400 text-sm flex items-center gap-1"><i class="fa-solid fa-user"></i> ${escapeHtml(client.user || "unknown")}</span>
            <span class="pill ${client.online ? "pill-online" : "pill-offline"}">
              <i class="fa-solid fa-circle"></i>
              ${client.online ? "Online" : "Offline"}
            </span>
          </div>
          <div class="flex items-center gap-2 flex-wrap text-sm text-slate-300">
            <span class="pill pill-ghost"><i class="fa-regular fa-clock"></i> ${formatAgo(client.lastSeen)}</span>
            <span class="pill ${os.tone}"><i class="fa ${os.icon}"></i> ${os.label}</span>
            <span class="pill ${arch.tone}"><i class="fa ${arch.icon}"></i> ${arch.label}</span>
            <span class="pill ${ver.tone}"><i class="fa ${ver.icon}"></i> ${ver.label}</span>
            <span class="pill ${mons.tone}"><i class="fa ${mons.icon}"></i> ${mons.label}</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap text-xs text-slate-400 font-mono">
            <span class="pill pill-ghost">ID ${deviceId}</span>
            ${client.hwid ? `<span class="pill pill-ghost">HW ${hwid}</span>` : ""}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-emerald-300 font-mono text-sm inline-flex items-center gap-2"><i class="fa-solid fa-satellite-dish"></i> ${formatPing(client.pingMs)}</span>
          ${isViewer ? "" : `<button ${client.online ? "" : "disabled"} class="command-btn inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-800/70 hover:bg-slate-700 disabled:opacity-50" data-id="${escapeHtml(client.id)}"><i class="fa-solid fa-bars"></i> Commands</button>`}
        </div>
      </div>
    `;

    const thumbSlots = card.querySelectorAll(".flex-shrink-0");
    if (thumbSlots.length >= 2) {
      thumbSlots[1].replaceWith(cardThumb);
    }

    const checkbox = card.querySelector(".client-checkbox");
    if (checkbox) {
      if (wasChecked && client.online) {
        checkbox.checked = true;
      }

      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        if (window.toggleClientSelection) {
          window.toggleClientSelection(client.id);
        }
      });
    }

    if (!isViewer) {
      card.querySelector(".command-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openMenu(client.id, rect.right, rect.bottom);
      });
    }

    card
      .querySelector(".thumb-img")
      ?.addEventListener("click", () => openModal(client.thumbnail));

    card.onclick = (e) => {
      if (e.target.closest(".command-btn") || e.target.closest("button"))
        return;
      if (!client.online) return;
      requestPreview(client.id);
      requestThumbnail(client.id);
    };
  }

  return { renderMerge };
}
