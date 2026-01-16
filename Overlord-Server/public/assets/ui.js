const menu = document.createElement("div");
menu.id = "command-menu";
menu.className =
  "fixed z-50 w-48 hidden flex-col gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 p-3 shadow-xl backdrop-blur overflow-y-auto overscroll-contain";
menu.style.maxHeight = "min(70vh, 520px)";
menu.innerHTML = `
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-emerald-800 bg-emerald-900/50 hover:bg-emerald-800/70 text-emerald-100 flex items-center gap-2" data-open="console"><i class="fa-solid fa-terminal"></i> Open Console</button>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-purple-800 bg-purple-900/50 hover:bg-purple-800/70 text-purple-100 flex items-center gap-2" data-open="remotedesktop"><i class="fa-solid fa-desktop"></i> Remote Desktop</button>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-blue-800 bg-blue-900/50 hover:bg-blue-800/70 text-blue-100 flex items-center gap-2" data-open="files"><i class="fa-solid fa-folder-tree"></i> File Browser</button>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-orange-800 bg-orange-900/50 hover:bg-orange-800/70 text-orange-100 flex items-center gap-2" data-open="processes"><i class="fa-solid fa-list-check"></i> Process Manager</button>
  <div class="border-t border-slate-700 my-2"></div>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-slate-800 bg-slate-800/60 hover:bg-slate-700 flex items-center gap-2" data-action="ping"><i class="fa-solid fa-satellite-dish"></i> Ping</button>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-slate-800 bg-slate-800/60 hover:bg-slate-700 flex items-center gap-2" data-action="reconnect"><i class="fa-solid fa-rotate"></i> Reconnect</button>
  <button class="w-full text-left px-3 py-2.5 mb-1 rounded-lg border border-red-800 bg-red-900/40 hover:bg-red-800/60 text-red-100 flex items-center gap-2" data-action="disconnect"><i class="fa-solid fa-plug-circle-xmark"></i> Disconnect</button>
  <button class="w-full text-left px-3 py-2.5 rounded-lg border border-red-900 bg-red-950/60 hover:bg-red-900/80 text-red-200 flex items-center gap-2" data-action="uninstall"><i class="fa-solid fa-trash"></i> Uninstall</button>
  <div id="plugin-section" class="hidden">
    <div class="border-t border-slate-700 my-2"></div>
    <div class="text-[11px] uppercase tracking-wider text-slate-400 px-1 mb-1">Plugins</div>
    <div id="plugin-menu" class="flex flex-col gap-1"></div>
  </div>
`;
document.body.appendChild(menu);

const modal = document.createElement("div");
modal.className =
  "modal fixed inset-0 z-40 hidden items-center justify-center bg-black/80 backdrop-blur";
modal.innerHTML = `<div class="max-w-5xl max-h-[90vh] p-4"><img class="max-h-[85vh] max-w-full rounded-xl shadow-2xl border border-slate-800 object-contain" id="modal-img" src="" alt="preview" /></div>`;
document.body.appendChild(modal);
const modalImg = modal.querySelector("#modal-img");

export function openMenu(clientId, x, y, setContext) {
  if (setContext) setContext(clientId);
  menu.classList.remove("hidden");

  const menuWidth = 192;
  const menuHeight = menu.offsetHeight || 400;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = x;
  if (left + menuWidth > viewportWidth - 10) {
    left = viewportWidth - menuWidth - 10;
  }
  if (left < 10) left = 10;

  let top = y;
  if (top + menuHeight > viewportHeight - 10) {
    top = viewportHeight - menuHeight - 10;
  }
  if (top < 10) top = 10;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function closeMenu(clearContext) {
  menu.classList.add("hidden");
  if (clearContext) clearContext();
}

export function openModal(src) {
  if (!src) return;

  modalImg.src = "";

  setTimeout(() => {
    modalImg.src = src;
    modal.classList.remove("hidden");
  }, 10);
}

export function closeModal() {
  modal.classList.add("hidden");
}

export function wireModalClose() {
  modal.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeMenu();
    }
  });
}

export { menu, modal };
