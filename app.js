const statusText = document.getElementById("status");
const dot = document.getElementById("dot");
const roomInfo = document.getElementById("roomInfo");
const log = document.getElementById("log");
const joinForm = document.getElementById("joinForm");
const messageForm = document.getElementById("messageForm");
const roomInput = document.getElementById("room");
const messageInput = document.getElementById("message");

let socket = null;
let joined = false;
let activeRoom = "";
let reconnectTimer = null;
let manuallyClosed = false;

function addLog(text) {
  const li = document.createElement("li");
  li.textContent = text;
  log.prepend(li);
}

function setConnectionState(online, text) {
  statusText.textContent = text;
  dot.classList.toggle("online", online);
}

function joinRoom(room, announce = true) {
  const normalized = String(room || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,20}$/.test(normalized)) {
    addLog("Room code must be 4–20 letters, numbers, or hyphens.");
    return;
  }
  activeRoom = normalized;
  roomInput.value = normalized;
  joined = false;
  roomInfo.textContent = "Joining room…";
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "join", room: normalized }));
    if (announce) addLog(`Joining room ${normalized}`);
  } else if (announce) {
    addLog("Not connected yet. The room will be joined after reconnect.");
  }
}

function connect() {
  if (manuallyClosed) return;
  const nativeApp = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const socketUrl = nativeApp
    ? "wss://cross-device-connect.onrender.com"
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const nextSocket = new WebSocket(socketUrl);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) return;
    setConnectionState(true, "Connected to server");
    addLog("Connected to server.");
    joinRoom(activeRoom || roomInput.value, false);
  });

  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) return;
    joined = false;
    setConnectionState(false, "Disconnected — reconnecting in 2 seconds");
    roomInfo.textContent = activeRoom
      ? `Reconnecting to room ${activeRoom}…`
      : "Not in a room yet.";
    if (!reconnectTimer && !manuallyClosed) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    }
  });

  nextSocket.addEventListener("error", () => {
    if (socket !== nextSocket) return;
    setConnectionState(false, "Connection error — retrying");
  });

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      addLog("Received an unreadable server response.");
      return;
    }

    if (data.type === "connected") {
      addLog(`Device connected (${data.deviceId}).`);
    } else if (data.type === "joined") {
      joined = true;
      activeRoom = data.room;
      roomInfo.textContent = `Room ${data.room} · ${data.count} device(s) connected`;
      addLog(`Joined room ${data.room}.`);
    } else if (data.type === "devices") {
      roomInfo.textContent = `${data.count} device(s) connected in room ${activeRoom}`;
    } else if (data.type === "message") {
      addLog(`${data.from}: ${data.text}`);
    } else if (data.type === "error") {
      addLog(`Error: ${data.message}`);
    }
  });
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinRoom(roomInput.value);
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  if (!joined) {
    addLog("Join a room before sending messages.");
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addLog("Connection lost; reconnecting. Your message was not sent.");
    return;
  }
  socket.send(JSON.stringify({ type: "message", text }));
  messageInput.value = "";
});

window.addEventListener("beforeunload", () => {
  manuallyClosed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) socket.close();
});

connect();
