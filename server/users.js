import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const USERS_FILE = path.join(process.cwd(), "server", "users.json");
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = "7d";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};

  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function registerUser(username, password) {
  const users = loadUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    throw new Error("Username already taken")
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users[key] = { username, passwordHash };
  saveUsers(users);

  return generateToken(username);
}

export async function loginUser(username, password) {
  const users = loadUsers();
  const user = users[username.toLowerCase()];

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error("Invalid username or password")
  }

  return generateToken(user.username)
}