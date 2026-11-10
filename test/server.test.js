const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const WebSocket = require("ws");

let serverProcess;
let baseUrl;
let port;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function waitForHttp(url, attempts = 40) {
  return new Promise((resolve, reject) => {
    const retry = (remaining) => {
      if (remaining <= 0) return reject(new Error("Server did not become ready."));
      setTimeout(() => check(remaining - 1), 150);
    };
    const check = (remaining) => {
      http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry(remaining);
      }).on("error", () => retry(remaining));
    };
    check(attempts);
  });
}

function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitFor(ws, predicate, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message."));
    }, timeout);
    function onMessage(raw) {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(data)) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(data);
    }
    ws.on("message", onMessage);
  });
}

before(async () => {
  port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore"
  });
  await waitForHttp(baseUrl + "/health");
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});

test("health endpoint reports a live service", async () => {
  const response = await fetch(baseUrl + "/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
});

test("two devices can pair and exchange a live message", async () => {
  const first = await connectClient();
  const second = await connectClient();
  try {
    const createdPromise = waitFor(first, (data) => data.type === "room_created");
    first.send(JSON.stringify({ type: "create_room" }));
    const created = await createdPromise;
    assert.match(created.room, /^[A-HJ-NP-Z2-9]{8}$/);

    const joinedPromise = waitFor(second, (data) => data.type === "joined");
    second.send(JSON.stringify({ type: "join", room: created.room }));
    const joined = await joinedPromise;
    assert.equal(joined.room, created.room);
    assert.equal(joined.count, 2);

    const firstMessage = waitFor(first, (data) => data.type === "message");
    const secondMessage = waitFor(second, (data) => data.type === "message");
    second.send(JSON.stringify({ type: "message", text: "Hello from device two" }));
    const [receivedByFirst, receivedBySecond] = await Promise.all([firstMessage, secondMessage]);
    assert.equal(receivedByFirst.text, "Hello from device two");
    assert.equal(receivedBySecond.text, "Hello from device two");
    assert.equal(receivedByFirst.id, receivedBySecond.id);
  } finally {
    first.close();
    second.close();
  }
});
