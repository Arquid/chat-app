// @vitest-environment node
//
// Starts the real server (server/index.js) as a child process and checks what
// it tells the outside world: response headers, error bodies, and where it keeps
// its files. NODE_ENV is "development" on purpose: the error handling must not
// depend on NODE_ENV=production to avoid leaking stack traces.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PNG_BYTES, connectClient, eventsOf, register, startServer, uploadImage, waitFor } from "./helpers/serverProcess.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });

const ENV = { NODE_ENV: "development" };

const postRaw = (server, route, body, headers = { "Content-Type": "application/json" }) =>
  fetch(server.url + route, { method: "POST", headers, body });

const postJson = (server, route, body) => postRaw(server, route, JSON.stringify(body));

// Words that only appear when internals leak: parser messages, stack frames, file paths.
const LEAKS = [/SyntaxError/, /Unexpected token/, /\bat .*\(.*:\d+:\d+\)/, /node_modules/, /ENOENT|EISDIR|EPERM/, /[A-Za-z]:[\\/]/, /\/tmp\//];
const expectNoLeak = (text) => {
  for (const pattern of LEAKS) expect(text).not.toMatch(pattern);
};

describe("response headers", () => {
  let server;
  let token;
  let fileName;

  beforeAll(async () => {
    server = await startServer({ env: ENV });
    token = await register(server, "alice");
    ({ fileName } = await uploadImage(server, token));
  });

  afterAll(() => server.stop());

  const responses = () => ({
    "an API success": () => postJson(server, "/auth/login", { username: "alice", password: "password123" }),
    "an API validation error": () => postJson(server, "/auth/login", { username: 1 }),
    "an unknown route": () => fetch(server.url + "/nope"),
    "an uploaded image": () => fetch(`${server.url}/uploads/${fileName}`),
    "a rejected upload": () => fetch(server.url + "/upload", { method: "POST" }),
  });

  it.each(Object.keys(responses()))("does not announce the framework on %s", async (name) => {
    const response = await responses()[name]();
    expect(response.headers.has("x-powered-by")).toBe(false);
  });

  it.each(Object.keys(responses()))("sets X-Content-Type-Options: nosniff on %s", async (name) => {
    const response = await responses()[name]();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sends a Content-Security-Policy that blocks everything by default", async () => {
    const response = await postJson(server, "/auth/login", { username: 1 });
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("still lets another origin (the Vite client) display uploaded images", async () => {
    // helmet's default Cross-Origin-Resource-Policy is same-origin, which makes
    // browsers refuse <img src="http://localhost:5000/uploads/..."> on the client
    // page at :5173, so every chat image would silently break.
    const response = await fetch(`${server.url}/uploads/${fileName}`, { headers: { Origin: "http://localhost:5173" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("keeps CORS limited to the configured client origin", async () => {
    const response = await fetch(`${server.url}/uploads/${fileName}`, { headers: { Origin: "http://evil.example" } });
    expect(response.headers.get("access-control-allow-origin")).not.toBe("http://evil.example");
  });
});

describe("error responses for bad requests", () => {
  let server;

  beforeAll(async () => {
    server = await startServer({ env: ENV });
    await register(server, "alice");
  });

  afterAll(() => server.stop());

  it.each([
    ["/auth/login", "{ not json"],
    ["/auth/register", "{ not json"],
    ["/auth/login", "[1, 2"],
    ["/auth/register", "null"],
    ["/auth/login", '"just a string"'],
  ])("answers broken JSON sent to %s (%s) with a short 400, not a stack trace", async (route, body) => {
    const response = await postRaw(server, route, body);
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(text)).toEqual({ error: "Invalid JSON" });
    expectNoLeak(text);
    expect(text).not.toContain("<html");
  });

  it("answers an oversized body with 413 and no internals", async () => {
    const response = await postJson(server, "/auth/login", { username: "a".repeat(300_000), password: "x" });
    const text = await response.text();

    expect(response.status).toBe(413);
    expect(JSON.parse(text)).toEqual({ error: "Request body too large" });
    expectNoLeak(text);
  });

  it.each([
    ["GET", "/nope"],
    ["POST", "/nope"],
    ["GET", "/auth/login"],
    ["GET", "/server/users.json"],
    ["GET", "/uploads/does-not-exist.png"],
  ])("answers %s %s with a JSON 404 instead of Express's HTML page", async (method, route) => {
    const response = await fetch(server.url + route, { method });
    const text = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(text)).toEqual({ error: "Not found" });
    expect(text).not.toMatch(/Cannot (GET|POST)/);
  });

  it("does not parse a body sent with an unsupported charset as a server failure", async () => {
    const response = await postRaw(server, "/auth/login", '{"username":"alice"}', {
      "Content-Type": "application/json; charset=utf-7",
    });
    const text = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expectNoLeak(text);
  });

  it("keeps the expected errors exactly as before", async () => {
    const bad = await postJson(server, "/auth/register", { username: "x", password: "password123" });
    expect(bad.status).toBe(400);

    const taken = await postJson(server, "/auth/register", { username: "ALICE", password: "password123" });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "Username already taken" });

    const wrong = await postJson(server, "/auth/login", { username: "alice", password: "wrong-password" });
    const unknown = await postJson(server, "/auth/login", { username: "nobody", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Invalid username or password" });
    expect(await unknown.json()).toEqual({ error: "Invalid username or password" });

    const noToken = await fetch(server.url + "/upload", { method: "POST" });
    expect(noToken.status).toBe(401);
  });

  it("keeps answering uploads of the wrong type with a 400", async () => {
    const token = await register(server, "bob");
    const form = new FormData();
    form.append("image", new Blob(["<html></html>"], { type: "text/html" }), "page.html");
    const response = await fetch(server.url + "/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    expect(response.status).toBe(400);
  });

  it("does not log the expected errors as failures", async () => {
    expect(server.logs()).not.toMatch(/failed:/);
  });
});

describe("unexpected failures are logged, not shown", () => {
  let server;
  let usersFile;

  beforeAll(async () => {
    server = await startServer({ env: ENV });
    usersFile = server.path("server", "users.json");
    await register(server, "alice");
  });

  afterAll(() => server.stop());

  it("answers a damaged users.json with a generic 500 for registration and login", async () => {
    const good = fs.readFileSync(usersFile, "utf-8");
    fs.writeFileSync(usersFile, "{ this is not json");

    try {
      const register = await postJson(server, "/auth/register", { username: "carol", password: "password123" });
      const login = await postJson(server, "/auth/login", { username: "alice", password: "password123" });

      for (const response of [register, login]) {
        const text = await response.text();
        expect(response.status).toBe(500); // not 409 (taken) or 401 (wrong password)
        expect(JSON.parse(text)).toEqual({ error: "Internal server error" });
        expectNoLeak(text);
        expect(text).not.toContain(server.dir);
      }
    } finally {
      fs.writeFileSync(usersFile, good);
    }
  });

  it("writes the details to the server log instead", async () => {
    const logs = await waitFor(() => (server.logs().includes("failed:") ? server.logs() : null));
    expect(logs).toContain("POST /auth/register failed:");
    expect(logs).toContain("POST /auth/login failed:");
    expect(logs).toMatch(/SyntaxError/);
  });

  it("keeps running and recovers once the file is valid again", async () => {
    expect(server.isAlive()).toBe(true);
    const login = await postJson(server, "/auth/login", { username: "alice", password: "password123" });
    expect(login.status).toBe(200);
  });

  it("does not turn a failing user store into the 'wrong password' answer", async () => {
    // users.json replaced by a directory: reading it fails with EISDIR.
    const good = fs.readFileSync(usersFile, "utf-8");
    fs.rmSync(usersFile);
    fs.mkdirSync(usersFile);

    try {
      const response = await postJson(server, "/auth/login", { username: "alice", password: "password123" });
      const text = await response.text();
      expect(response.status).toBe(500);
      expectNoLeak(text);
    } finally {
      fs.rmSync(usersFile, { recursive: true });
      fs.writeFileSync(usersFile, good);
    }
    expect(server.isAlive()).toBe(true);
  });
});

describe("files live in DATA_DIR, not in the working directory", () => {
  let server;

  beforeAll(async () => {
    // startServer runs the process from a separate, empty working directory (server.cwd).
    server = await startServer({ env: ENV });
  });

  afterAll(() => server.stop());

  it("saves accounts, uploads and the registry in DATA_DIR", async () => {
    const token = await register(server, "alice");
    const { fileName } = await uploadImage(server, token);

    expect(fs.existsSync(server.path("server", "users.json"))).toBe(true);
    expect(fs.existsSync(server.path("server", "uploads.json"))).toBe(true);
    expect(fs.existsSync(server.path("uploads", fileName))).toBe(true);
  });

  it("serves the uploaded image from there too", async () => {
    // Regression: the static route used a path relative to the working directory,
    // so it answered 404 for every image once the server was started from elsewhere.
    const token = await register(server, "bob");
    const { imageUrl } = await uploadImage(server, token);

    const response = await fetch(server.url + imageUrl);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
  });

  it("removes the image file from DATA_DIR when its message is deleted", async () => {
    const token = await register(server, "carol");
    const { imageUrl, fileName } = await uploadImage(server, token);
    const client = await connectClient(server, token);

    try {
      client.socket.emit("sendMessage", { text: "with picture", image: imageUrl });
      const message = await waitFor(() => eventsOf(client, "receiveMessage").find((m) => m.text === "with picture"));
      expect(fs.existsSync(server.path("uploads", fileName))).toBe(true);

      client.socket.emit("deleteMessage", { id: message.id });
      await waitFor(() => !fs.existsSync(server.path("uploads", fileName)));
    } finally {
      client.close();
    }
  });

  it("writes nothing into the directory it was started from", () => {
    expect(fs.readdirSync(server.cwd)).toEqual([]);
  });
});
