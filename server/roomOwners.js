import fs from "fs";
import path from "path";

const OWNERS_FILE = path.join(process.cwd(), "server", "roomOwners.json");

// Who created each room: Map<roomName, username>.
export function loadRoomOwners() {
  if (!fs.existsSync(OWNERS_FILE)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(OWNERS_FILE, "utf-8"));
    const isObject = data !== null && typeof data === "object" && !Array.isArray(data);
    return new Map(isObject ? Object.entries(data) : []);
  } catch {
    return new Map();
  }
}

export function saveRoomOwners(owners) {
  fs.writeFileSync(OWNERS_FILE, JSON.stringify(Object.fromEntries(owners), null, 2));
}