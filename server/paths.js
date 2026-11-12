import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : REPO_ROOT;

export const SERVER_DATA_DIR = path.join(DATA_DIR, "server");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");