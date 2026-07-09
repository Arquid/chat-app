import fs from "fs";
import path from "path";

const MESSAGES_FILE = path.join(process.cwd(), "server", "messages.json");

export function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) return [];

  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}