import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

// users.js resolves its storage path from process.cwd() at import time, so
// point cwd at a throwaway temp directory before importing it. This keeps
// tests off the real server/users.json and isolated from each other.
let tempRoot;
let users;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-users-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

  users = await import("../users.js");
});

afterAll(() => {
  vi.restoreAllMocks();
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
