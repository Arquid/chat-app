// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PATHS_MODULE = pathToFileURL(fileURLToPath(new URL("../paths.js", import.meta.url))).href;
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

let elsewhere;

beforeAll(() => {
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-paths-"));
});

afterAll(() => {
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

// paths.js reads the environment when it is imported, so each case loads it in a
// fresh Node process started from a directory that is NOT the repository.
function loadPaths(env = {}, cwd = elsewhere) {
  const childEnv = { ...process.env, ...env };
  if (!("DATA_DIR" in env)) delete childEnv.DATA_DIR;

  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import * as p from ${JSON.stringify(PATHS_MODULE)}; console.log(JSON.stringify(p));`],
    { cwd, env: childEnv, encoding: "utf-8" }
  );
  return JSON.parse(output);
}

describe("paths", () => {
  it("defaults to the repository, wherever the process was started from", () => {
    const paths = loadPaths();
    expect(paths.SERVER_DATA_DIR).toBe(path.join(REPO_ROOT, "server"));
    expect(paths.UPLOADS_DIR).toBe(path.join(REPO_ROOT, "uploads"));
  });

  it("gives the same answer from the repository root and from another directory", () => {
    expect(loadPaths({}, REPO_ROOT)).toEqual(loadPaths({}, elsewhere));
  });

  it("moves both directories when DATA_DIR is set", () => {
    const dataDir = path.join(elsewhere, "data");
    const paths = loadPaths({ DATA_DIR: dataDir });
    expect(paths.SERVER_DATA_DIR).toBe(path.join(dataDir, "server"));
    expect(paths.UPLOADS_DIR).toBe(path.join(dataDir, "uploads"));
  });

  it("turns a relative DATA_DIR into an absolute path", () => {
    const paths = loadPaths({ DATA_DIR: "relative-data" });
    expect(path.isAbsolute(paths.SERVER_DATA_DIR)).toBe(true);
    expect(paths.SERVER_DATA_DIR).toBe(path.join(elsewhere, "relative-data", "server"));
  });

  it("ignores an empty DATA_DIR instead of using the working directory", () => {
    const paths = loadPaths({ DATA_DIR: "" });
    expect(paths.SERVER_DATA_DIR).toBe(path.join(REPO_ROOT, "server"));
  });
});
