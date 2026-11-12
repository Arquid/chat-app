import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempRoot;
let owners;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-owners-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  process.env.DATA_DIR = tempRoot;

  owners = await import("../roomOwners.js");
});

afterAll(() => {
  vi.restoreAllMocks();
  delete process.env.DATA_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const ownersFile = () => path.join(tempRoot, "server", "roomOwners.json");

beforeEach(() => {
  if (fs.existsSync(ownersFile())) fs.rmSync(ownersFile());
});

describe("loadRoomOwners", () => {
  it("returns an empty Map when no file exists yet", () => {
    const loaded = owners.loadRoomOwners();
    expect(loaded).toBeInstanceOf(Map);
    expect(loaded.size).toBe(0);
  });

  it("returns an empty Map instead of crashing when the file is corrupt", () => {
    fs.writeFileSync(ownersFile(), "{ not valid json");
    expect(owners.loadRoomOwners().size).toBe(0);
  });

  it("ignores files whose content is not an object", () => {
    for (const content of ["[1, 2, 3]", "null", '"text"', "42"]) {
      fs.writeFileSync(ownersFile(), content);
      expect(owners.loadRoomOwners().size).toBe(0);
    }
  });

  it("reads a previously saved file", () => {
    fs.writeFileSync(ownersFile(), JSON.stringify({ random: "alice", tech: "bob" }));
    expect(Object.fromEntries(owners.loadRoomOwners())).toEqual({ random: "alice", tech: "bob" });
  });
});

describe("saveRoomOwners", () => {
  it("round-trips owners, including room names that look like Object.prototype members", () => {
    const map = new Map([
      ["random", "alice"],
      ["__proto__", "bob"],
      ["toString", "carol"],
      ["constructor", "dave"],
    ]);

    owners.saveRoomOwners(map);
    const loaded = owners.loadRoomOwners();

    expect(loaded.size).toBe(4);
    for (const [room, owner] of map) expect(loaded.get(room)).toBe(owner);
  });

  it("overwrites the previous contents rather than appending", () => {
    owners.saveRoomOwners(new Map([["a-room", "alice"]]));
    owners.saveRoomOwners(new Map([["b-room", "bob"]]));
    expect([...owners.loadRoomOwners().keys()]).toEqual(["b-room"]);
  });
});
