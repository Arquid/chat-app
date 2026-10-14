import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tempRoot;
let uploadsModule;

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-uploads-test-"));
  fs.mkdirSync(path.join(tempRoot, "server"));
  vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

  uploadsModule = await import("../uploads.js");
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const uploadsFile = () => path.join(tempRoot, "server", "uploads.json");

beforeEach(() => {
  if (fs.existsSync(uploadsFile())) fs.rmSync(uploadsFile());
});

describe("loadUploads", () => {
  it("returns an empty registry when no file exists yet", () => {
    expect(uploadsModule.loadUploads()).toEqual({});
  });

  it("returns an empty registry instead of crashing when the file is corrupt", () => {
    fs.writeFileSync(uploadsFile(), "{ not valid json");
    expect(uploadsModule.loadUploads()).toEqual({});
  });

  it("ignores files whose content is not an object", () => {
    fs.writeFileSync(uploadsFile(), "[1, 2, 3]");
    expect(uploadsModule.loadUploads()).toEqual({});
    fs.writeFileSync(uploadsFile(), "null");
    expect(uploadsModule.loadUploads()).toEqual({});
  });

  it("returns a previously saved registry", () => {
    const registry = { "a.png": { owner: "alice", createdAt: "2026-01-01T00:00:00.000Z", used: false } };
    uploadsModule.saveUploads(registry);
    expect(uploadsModule.loadUploads()).toEqual(registry);
  });
});
