import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const SERVER_ENTRY = fileURLToPath(new URL("../../index.js", import.meta.url));
const JWT_SECRET = "integration-test-secret-0123456789abcdef";

export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Starts the real server (server/index.js) as a child process inside a
// throwaway working directory, so its users/messages/uploads files, rate
// limiters and any crash are isolated from every other test.
export async function startServer({ seed = {}, files = {} } = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-integration-"));
  fs.mkdirSync(path.join(dir, "server"));
  fs.mkdirSync(path.join(dir, "uploads"));
  for (const [name, content] of Object.entries(seed)) {
    fs.writeFileSync(path.join(dir, "server", name), JSON.stringify(content));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), JWT_SECRET, CLIENT_ORIGIN: "http://localhost:5173" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout.on("data", (chunk) => (output += chunk));
  proc.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => proc.once("exit", (code) => resolve(code)));

  const started = Date.now();
  while (!output.includes("listening")) {
    if (proc.exitCode !== null) throw new Error(`server exited during startup:\n${output}`);
    if (Date.now() - started > 15000) throw new Error(`server did not start in time:\n${output}`);
    await sleep(25);
  }

  return {
    port,
    dir,
    url: `http://localhost:${port}`,
    isAlive: () => proc.exitCode === null,
    logs: () => output,
    path: (...parts) => path.join(dir, ...parts),
    async stop() {
      proc.kill();
      await exited;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postJson(server, route, body) {
  const response = await fetch(server.url + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

export async function register(server, username, password = "password123") {
  const { status, json } = await postJson(server, "/auth/register", { username, password });
  if (status !== 200) throw new Error(`register ${username} failed with ${status}: ${JSON.stringify(json)}`);
  return json.token;
}

export async function uploadImage(server, token) {
  const form = new FormData();
  form.append("image", new Blob([PNG_BYTES], { type: "image/png" }), "pic.png");
  const response = await fetch(server.url + "/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (response.status !== 200) throw new Error(`upload failed with ${response.status}`);
  const { imageUrl } = await response.json();
  return { imageUrl, fileName: imageUrl.split("/").pop() };
}

export function connectClient(server, token) {
  return new Promise((resolve, reject) => {
    const socket = io(server.url, { auth: { token }, reconnection: false, transports: ["websocket"] });
    const events = [];
    socket.onAny((event, ...args) => events.push({ event, args }));
    socket.once("connect", () => resolve({ socket, events, close: () => socket.close() }));
    socket.once("connect_error", reject);
  });
}

export const eventsOf = (client, name) => client.events.filter((e) => e.event === name).map((e) => e.args[0]);

export async function waitFor(check, { timeout = 4000, interval = 25 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error("waitFor timed out");
    await sleep(interval);
  }
}
