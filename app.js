const $ = (id) => document.getElementById(id);
const statusText = $("status");
const dot = $("dot");
const roomInput = $("room");
const roomPanel = $("roomPanel");
const roomCode = $("roomCode");
const roomInfo = $("roomInfo");
const deviceCount = $("deviceCount");
const messages = $("messages");
const emptyState = $("emptyState");
const messageInput = $("message");
const sendButton = $("sendButton");
const toast = $("toast");

let socket = null;
let joined = false;
let activeRoom = "";
let reconnectTimer = null;
let reconnectDelay = 1000;
let manuallyClosed = false;
let toastTimer = null;
let deviceId = "";

function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function setConnectionState(online, label) {
  statusText.textContent = label;
  dot.classList.toggle("online", online);
}

function setJoined(value) {
  joined = value;
  messageInput.disabled = !value;
  sendButton.disabled = !value;
  messageInput.placeholder = value ? "Write a message…" : "Connect to a room to send a message";
}

function showRoom(code) {
  activeRoom = code;
  roomCode.textContent = code;
  roomInput.value = code;
  roomPanel.hidden = false;
}

function addMessage(data) {
  emptyState.hidden = true;
  const item = document.createElement("li");
  item.className = "message" + (data.from === deviceId ? " mine" : "");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const sender = document.createElement("span");
  sender.textContent = data.from === deviceId ? "You" : "Connected device";
  const time = document.createElement("time");
  const date = data.sentAt ? new Date(data.sentAt) : new Date();
  time.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  meta.append(sender, time);
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = data.text;
  item.append(meta, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

window.cdcSend = (payload) => send(payload);
window.cdcIsJoined = () => joined;

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    notify("Reconnecting to the server. Try again in a moment.");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function connect() {
  if (manuallyClosed) return;
  const nativeApp = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const socketUrl = nativeApp
    ? "wss://cross-device-connect.onrender.com"
    : (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;

  try {
    const nextSocket = new WebSocket(socketUrl);
    socket = nextSocket;
    setConnectionState(false, "Connecting");

    nextSocket.addEventListener("open", () => {
      if (socket !== nextSocket) return;
      reconnectDelay = 1000;
      setConnectionState(true, "Connected");
      if (activeRoom) send({ type: "join", room: activeRoom });
    });

    nextSocket.addEventListener("message", (event) => {
      if (socket !== nextSocket) return;
      let data;
      try { data = JSON.parse(event.data); }
      catch { return; }

      if (data.type === "connected") {
        deviceId = data.deviceId || "";
      } else if (data.type === "room_created") {
        showRoom(data.room);
        notify("Your room is ready. Share the code with your other device.");
      } else if (data.type === "joined") {
        setJoined(true);
        showRoom(data.room);
        roomInfo.textContent = data.count > 1 ? "Your other device is connected." : "Room ready — waiting for another device…";
        deviceCount.textContent = data.count + (data.count === 1 ? " device" : " devices");
      } else if (data.type === "devices") {
        deviceCount.textContent = data.count + (data.count === 1 ? " device" : " devices");
        roomInfo.textContent = data.count > 1 ? "Connected — both devices are in this room." : "Waiting for another device…";
      } else if (["call_offer", "call_answer", "ice_candidate", "call_end"].includes(data.type)) {\n        window.dispatchEvent(new CustomEvent("cdc-call-signal", { detail: data }));\n      } else if (data.type === "message") {
        addMessage(data);
      } else if (data.type === "left") {
        setJoined(false);
      } else if (data.type === "error") {
        notify(data.message || "Something went wrong.");
      }
    });

    nextSocket.addEventListener("close", () => {
      if (socket !== nextSocket) return;
      setJoined(false);
      setConnectionState(false, "Reconnecting");
      if (activeRoom) roomInfo.textContent = "Connection lost — reconnecting…";
      scheduleReconnect();
    });

    nextSocket.addEventListener("error", () => {
      if (socket === nextSocket) setConnectionState(false, "Connection issue");
    });
  } catch {
    setConnectionState(false, "Connection issue");
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer || manuallyClosed) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

$("createRoom").addEventListener("click", () => {
  if (!send({ type: "create_room" })) return;
  setJoined(false);
  messages.replaceChildren();
  emptyState.hidden = false;
  roomInfo.textContent = "Creating a secure random room code…";
});

$("joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = roomInput.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    notify("Enter the 8-character code from your other device.");
    return;
  }
  setJoined(false);
  if (send({ type: "join", room: code })) {
    roomInfo.textContent = "Joining room…";
    roomPanel.hidden = false;
    roomCode.textContent = code;
  }
});

$("copyCode").addEventListener("click", async () => {
  if (!activeRoom) return;
  try {
    await navigator.clipboard.writeText(activeRoom);
    notify("Pairing code copied.");
  } catch {
    roomInput.focus();
    roomInput.select();
    notify("Select and copy the code.");
  }
});

$("shareCode").addEventListener("click", async () => {
  if (!activeRoom) return;
  const shareData = { title: "Cross-device Connect", text: "Join my room with this pairing code: " + activeRoom, url: location.href };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (error) { if (error.name !== "AbortError") notify("Sharing is unavailable on this device."); }
  } else {
    try {
      await navigator.clipboard.writeText(shareData.text + " — " + shareData.url);
      notify("Pairing details copied.");
    } catch { notify("Use the Copy code button to share the code."); }
  }
});

$("messageForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !joined) return;
  if (send({ type: "message", text })) messageInput.value = "";
});

window.addEventListener("online", () => {
  if (!socket || socket.readyState !== WebSocket.OPEN) connect();
});
window.addEventListener("beforeunload", () => {
  manuallyClosed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) socket.close();
});

connect();
