// @vitest-environment node
//
// These tests start the real server (server/index.js) as a child process and
// talk to it over HTTP and Socket.io. They cover the behaviours that unit tests
// cannot: the server staying up when a client misbehaves, and the rules that
// span several modules (uploads, messages, files on disk).
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectClient, eventsOf, register, sleep, startServer, uploadImage, waitFor } from "./helpers/serverProcess.js";

vi.setConfig({ testTimeout: 30000, hookTimeout: 60000 });

const delivered = (client) => eventsOf(client, "receiveMessage");

async function sendAndWait(sender, observer, payload) {
  sender.socket.emit("sendMessage", payload);
  return waitFor(() => delivered(observer).find((m) => m.text === payload.text));
}

describe("a misbehaving client cannot crash the server", () => {
  let server;
  let alice;
  let bob;
  const clients = [];

  const connect = async (token) => {
    const client = await connectClient(server, token);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    server = await startServer();
    const [aliceToken, bobToken] = [await register(server, "alice"), await register(server, "bob")];
    alice = { token: aliceToken };
    bob = await connect(bobToken);
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await server.stop();
  });

  it.each(["editMessage", "deleteMessage", "toggleReaction"])(
    "survives null, missing and primitive payloads for %s",
    async (event) => {
      const client = await connect(alice.token);
      client.socket.emit(event, null);
      client.socket.emit(event);
      client.socket.emit(event, "a string");
      client.socket.emit(event, 42);
      client.socket.emit(event, [1, 2]);
      await sleep(250);

      expect(server.isAlive()).toBe(true);
      const probe = await sendAndWait(client, bob, { text: `still alive after ${event}` });
      expect(probe.username).toBe("alice");
      expect(server.logs()).not.toMatch(/TypeError/);
    }
  );

  it.each(["toString", "valueOf"])(
    "handles the reaction %s as ordinary data, not an Object.prototype member",
    async (key) => {
      const client = await connect(alice.token);
      const message = await sendAndWait(client, bob, { text: `react target ${key}` });

      client.socket.emit("toggleReaction", { id: message.id, emoji: key });
      const added = await waitFor(() => eventsOf(client, "reactionUpdated").find((e) => e.id === message.id));
      expect(added.reactions).toEqual({ [key]: ["alice"] });

      client.socket.emit("toggleReaction", { id: message.id, emoji: key });
      await waitFor(() => eventsOf(client, "reactionUpdated").filter((e) => e.id === message.id).length === 2);
      const removed = eventsOf(client, "reactionUpdated").filter((e) => e.id === message.id)[1];
      expect(removed.reactions).toEqual({});

      expect(server.isAlive()).toBe(true);
      expect(server.logs()).not.toMatch(/TypeError/);
    }
  );

  it("ignores payloads with the wrong field types without crashing", async () => {
    const client = await connect(alice.token);
    const message = await sendAndWait(client, bob, { text: "wrong types target" });

    client.socket.emit("editMessage", { id: 123, text: "x" });
    client.socket.emit("editMessage", { id: message.id, text: { not: "a string" } });
    client.socket.emit("deleteMessage", { id: {} });
    client.socket.emit("toggleReaction", { id: "no-such-message", emoji: "👍" });
    await sleep(250);

    expect(server.isAlive()).toBe(true);
    // The target message must be untouched by any of the malformed requests.
    expect(eventsOf(bob, "messageEdited")).toEqual([]);
    expect(eventsOf(bob, "messageDeleted")).toEqual([]);
  });
});

describe("a message can only reference an upload its sender made", () => {
  let server;
  let aliceToken;
  let bobToken;
  let bob;
  const clients = [];

  const connect = async (token) => {
    const client = await connectClient(server, token);
    clients.push(client);
    return client;
  };
  const uploadedFile = (fileName) => server.path("uploads", fileName);

  beforeAll(async () => {
    server = await startServer();
    aliceToken = await register(server, "alice");
    bobToken = await register(server, "bob");
    bob = await connect(bobToken);
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await server.stop();
  });

  it("rejects image values that are not our own /uploads/<uuid> paths", async () => {
    const attacker = await connect(aliceToken);
    const bad = [
      "@127.0.0.1:9999/track.png",
      ".attacker.test/pixel.png",
      "http://evil.example/x.png",
      "/uploads/../server/users.json",
      "/uploads/x.png",
    ];
    bad.forEach((image, i) => attacker.socket.emit("sendMessage", { text: `bad image ${i}`, image }));
    await sleep(350);

    expect(delivered(bob).filter((m) => m.text.startsWith("bad image"))).toEqual([]);
    expect(server.isAlive()).toBe(true);
  });

  it("rejects someone else's upload and leaves their file alone", async () => {
    const aliceUpload = await uploadImage(server, aliceToken);
    const thief = await connect(bobToken);

    thief.socket.emit("sendMessage", { text: "borrowed image", image: aliceUpload.imageUrl });
    await sleep(300);

    expect(delivered(bob).find((m) => m.text === "borrowed image")).toBeUndefined();
    expect(fs.existsSync(uploadedFile(aliceUpload.fileName))).toBe(true);
  });

  it("accepts the sender's own upload once and refuses to reuse it", async () => {
    const upload = await uploadImage(server, aliceToken);
    const alice = await connect(aliceToken);

    const first = await sendAndWait(alice, bob, { text: "first use", image: upload.imageUrl });
    expect(first.image).toBe(upload.imageUrl);

    alice.socket.emit("sendMessage", { text: "second use", image: upload.imageUrl });
    await sleep(300);
    expect(delivered(bob).find((m) => m.text === "second use")).toBeUndefined();
  });

  it("deleting a message removes its own image file and no other user's", async () => {
    const aliceUpload = await uploadImage(server, aliceToken);
    const bobUpload = await uploadImage(server, bobToken);
    const alice = await connect(aliceToken);
    const bobSender = await connect(bobToken);

    const aliceMessage = await sendAndWait(alice, bob, { text: "alice with picture", image: aliceUpload.imageUrl });
    const bobMessage = await sendAndWait(bobSender, bob, { text: "bob with picture", image: bobUpload.imageUrl });

    bobSender.socket.emit("deleteMessage", { id: bobMessage.id });
    await waitFor(() => !fs.existsSync(uploadedFile(bobUpload.fileName)));
    expect(fs.existsSync(uploadedFile(aliceUpload.fileName))).toBe(true);

    alice.socket.emit("deleteMessage", { id: aliceMessage.id });
    await waitFor(() => !fs.existsSync(uploadedFile(aliceUpload.fileName)));
  });
});

describe("messages saved before image validation existed", () => {
  let server;
  let client;

  beforeAll(async () => {
    server = await startServer({
      seed: {
        "messages.json": [
          {
            id: "legacy-1",
            room: "general",
            username: "alice",
            text: "old message with a bogus image",
            image: "@evil.example/x.png",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      // A file the old deletion code would have removed via path.basename("@evil.example/x.png").
      files: { "uploads/x.png": "canary" },
    });
    client = await connectClient(server, await register(server, "alice"));
  });

  afterAll(async () => {
    client.close();
    await server.stop();
  });

  it("are served without the untrusted image reference", async () => {
    const history = await waitFor(() => eventsOf(client, "roomMessages")[0]);
    const legacy = history.messages.find((m) => m.id === "legacy-1");
    expect(legacy.text).toBe("old message with a bogus image");
    expect(legacy.image).toBeNull();
  });

  it("deleting such a message does not delete unrelated files", async () => {
    client.socket.emit("deleteMessage", { id: "legacy-1" });
    await waitFor(() => eventsOf(client, "messageDeleted").find((e) => e.id === "legacy-1"));
    await sleep(300);

    expect(fs.readFileSync(server.path("uploads", "x.png"), "utf-8")).toBe("canary");
  });
});

describe("simultaneous registrations", () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("all end up in users.json", async () => {
    const names = ["racer1", "racer2", "racer3", "racer4", "racer5", "racer6"];

    const responses = await Promise.all(
      names.map((username) =>
        fetch(server.url + "/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: "password123" }),
        })
      )
    );

    expect(responses.map((r) => r.status)).toEqual(names.map(() => 200));
    const stored = JSON.parse(fs.readFileSync(server.path("server", "users.json"), "utf-8"));
    expect(Object.keys(stored).sort()).toEqual(names);
  });
});
