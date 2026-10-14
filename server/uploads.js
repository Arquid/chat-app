import fs from "fs";
import path from "path";

const UPLOADS_FILE = path.join(process.cwd(), "server", "uploads.json");

// Registry of uploaded images: { "<uuid>.png": { owner, createdAt, used } }.
// It lets the server check that a message only references an image its own
// sender uploaded, and that each upload is attached to at most one message.
export function loadUploads() {
  if (!fs.existsSync(UPLOADS_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(UPLOADS_FILE, "utf-8"));
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function saveUploads(uploads) {
  fs.writeFileSync(UPLOADS_FILE, JSON.stringify(uploads, null, 2));
}
