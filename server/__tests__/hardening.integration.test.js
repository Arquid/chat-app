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

describe("limits belong to the account, not the connection", () => {
  let server;
  let tokens;
  let bob;
  const clients = [];

  const connect = async (token) => {
    const client = await connectClient(server, token);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    // The real defaults: 5 messages per 10 s and 5 connections per user.
    server = await startServer({ env: { MESSAGE_RATE_LIMIT: "5", MAX_CONNECTIONS_PER_USER: "5" } });
    tokens = {};
    for (const name of ["alice", "bob", "carol", "dave", "erin", "frank", "grace"]) {
      tokens[name] = await register(server, name);
    }
    bob = await connect(tokens.bob);
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await server.stop();
  });

  it("shares one message budget across all of a user's connections", async () => {
    const sockets = await Promise.all([1, 2, 3, 4].map(() => connect(tokens.alice)));
    sockets.forEach((c, i) => {
      for (let k = 0; k < 5; k++) c.socket.emit("sendMessage", { text: `multi ${i}-${k}` });
    });
    await sleep(600);

    expect(delivered(bob).filter((m) => m.text.startsWith("multi"))).toHaveLength(5);
    expect(sockets.flatMap((c) => eventsOf(c, "rateLimitExceeded"))).toHaveLength(15);
  });

  it("does not throttle other users because one user used up their budget", async () => {
    // alice has exhausted her budget in the previous test, within the same 10 s window
    const message = await sendAndWait(bob, bob, { text: "bob is unaffected" });
    expect(message.username).toBe("bob");
    expect(eventsOf(bob, "rateLimitExceeded")).toEqual([]);
  });

  it("counts sends, edits, reactions and deletes against the same budget", async () => {
    const grace = await connect(tokens.grace);
    let target;
    for (const text of ["g1", "g2", "g3"]) {
      const sent = await sendAndWait(grace, bob, { text });
      target ??= sent;
    }

    grace.socket.emit("toggleReaction", { id: target.id, emoji: "👍" }); // 4th action
    grace.socket.emit("editMessage", { id: target.id, text: "g1 edited" }); // 5th action
    await waitFor(() => eventsOf(grace, "messageEdited").length === 1);
    expect(eventsOf(grace, "reactionUpdated")).toHaveLength(1);
    expect(eventsOf(grace, "rateLimitExceeded")).toEqual([]);

    grace.socket.emit("deleteMessage", { id: target.id }); // 6th action within 10 s
    await waitFor(() => eventsOf(grace, "rateLimitExceeded").length === 1);
    await sleep(200);
    expect(eventsOf(bob, "messageDeleted")).toEqual([]);
  });

  it("refuses a sixth simultaneous connection for one user and frees the slot on disconnect", async () => {
    const open = [];
    for (let i = 0; i < 5; i++) open.push(await connect(tokens.carol));

    await expect(connectClient(server, tokens.carol)).rejects.toThrow("Too many connections");

    open.pop().close();
    const again = await waitFor(() => connectClient(server, tokens.carol).catch(() => null));
    clients.push(again);
    expect(again.socket.connected).toBe(true);
  });

  it("keeps the connection cap even when many connections arrive at the same moment", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => connectClient(server, tokens.erin)));
    const accepted = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter((a) => a.status === "rejected");
    accepted.forEach((a) => clients.push(a.value));

    expect(accepted).toHaveLength(5);
    expect(refused).toHaveLength(5);
    expect(refused.every((a) => a.reason.message === "Too many connections")).toBe(true);
  });

  it("limits room creation to 3 per minute per user", async () => {
    const dave = await connect(tokens.dave);
    ["room-a", "room-b", "room-c", "room-d"].forEach((name) => dave.socket.emit("createRoom", name));

    const error = await waitFor(() => eventsOf(dave, "roomError")[0]);
    expect(error.message).toBe("You're creating rooms too fast");
    expect(eventsOf(dave, "roomError")).toHaveLength(1);
    expect(eventsOf(dave, "roomList").at(-1)).toEqual(["general", "room-a", "room-b", "room-c"]);
  });

  it("counts invalid room names against the room budget too", async () => {
    const frank = await connect(tokens.frank);
    ["x", "y", "z", "w"].forEach((name) => frank.socket.emit("createRoom", name)); // all too short

    await waitFor(() => eventsOf(frank, "roomError").length === 4);
    const messages = eventsOf(frank, "roomError").map((e) => e.message);
    expect(messages.slice(0, 3).every((m) => m.startsWith("Room names must be"))).toBe(true);
    expect(messages[3]).toBe("You're creating rooms too fast");
  });
});

describe("login response time", () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
    await register(server, "timeduser");
  });

  afterAll(async () => {
    await server.stop();
  });

  it("does not reveal whether a username exists", async () => {
    const attempt = async (username) => {
      const start = performance.now();
      const response = await fetch(server.url + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "wrongpass1" }),
      });
      const elapsed = performance.now() - start;
      return { status: response.status, body: await response.text(), elapsed };
    };

    // 1 registration + 8 attempts stays inside the 10-request auth rate limit.
    const known = [];
    const unknown = [];
    for (let i = 0; i < 4; i++) {
      known.push(await attempt("timeduser"));
      unknown.push(await attempt(`nosuchuser${i}`));
    }

    for (const result of [...known, ...unknown]) {
      expect(result.status).toBe(401);
      expect(result.body).toBe(known[0].body); // identical response either way
    }
    const mean = (rows) => rows.reduce((sum, r) => sum + r.elapsed, 0) / rows.length;
    expect(mean(known) / mean(unknown)).toBeLessThan(2.5);
  });
});

describe("room quota per user", () => {
  let server;
  const clients = [];

  beforeAll(async () => {
    server = await startServer({
      seed: {
        "rooms.json": ["general", "r1", "r2", "r3", "r4", "r5"],
        "roomOwners.json": { r1: "alice", r2: "alice", r3: "alice", r4: "alice", r5: "alice" },
      },
    });
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await server.stop();
  });

  const join = async (name) => {
    const client = await connectClient(server, await register(server, name));
    clients.push(client);
    return client;
  };

  it("stops a user who already owns five rooms, but not other users", async () => {
    const alice = await join("alice");
    const bob = await join("bob");

    alice.socket.emit("createRoom", "r6");
    const error = await waitFor(() => eventsOf(alice, "roomError")[0]);
    expect(error.message).toBe("You can create at most 5 rooms");
    expect(eventsOf(alice, "roomList").at(-1)).not.toContain("r6");

    bob.socket.emit("createRoom", "bobs-room");
    await waitFor(() => eventsOf(bob, "roomList").at(-1)?.includes("bobs-room"));
    expect(eventsOf(bob, "roomError")).toEqual([]);

    const owners = JSON.parse(fs.readFileSync(server.path("server", "roomOwners.json"), "utf-8"));
    expect(owners["bobs-room"]).toBe("bob");
    expect(owners.r1).toBe("alice");
  });

  it("does not count rooms that have no owner, such as general", async () => {
    const heidi = await join("heidi");
    heidi.socket.emit("createRoom", "heidis-room");
    await waitFor(() => eventsOf(heidi, "roomList").at(-1)?.includes("heidis-room"));
    expect(eventsOf(heidi, "roomError")).toEqual([]);
  });

  it("records the owner of a room named after an Object.prototype member", async () => {
    const ivan = await join("ivan");
    ivan.socket.emit("createRoom", "__proto__");
    await waitFor(() => eventsOf(ivan, "roomList").at(-1)?.includes("__proto__"));

    const owners = JSON.parse(fs.readFileSync(server.path("server", "roomOwners.json"), "utf-8"));
    expect(Object.keys(owners)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(owners, "__proto__").value).toBe("ivan");
  });
});
