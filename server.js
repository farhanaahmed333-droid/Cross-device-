const express = require("express");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });
const rooms = new Map();
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_LENGTH = 8;
const ROOM_IDLE_MS = 10 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 4000;
const MESSAGE_WINDOW_MS = 60 * 1000;
const MESSAGE_LIMIT = 40;

app.disable("x-powered-by");
app.use(express.static(__dirname, { extensions: ["html"] }));
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "cross-device-connect", rooms: rooms.size });
});

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function makeRoomCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(ROOM_LENGTH), (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  return rooms.get(code);
}

function broadcast(room, payload) {
  const entry = getRoom(room);
  if (!entry) return;
  for (const client of entry.clients) send(client, payload);
}

function updateDeviceCount(room) {
  const entry = getRoom(room);
  if (!entry) return;
  broadcast(room, { type: "devices", count: entry.clients.size });
}

function removeClient(ws) {
  const code = ws.room;
  if (!code) return;
  ws.room = null;
  const entry = getRoom(code);
  if (!entry) return;
  entry.clients.delete(ws);
  updateDeviceCount(code);
  if (entry.clients.size === 0) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = setTimeout(() => {
      const current = getRoom(code);
      if (current && current.clients.size === 0) rooms.delete(code);
    }, ROOM_IDLE_MS);
    entry.cleanupTimer.unref?.();
  }
}

function joinRoom(ws, code) {
  const room = String(code || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(room)) {
    send(ws, { type: "error", message: "Enter a valid 8-character pairing code." });
    return;
  }
  const entry = getRoom(room);
  if (!entry) {
    send(ws, { type: "error", message: "That pairing code was not found. Create a new room on the first device." });
    return;
  }
  if (entry.clients.has(ws)) {
    send(ws, { type: "joined", room, count: entry.clients.size });
    return;
  }
  removeClient(ws);
  clearTimeout(entry.cleanupTimer);
  ws.room = room;
  entry.clients.add(ws);
  send(ws, { type: "joined", room, count: entry.clients.size });
  updateDeviceCount(room);
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.deviceId = crypto.randomUUID().slice(0, 8);
  ws.messageWindowStart = Date.now();
  ws.messageCount = 0;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  send(ws, { type: "connected", deviceId: ws.deviceId });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "The message could not be read." });
      return;
    }
    if (!data || typeof data !== "object") return;

    if (data.type === "create_room") {
      removeClient(ws);
      const code = makeRoomCode();
      rooms.set(code, { clients: new Set(), cleanupTimer: null, createdAt: Date.now() });
      joinRoom(ws, code);
      send(ws, { type: "room_created", room: code });
      return;
    }

    if (data.type === "join") {
      joinRoom(ws, data.room);
      return;
    }

    if (data.type === "leave") {
      removeClient(ws);
      send(ws, { type: "left" });
      return;
    }

    if (data.type === "message") {
      if (!ws.room) {
        send(ws, { type: "error", message: "Connect to a room before sending a message." });
        return;
      }
      const now = Date.now();
      if (now - ws.messageWindowStart >= MESSAGE_WINDOW_MS) {
        ws.messageWindowStart = now;
        ws.messageCount = 0;
      }
      if (++ws.messageCount > MESSAGE_LIMIT) {
        send(ws, { type: "error", message: "You're sending messages too quickly. Please wait a moment." });
        return;
      }
      const text = typeof data.text === "string" ? data.text.trim().slice(0, MAX_MESSAGE_LENGTH) : "";
      if (!text) return;
      broadcast(ws.room, {
        type: "message",
        id: crypto.randomUUID(),
        from: ws.deviceId,
        text,
        sentAt: new Date().toISOString()
      });
    }
  });

  ws.on("close", () => removeClient(ws));
  ws.on("error", () => removeClient(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref?.();

wss.on("close", () => clearInterval(heartbeat));

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log("Cross-device Connect listening on port " + port);
});
