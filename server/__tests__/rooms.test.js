import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempRoot;
let roomsModule;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-rooms-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

  roomsModule = await import("../rooms.js");
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const roomsFile = () => path.join(tempRoot, "server", "rooms.json");

beforeEach(() => {
  if (fs.existsSync(roomsFile())) fs.rmSync(roomsFile());
});

describe("loadRooms", () => {
  it("returns the default room when no file exists yet", () => {
    expect(roomsModule.loadRooms()).toEqual(["general"]);
  });

  it("returns the default room when the file is corrupt", () => {
    fs.writeFileSync(roomsFile(), "{ not valid json");
    expect(roomsModule.loadRooms()).toEqual(["general"]);
  });

  it("returns the default room when the saved list is empty", () => {
    fs.writeFileSync(roomsFile(), "[]");
    expect(roomsModule.loadRooms()).toEqual(["general"]);
  });

  it("returns previously saved rooms", () => {
    roomsModule.saveRooms(["general", "random", "tech"]);
    expect(roomsModule.loadRooms()).toEqual(["general", "random", "tech"]);
  });
});

describe("saveRooms", () => {
  it("overwrites the previous list rather than appending", () => {
    roomsModule.saveRooms(["general", "random"]);
    roomsModule.saveRooms(["general"]);
    expect(roomsModule.loadRooms()).toEqual(["general"]);
  });

  it("persists across a fresh load (survives a restart)", () => {
    roomsModule.saveRooms(["general", "gaming"]);
    expect(roomsModule.loadRooms()).toEqual(["general", "gaming"]);
  });
});
