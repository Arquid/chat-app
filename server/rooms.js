import fs from "fs";
import path from "path";

const ROOMS_FILE = path.join(process.cwd(), "server", "rooms.json");
const DEFAULT_ROOMS = ["general"];

export function loadRooms() {
  if (!fs.existsSync(ROOMS_FILE)) return [...DEFAULT_ROOMS];
  try {
    const rooms = JSON.parse(fs.readFileSync(ROOMS_FILE, "utf-8"));
    return Array.isArray(rooms) && rooms.length > 0 ? rooms : [...DEFAULT_ROOMS];
  } catch {
    return [...DEFAULT_ROOMS];
  }
}

export function saveRooms(rooms) {
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
}