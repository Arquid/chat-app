import fs from "fs";
import path from "path";

import { SERVER_DATA_DIR } from "./paths.js";

const MESSAGES_FILE = path.join(SERVER_DATA_DIR, "messages.json");

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