let toastContainer = null;
let toastId = 0;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = "info", duration = 4000) {
  const container = ensureToastContainer();
  const id = ++toastId;

  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation",
  };

  const titles = {
    success: "Success",
    error: "Error",
    info: "Info",
    warning: "Warning",
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.id = `toast-${id}`;
  toast.style.opacity = "0";
  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-icon">
        <i class="fa-solid ${icons[type]}"></i>
      </div>
      <div class="toast-title">${titles[type]}</div>
      <button class="toast-close" data-toast-id="${id}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="toast-message">${message}</div>
  `;

  const closeBtn = toast.querySelector(".toast-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => closeToast(id));
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "1";
  }, 50);

  if (duration > 0) {
    setTimeout(() => closeToast(id), duration);
  }

  return id;
}

function closeToast(id) {
  const toast = document.getElementById(`toast-${id}`);
  if (toast) {
    toast.classList.add("removing");
    setTimeout(() => {
      toast.remove();
      if (toastContainer && toastContainer.children.length === 0) {
        toastContainer.remove();
        toastContainer = null;
      }
    }, 300);
  }
}

window.showToast = showToast;
window.closeToast = closeToast;
