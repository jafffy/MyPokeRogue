const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const puppeteer = require("puppeteer");
const sharp = require("sharp");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CONFIG = {
  port: parseInt(process.env.PORT, 10) || 3000,
  gameUrl: process.env.GAME_URL || "https://pokerogue.net",
  viewport: { width: 1920, height: 1080 },
  // Capture settings
  captureInterval: parseInt(process.env.CAPTURE_INTERVAL, 10) || 100, // ms
  jpegQuality: parseInt(process.env.JPEG_QUALITY, 10) || 60,
  // Delta detection
  deltaEnabled: process.env.DELTA_ENABLED !== "false",
  // Resize for bandwidth savings (client upscales)
  streamWidth: parseInt(process.env.STREAM_WIDTH, 10) || 480,
  streamHeight: parseInt(process.env.STREAM_HEIGHT, 10) || 270,
};

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let browser = null;
let page = null;
let previousFrame = null;
let frameSeq = 0;
const clients = new Set();

// ---------------------------------------------------------------------------
// Puppeteer – headless game instance
// ---------------------------------------------------------------------------
async function launchGame() {
  console.log("[server] Launching headless browser...");
  browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-extensions",
      "--window-size=1920,1080",
    ],
  });

  page = await browser.newPage();
  await page.setViewport(CONFIG.viewport);

  // Suppress dialog popups
  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
  });

  console.log(`[server] Navigating to ${CONFIG.gameUrl}...`);
  await page.goto(CONFIG.gameUrl, { waitUntil: "networkidle2", timeout: 60000 });
  console.log("[server] Game loaded.");
}

// ---------------------------------------------------------------------------
// Frame capture & delta compression
// ---------------------------------------------------------------------------
async function captureFrame() {
  if (!page || clients.size === 0) return;

  try {
    const rawBuffer = await page.screenshot({
      type: "png",
      fullPage: false,
      optimizeForSpeed: true,
    });

    // Resize + compress to JPEG for streaming
    const compressed = await sharp(rawBuffer)
      .resize(CONFIG.streamWidth, CONFIG.streamHeight, { fit: "fill" })
      .jpeg({ quality: CONFIG.jpegQuality, mozjpeg: true })
      .toBuffer();

    frameSeq++;

    // Build frame message
    const header = Buffer.alloc(8);
    header.writeUInt32BE(frameSeq, 0);
    header.writeUInt32BE(compressed.length, 4);

    const message = Buffer.concat([header, compressed]);

    // Broadcast to all connected clients
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.send(message, { binary: true });
      }
    }
  } catch (err) {
    if (!err.message.includes("Target closed")) {
      console.error("[server] Capture error:", err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Input injection – translate client events into Puppeteer actions
// ---------------------------------------------------------------------------
const KEY_MAP = {
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  z: "z", x: "x", c: "c", v: "v",
  Enter: "Enter",
  Backspace: "Backspace",
  Shift: "Shift",
  " ": " ",
  // PokeRogue specific mappings
  a: "z",    // Action → z
  b: "x",    // Back → x
  s: "c",    // Menu → c
  d: "v",    // Stats → v
};

async function handleInput(msg) {
  if (!page) return;

  try {
    const data = JSON.parse(msg);

    switch (data.type) {
      case "keydown": {
        const key = KEY_MAP[data.key] || data.key;
        await page.keyboard.down(key);
        break;
      }
      case "keyup": {
        const key = KEY_MAP[data.key] || data.key;
        await page.keyboard.up(key);
        break;
      }
      case "tap": {
        // Touch input — click at relative coordinates
        const x = Math.round(data.x * CONFIG.viewport.width);
        const y = Math.round(data.y * CONFIG.viewport.height);
        await page.mouse.click(x, y);
        break;
      }
      case "swipe": {
        // Map swipe directions to arrow keys
        const swipeMap = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
        const key = swipeMap[data.direction];
        if (key) {
          await page.keyboard.press(key);
        }
        break;
      }
    }
  } catch (err) {
    console.error("[server] Input error:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Express – serves client files & health check
// ---------------------------------------------------------------------------
const app = express();

app.use(express.static(path.join(__dirname, "..", "client")));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    clients: clients.size,
    frameSeq,
    config: {
      streamWidth: CONFIG.streamWidth,
      streamHeight: CONFIG.streamHeight,
      captureInterval: CONFIG.captureInterval,
      jpegQuality: CONFIG.jpegQuality,
    },
  });
});

// ---------------------------------------------------------------------------
// WebSocket – client connections
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`[server] Client connected: ${clientIp} (total: ${clients.size + 1})`);
  clients.add(ws);

  // Send initial config to client
  ws.send(JSON.stringify({
    type: "config",
    streamWidth: CONFIG.streamWidth,
    streamHeight: CONFIG.streamHeight,
    gameWidth: CONFIG.viewport.width,
    gameHeight: CONFIG.viewport.height,
  }));

  ws.on("message", (msg) => {
    // Text messages = input commands
    if (typeof msg === "string" || msg instanceof Buffer) {
      handleInput(msg.toString());
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[server] Client disconnected (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[server] WebSocket error:", err.message);
    clients.delete(ws);
  });
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await launchGame();

  // Start frame capture loop
  setInterval(captureFrame, CONFIG.captureInterval);

  server.listen(CONFIG.port, "0.0.0.0", () => {
    console.log(`[server] Streaming server running on http://0.0.0.0:${CONFIG.port}`);
    console.log(`[server] WebSocket endpoint: ws://0.0.0.0:${CONFIG.port}/ws`);
    console.log(`[server] Frame rate: ${Math.round(1000 / CONFIG.captureInterval)} FPS`);
    console.log(`[server] Stream resolution: ${CONFIG.streamWidth}x${CONFIG.streamHeight}`);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log("[server] Shutting down...");
  for (const ws of clients) ws.close();
  if (browser) await browser.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[server] Fatal error:", err);
  process.exit(1);
});
