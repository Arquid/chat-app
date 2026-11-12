import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { UserError } from "../errors.js";

// users.js resolves its storage path (via paths.js) from DATA_DIR at import time,
// so point DATA_DIR at a throwaway temp directory before importing it. This keeps
// tests off the real server/users.json and isolated from each other.
let tempRoot;
let users;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-users-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  process.env.DATA_DIR = tempRoot;

  users = await import("../users.js");
});

afterAll(() => {
  vi.restoreAllMocks();
  delete process.env.DATA_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const usersFile = () => path.join(tempRoot, "server", "users.json");

beforeEach(() => {
  if (fs.existsSync(usersFile())) fs.rmSync(usersFile());
});

describe("registerUser", () => {
  it("creates a user and returns a token that verifies to their username", async () => {
    const token = await users.registerUser("alice", "password123");
    expect(typeof token).toBe("string");
    expect(users.verifyToken(token).username).toBe("alice");
  });

  it("rejects duplicate usernames, case-insensitively", async () => {
    await users.registerUser("Bob", "password123");
    await expect(users.registerUser("bob", "otherpassword")).rejects.toThrow("Username already taken");
  });

  it("never stores the plaintext password", async () => {
    await users.registerUser("carol", "supersecret1");
    const stored = JSON.parse(fs.readFileSync(usersFile(), "utf-8"));
    expect(stored.carol.passwordHash).not.toBe("supersecret1");
    expect(stored.carol.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash format
  });

  // Regression: registerUser used to read users.json, await the (slow) bcrypt
  // hash, then write its stale copy back, so concurrent signups overwrote each
  // other and all but one account was lost even though every request got a token.
  it("keeps every account when many users register at the same time", async () => {
    const names = ["racer1", "racer2", "racer3", "racer4", "racer5", "racer6"];

    const results = await Promise.allSettled(names.map((name) => users.registerUser(name, "password123")));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const stored = JSON.parse(fs.readFileSync(usersFile(), "utf-8"));
    expect(Object.keys(stored).sort()).toEqual(names);

    for (const name of names) {
      await expect(users.loginUser(name, "password123")).resolves.toEqual(expect.any(String));
    }
  });

  it("lets only one of several simultaneous registrations of the same name win", async () => {
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() => users.registerUser("samename", "password123"))
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => r.reason.message === "Username already taken")).toBe(true);
    expect(Object.keys(JSON.parse(fs.readFileSync(usersFile(), "utf-8")))).toEqual(["samename"]);
  });

  it("does not leave temporary files behind after saving", async () => {
    await users.registerUser("tidy1", "password123");
    const leftovers = fs.readdirSync(path.join(tempRoot, "server")).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("treats Object.prototype member names as ordinary, registrable usernames", async () => {
    // "constructor" used to resolve to an inherited function and be reported as taken.
    const token = await users.registerUser("constructor", "password123");
    expect(users.verifyToken(token).username).toBe("constructor");
    await expect(users.loginUser("constructor", "password123")).resolves.toEqual(expect.any(String));
  });
});

describe("loginUser", () => {
  it("returns a valid token for correct credentials", async () => {
    await users.registerUser("dave", "correctpassword");
    const token = await users.loginUser("dave", "correctpassword");
    expect(users.verifyToken(token).username).toBe("dave");
  });

  it("rejects an incorrect password", async () => {
    await users.registerUser("erin", "correctpassword");
    await expect(users.loginUser("erin", "wrongpassword")).rejects.toThrow("Invalid username or password");
  });

  it("rejects a non-existent user with the same error as a wrong password", async () => {
    // Same error message for both cases so login can't be used to enumerate
    // which usernames are registered.
    await expect(users.loginUser("ghost", "whatever123")).rejects.toThrow("Invalid username or password");
  });

  it("gives the generic error for names that exist on Object.prototype but were never registered", async () => {
    for (const name of ["toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      await expect(users.loginUser(name, "password123")).rejects.toThrow("Invalid username or password");
    }
  });

  it("is case-insensitive on username", async () => {
    await users.registerUser("Frank", "correctpassword");
    const token = await users.loginUser("frank", "correctpassword");
    expect(users.verifyToken(token).username).toBe("Frank");
  });
});

// A failed login must cost the same work whether or not the username exists.
// Before, an unknown username skipped bcrypt entirely and answered ~28x faster,
// which let anyone discover which usernames are registered just by timing.
describe("login does not reveal whether a username exists", () => {
  // The password the placeholder hash was made from (see DUMMY_HASH in users.js).
  const PLACEHOLDER_PASSWORD = "dummy-password-that-is-never-used";
  let compareSpy;

  const storedHash = (name) => JSON.parse(fs.readFileSync(usersFile(), "utf-8"))[name.toLowerCase()].passwordHash;

  beforeEach(() => {
    compareSpy = vi.spyOn(bcrypt, "compare");
  });

  afterEach(() => {
    compareSpy.mockRestore();
  });

  it("runs exactly one bcrypt comparison for an unknown username", async () => {
    await expect(users.loginUser("ghost", "whatever123")).rejects.toThrow("Invalid username or password");

    expect(compareSpy).toHaveBeenCalledTimes(1);
    const [password, hash] = compareSpy.mock.calls[0];
    expect(password).toBe("whatever123");
    expect(hash).toMatch(/^\$2[aby]\$10\$/); // a real bcrypt hash, not a shortcut
  });

  it("runs exactly one comparison against the stored hash for a known user", async () => {
    await users.registerUser("known1", "correctpassword");
    const stored = storedHash("known1");
    compareSpy.mockClear();

    await expect(users.loginUser("known1", "wrongpassword")).rejects.toThrow("Invalid username or password");
    await users.loginUser("known1", "correctpassword");

    expect(compareSpy).toHaveBeenCalledTimes(2);
    expect(compareSpy.mock.calls.map((call) => call[1])).toEqual([stored, stored]);
  });

  it("compares unknown usernames against a hash with the same cost as real ones", async () => {
    await users.registerUser("known2", "correctpassword");
    await expect(users.loginUser("nobody2", "whatever123")).rejects.toThrow();

    const placeholder = compareSpy.mock.calls.at(-1)[1];
    expect(bcrypt.getRounds(placeholder)).toBe(bcrypt.getRounds(storedHash("known2")));
  });

  it("gives the same error for an unknown user and a wrong password", async () => {
    await users.registerUser("known3", "correctpassword");
    const unknown = await users.loginUser("nobody3", "wrongpassword").catch((e) => e.message);
    const wrong = await users.loginUser("known3", "wrongpassword").catch((e) => e.message);
    expect(unknown).toBe(wrong);
  });

  it("never logs in an unknown username, even with the placeholder hash's own password", async () => {
    await expect(users.loginUser("nobody4", PLACEHOLDER_PASSWORD)).rejects.toThrow("Invalid username or password");
  });

  it("does not let an entry without a password hash be logged into with the placeholder password", async () => {
    // A hand-edited or damaged users.json must not turn the placeholder
    // password (which is public in the source) into a working credential.
    fs.writeFileSync(
      usersFile(),
      JSON.stringify({
        nohash: { username: "nohash" },
        nullhash: { username: "nullhash", passwordHash: null },
        numberhash: { username: "numberhash", passwordHash: 12345 },
      })
    );

    for (const name of ["nohash", "nullhash", "numberhash"]) {
      await expect(users.loginUser(name, PLACEHOLDER_PASSWORD)).rejects.toThrow("Invalid username or password");
      await expect(users.loginUser(name, "password123")).rejects.toThrow("Invalid username or password");
    }
  });

  it("reports a malformed stored hash as an ordinary failed login, not an internal error", async () => {
    fs.writeFileSync(usersFile(), JSON.stringify({ garbled: { username: "garbled", passwordHash: "not-a-bcrypt-hash" } }));
    await expect(users.loginUser("garbled", "password123")).rejects.toThrow("Invalid username or password");
  });

  it("takes comparable time for known and unknown usernames", async () => {
    await users.registerUser("timed1", "correctpassword");
    const time = async (name) => {
      const start = performance.now();
      await users.loginUser(name, "wrongpassword1").catch(() => {});
      return performance.now() - start;
    };

    const known = [];
    const unknown = [];
    for (let i = 0; i < 4; i++) {
      // interleaved, so any drift in machine load hits both sides equally
      known.push(await time("timed1"));
      unknown.push(await time(`nobody-timed-${i}`));
    }
    const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

    // Was ~28x before the fix; a generous bound keeps this stable on busy CI machines.
    expect(mean(known) / mean(unknown)).toBeLessThan(2.5);
  });
});

// The HTTP layer shows a message to the user only when it comes from a UserError.
// Everything else (damaged files, disk errors) must stay distinguishable from it,
// otherwise it would be reported as "username taken" or "wrong password".
describe("expected and unexpected failures can be told apart", () => {
  it("reports a taken username as a UserError with status 409", async () => {
    await users.registerUser("taken1", "password123");
    const error = await users.registerUser("TAKEN1", "password123").catch((e) => e);

    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({ message: "Username already taken", status: 409 });
  });

  it("reports a failed login as a UserError with status 401, for a wrong password and an unknown user alike", async () => {
    await users.registerUser("known9", "correctpassword");
    const wrong = await users.loginUser("known9", "wrongpassword").catch((e) => e);
    const unknown = await users.loginUser("nobody9", "wrongpassword").catch((e) => e);

    for (const error of [wrong, unknown]) {
      expect(error).toBeInstanceOf(UserError);
      expect(error).toMatchObject({ message: "Invalid username or password", status: 401 });
    }
  });

  it("does not report a damaged users.json as a UserError", async () => {
    fs.writeFileSync(usersFile(), "{ not json");

    const register = await users.registerUser("anyone", "password123").catch((e) => e);
    const login = await users.loginUser("anyone", "password123").catch((e) => e);

    for (const error of [register, login]) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UserError);
      expect(error.status).toBeUndefined();
    }
  });
});

describe("verifyToken", () => {
  it("throws for a garbage token", () => {
    expect(() => users.verifyToken("not-a-real-token")).toThrow();
  });

  it("throws for a token signed with a different secret", () => {
    // Simulate a forged token, which jwt.verify must reject since it was
    // not signed with our JWT_SECRET.
    const forged = jwt.sign({ username: "admin" }, "wrong-secret");
    expect(() => users.verifyToken(forged)).toThrow();
  });
});
