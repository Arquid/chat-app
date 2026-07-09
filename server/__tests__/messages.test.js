import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempRoot;
let messagesModule;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-messages-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

  messagesModule = await import("../messages.js");
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const messagesFile = () => path.join(tempRoot, "server", "messages.json");

beforeEach(() => {
  if (fs.existsSync(messagesFile())) fs.rmSync(messagesFile());
});

describe("loadMessages", () => {
  it("returns an empty array when no file exists yet", () => {
    expect(messagesModule.loadMessages()).toEqual([]);
  });

  it("returns an empty array instead of crashing when the file is corrupt", () => {
    fs.writeFileSync(messagesFile(), "{ not valid json");
    expect(messagesModule.loadMessages()).toEqual([]);
  });

  it("returns previously saved messages", () => {
    const sample = [
      { id: "1", username: "alice", text: "hi", image: null, timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    messagesModule.saveMessages(sample);
    expect(messagesModule.loadMessages()).toEqual(sample);
  });
});

describe("saveMessages", () => {
  it("overwrites previous contents rather than appending", () => {
    messagesModule.saveMessages([{ id: "1", text: "first" }]);
    messagesModule.saveMessages([{ id: "2", text: "second" }]);

    const result = messagesModule.loadMessages();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("persists across a fresh load (survives a restart)", () => {
    const sample = [{ id: "1", username: "bob", text: "still here", image: null, timestamp: "2026-01-01T00:00:00.000Z" }];
    messagesModule.saveMessages(sample);

    // loadMessages reads from disk every call, so this simulates what
    // happens when the server process restarts and calls it again.
    expect(messagesModule.loadMessages()).toEqual(sample);
  });
});
