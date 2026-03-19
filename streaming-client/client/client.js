// ---------------------------------------------------------------------------
// PokéRogue Streaming Client
// Receives compressed frames via WebSocket and renders on canvas.
// Sends keyboard/touch input back to the server.
// ---------------------------------------------------------------------------

(function () {
  "use strict";

  // DOM elements
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const statusText = document.getElementById("status-text");
  const statFps = document.getElementById("stat-fps");
  const statLatency = document.getElementById("stat-latency");
  const statBandwidth = document.getElementById("stat-bandwidth");

  // State
  let ws = null;
  let config = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT = 16000;

  // Stats tracking
  let frameCount = 0;
  let bytesReceived = 0;
  let lastStatsTime = performance.now();
  let lastFrameTime = 0;

  // -------------------------------------------------------------------------
  // WebSocket connection
  // -------------------------------------------------------------------------
  function getWsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  function connect() {
    statusText.textContent = "Connecting...";
    overlay.classList.remove("hidden");

    ws = new WebSocket(getWsUrl());
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.log("[client] Connected");
      statusText.textContent = "Connected, waiting for frames...";
      reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // JSON config message
        const msg = JSON.parse(event.data);
        if (msg.type === "config") {
          config = msg;
          canvas.width = msg.streamWidth;
          canvas.height = msg.streamHeight;
          console.log(`[client] Config: ${msg.streamWidth}x${msg.streamHeight}`);
        }
        return;
      }

      // Binary frame data: [seq(4) | size(4) | jpeg_data]
      const view = new DataView(event.data);
      const _seq = view.getUint32(0);
      const _size = view.getUint32(4);
      const jpegData = new Uint8Array(event.data, 8);

      bytesReceived += event.data.byteLength;
      frameCount++;
      lastFrameTime = performance.now();

      // Hide overlay on first frame
      if (frameCount === 1) {
        overlay.classList.add("hidden");
      }

      // Decode and render JPEG frame
      renderFrame(jpegData);
    };

    ws.onclose = () => {
      console.log("[client] Disconnected");
      statusText.textContent = `Reconnecting in ${reconnectDelay / 1000}s...`;
      overlay.classList.remove("hidden");
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT);
    };

    ws.onerror = (err) => {
      console.error("[client] WebSocket error:", err);
    };
  }

  // -------------------------------------------------------------------------
  // Frame rendering
  // -------------------------------------------------------------------------
  const frameImage = new Image();
  let pendingBlob = null;

  function renderFrame(jpegData) {
    // Revoke previous blob URL to avoid memory leak
    if (pendingBlob) {
      URL.revokeObjectURL(pendingBlob);
    }

    const blob = new Blob([jpegData], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    pendingBlob = url;

    frameImage.onload = () => {
      ctx.drawImage(frameImage, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      if (pendingBlob === url) pendingBlob = null;
    };
    frameImage.src = url;
  }

  // -------------------------------------------------------------------------
  // Input handling – Keyboard
  // -------------------------------------------------------------------------
  const TRACKED_KEYS = new Set([
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "z", "x", "c", "v",
    "Enter", "Backspace", "Shift", " ",
  ]);

  const pressedKeys = new Set();

  document.addEventListener("keydown", (e) => {
    if (!TRACKED_KEYS.has(e.key)) return;
    e.preventDefault();
    if (pressedKeys.has(e.key)) return; // skip repeat
    pressedKeys.add(e.key);
    sendInput({ type: "keydown", key: e.key });
  });

  document.addEventListener("keyup", (e) => {
    if (!TRACKED_KEYS.has(e.key)) return;
    e.preventDefault();
    pressedKeys.delete(e.key);
    sendInput({ type: "keyup", key: e.key });
  });

  // -------------------------------------------------------------------------
  // Input handling – Touch controls
  // -------------------------------------------------------------------------
  // D-pad buttons
  document.querySelectorAll(".dpad-btn").forEach((btn) => {
    const dirMap = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
    const key = dirMap[btn.dataset.dir];

    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      sendInput({ type: "keydown", key });
    }, { passive: false });

    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      sendInput({ type: "keyup", key });
    }, { passive: false });
  });

  // Action buttons
  document.querySelectorAll(".action-btn").forEach((btn) => {
    const key = btn.dataset.key;

    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      sendInput({ type: "keydown", key });
    }, { passive: false });

    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      sendInput({ type: "keyup", key });
    }, { passive: false });
  });

  // Canvas tap (direct touch on game area)
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    sendInput({ type: "tap", x, y });
  });

  // -------------------------------------------------------------------------
  // Input sending
  // -------------------------------------------------------------------------
  function sendInput(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // -------------------------------------------------------------------------
  // Stats display (update every second)
  // -------------------------------------------------------------------------
  setInterval(() => {
    const now = performance.now();
    const elapsed = (now - lastStatsTime) / 1000;

    const fps = Math.round(frameCount / elapsed);
    const kbps = Math.round(bytesReceived / 1024 / elapsed);
    const latency = lastFrameTime > 0 ? Math.round(now - lastFrameTime) : 0;

    statFps.textContent = `${fps} FPS`;
    statLatency.textContent = `${latency} ms`;
    statBandwidth.textContent = `${kbps} KB/s`;

    frameCount = 0;
    bytesReceived = 0;
    lastStatsTime = now;
  }, 1000);

  // -------------------------------------------------------------------------
  // Canvas resize
  // -------------------------------------------------------------------------
  function resizeCanvas() {
    const ratio = 16 / 9;
    const maxW = window.innerWidth;
    const maxH = window.innerHeight * (window.innerWidth <= 1024 ? 0.6 : 1);

    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }

    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------
  connect();
})();
