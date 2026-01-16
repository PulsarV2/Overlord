(function () {
  const clientId = new URLSearchParams(location.search).get("clientId");
  if (!clientId) {
    alert("Missing clientId");
    return;
  }
  const clientLabel = document.getElementById("clientLabel");
  clientLabel.textContent = clientId;

  const ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/api/clients/" +
      clientId +
      "/rd/ws",
  );
  const displaySelect = document.getElementById("displaySelect");
  const refreshBtn = document.getElementById("refreshDisplays");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const mouseCtrl = document.getElementById("mouseCtrl");
  const kbdCtrl = document.getElementById("kbdCtrl");
  const cursorCtrl = document.getElementById("cursorCtrl");
  const qualitySlider = document.getElementById("qualitySlider");
  const qualityValue = document.getElementById("qualityValue");
  const canvas = document.getElementById("frameCanvas");
  const canvasContainer = document.getElementById("canvasContainer");
  const ctx = canvas.getContext("2d");
  const agentFps = document.getElementById("agentFps");
  const viewerFps = document.getElementById("viewerFps");
  ws.binaryType = "arraybuffer";

  let activeClientId = clientId;
  let renderCount = 0;
  let renderWindowStart = performance.now();

  function updateFpsDisplay(agentValue) {
    if (agentValue !== undefined && agentValue !== null && agentFps) {
      agentFps.textContent = String(agentValue);
    }
    const now = performance.now();
    renderCount += 1;
    const elapsed = now - renderWindowStart;
    if (elapsed >= 1000 && viewerFps) {
      const fps = Math.round((renderCount * 1000) / elapsed);
      viewerFps.textContent = String(fps);
      renderCount = 0;
      renderWindowStart = now;
    }
  }

  function sendCmd(type, payload) {
    if (!activeClientId) {
      console.warn("No active client selected");
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const msg = { type, ...payload };
    console.debug("rd: send", msg);
    ws.send(JSON.stringify(msg));
  }

  let monitors = 1;

  function populateDisplays(count) {
    displaySelect.innerHTML = "";
    monitors = count || 1;
    for (let i = 0; i < monitors; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = "Display " + (i + 1);
      displaySelect.appendChild(opt);
    }

    if (displaySelect.options.length) {
      displaySelect.value = displaySelect.options[0].value;
    }
  }

  async function fetchClientInfo() {
    try {
      const res = await fetch("/api/clients");
      const data = await res.json();
      const client = data.items.find((c) => c.id === activeClientId);
      if (client) {
        clientLabel.textContent = `${client.host || client.id} (${client.os || ""})`;
      }
      if (client && client.monitors) {
        populateDisplays(client.monitors);
      }
    } catch (e) {
      console.warn("failed to fetch client info", e);
    }
  }

  refreshBtn.addEventListener("click", fetchClientInfo);

  function updateQualityLabel(val) {
    if (qualityValue) {
      qualityValue.textContent = `${val}%`;
    }
  }

  function pushQuality(val) {
    const q = Number(val) || 90;
    const codec = q >= 100 ? "raw" : "jpeg";
    sendCmd("desktop_set_quality", { quality: q, codec });
  }

  displaySelect.addEventListener("change", function () {
    console.debug("rd: select display", displaySelect.value);
    sendCmd("desktop_select_display", {
      display: parseInt(displaySelect.value, 10),
    });
  });

  startBtn.addEventListener("click", function () {
    if (displaySelect && displaySelect.value !== undefined) {
      sendCmd("desktop_select_display", {
        display: parseInt(displaySelect.value, 10) || 0,
      });
    }
    sendCmd("desktop_start", {});
  });
  stopBtn.addEventListener("click", function () {
    sendCmd("desktop_stop", {});
  });
  fullscreenBtn.addEventListener("click", function () {
    if (canvasContainer.requestFullscreen) {
      canvasContainer.requestFullscreen();
    } else if (canvasContainer.webkitRequestFullscreen) {
      canvasContainer.webkitRequestFullscreen();
    } else if (canvasContainer.mozRequestFullScreen) {
      canvasContainer.mozRequestFullScreen();
    }
  });
  mouseCtrl.addEventListener("change", function () {
    sendCmd("desktop_enable_mouse", { enabled: mouseCtrl.checked });
  });
  kbdCtrl.addEventListener("change", function () {
    sendCmd("desktop_enable_keyboard", { enabled: kbdCtrl.checked });
  });
  cursorCtrl.addEventListener("change", function () {
    sendCmd("desktop_enable_cursor", { enabled: cursorCtrl.checked });
  });

  if (qualitySlider) {
    updateQualityLabel(qualitySlider.value);
    qualitySlider.addEventListener("input", function () {
      updateQualityLabel(qualitySlider.value);
      pushQuality(qualitySlider.value);
    });
  }

  ws.addEventListener("message", async function (ev) {
    if (ev.data instanceof ArrayBuffer) {
      const buf = new Uint8Array(ev.data);
      if (buf.length < 8) return;
      if (buf[0] !== 0x46 || buf[1] !== 0x52 || buf[2] !== 0x4d) return;
      const fps = buf[5];
      const format = buf[6];

      if (format === 1) {
        const jpegBytes = buf.slice(8);
        const blob = new Blob([jpegBytes], { type: "image/jpeg" });
        try {
          const bitmap = await createImageBitmap(blob);
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          updateFpsDisplay(fps);
        } catch {
          const img = new Image();
          const url = URL.createObjectURL(blob);
          img.onload = function () {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            updateFpsDisplay(fps);
          };
          img.src = url;
        }
        return;
      }

      if (format === 2 || format === 3) {
        if (buf.length < 8 + 8) return;
        const dv = new DataView(buf.buffer, 8);
        let pos = 0;
        const width = dv.getUint16(pos, true);
        pos += 2;
        const height = dv.getUint16(pos, true);
        pos += 2;
        const blockCount = dv.getUint16(pos, true);
        pos += 2;
        pos += 2;

        if (
          width > 0 &&
          height > 0 &&
          (canvas.width !== width || canvas.height !== height)
        ) {
          canvas.width = width;
          canvas.height = height;
        }
        for (let i = 0; i < blockCount; i++) {
          if (pos + 12 > dv.byteLength) break;
          const x = dv.getUint16(pos, true);
          pos += 2;
          const y = dv.getUint16(pos, true);
          pos += 2;
          const w = dv.getUint16(pos, true);
          pos += 2;
          const h = dv.getUint16(pos, true);
          pos += 2;
          const len = dv.getUint32(pos, true);
          pos += 4;
          const start = 8 + pos;
          const end = start + len;
          if (end > buf.length) break;
          const slice = buf.subarray(start, end);
          pos += len;
          if (format === 2) {
            try {
              const bitmap = await createImageBitmap(
                new Blob([slice], { type: "image/jpeg" }),
              );
              ctx.drawImage(bitmap, x, y, w, h);
              bitmap.close();
            } catch {}
          } else {
            if (slice.length === w * h * 4) {
              const imgData = new ImageData(new Uint8ClampedArray(slice), w, h);
              ctx.putImageData(imgData, x, y);
            }
          }
        }
        updateFpsDisplay(fps);
        return;
      }

      return;
    }

    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "status" && msg.status) {
      }
    } catch (e) {}
  });

  ws.addEventListener("open", function () {
    if (qualitySlider) {
      pushQuality(qualitySlider.value);
    }
    fetchClientInfo().then(() => {
      if (displaySelect && displaySelect.value) {
        console.debug("rd: initial select display", displaySelect.value);
        sendCmd("desktop_select_display", {
          display: parseInt(displaySelect.value, 10),
        });
      }
    });
  });

  canvas.addEventListener("mousemove", function (e) {
    if (!mouseCtrl.checked) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    );
    ws.send(JSON.stringify({ type: "mouse_move", x, y }));
  });
  canvas.addEventListener("mousedown", function (e) {
    if (!mouseCtrl.checked) return;
    ws.send(JSON.stringify({ type: "mouse_down", button: e.button }));
    e.preventDefault();
  });
  canvas.addEventListener("mouseup", function (e) {
    if (!mouseCtrl.checked) return;
    ws.send(JSON.stringify({ type: "mouse_up", button: e.button }));
    e.preventDefault();
  });
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  canvas.setAttribute("tabindex", "0");
  canvas.addEventListener("keydown", function (e) {
    if (!kbdCtrl.checked) return;
    ws.send(JSON.stringify({ type: "key_down", key: e.key, code: e.code }));
    e.preventDefault();
  });
  canvas.addEventListener("keyup", function (e) {
    if (!kbdCtrl.checked) return;
    ws.send(JSON.stringify({ type: "key_up", key: e.key, code: e.code }));
    e.preventDefault();
  });

  fetchClientInfo();
})();
