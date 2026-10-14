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

// Write to a temp file and rename it over the real one, so a crash halfway
// through a write can never leave a truncated users.json behind.
function saveUsers(users) {
  const tmpFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2));
  fs.renameSync(tmpFile, USERS_FILE);
}

// Usernames come from clients, so look them up as own properties only. A bare
// users["constructor"] would otherwise resolve to an inherited function.
function findUser(users, key) {
  return Object.hasOwn(users, key) ? users[key] : undefined;
}

export function generateToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function registerUser(username, password) {
  const key = username.toLowerCase();

  // Do the slow, asynchronous hashing first. Everything after this line is
  // synchronous, so concurrent registrations cannot interleave between
  // reading users.json and writing it back (which used to drop accounts).
  const passwordHash = await bcrypt.hash(password, 10);

  const users = loadUsers();
  if (findUser(users, key)) {
    throw new Error("Username already taken");
  }

  users[key] = { username, passwordHash };
  saveUsers(users);

  return generateToken(username);
}

export async function loginUser(username, password) {
  const users = loadUsers();
  const user = findUser(users, username.toLowerCase());

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error("Invalid username or password")
  }

  return generateToken(user.username)
}