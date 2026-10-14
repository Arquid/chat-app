import "dotenv/config";
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from "express-rate-limit";

import { registerUser, loginUser, verifyToken } from "./users.js";
import { loadMessages, saveMessages } from "./messages.js";
import { loadRooms, saveRooms } from "./rooms.js";
import { loadUploads, saveUploads } from "./uploads.js";
import { toggleReaction } from "./reactions.js";
import { safeHandler } from "./safeHandler.js";
import { isValidUsername, isValidPassword, isValidMessage, isValidRoomName, parseImagePath, MAX_TEXT_LENGTH } from "./validation.js";

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const MAX_HISTORY = 200;
const MAX_ROOMS = 50;
let rooms = loadRooms();

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Messages saved before image references were validated may hold arbitrary
// strings in `image`; drop anything that is not one of our own upload paths.
let messages = loadMessages().map((m) => (m.image && !parseImagePath(m.image) ? { ...m, image: null } : m));
let uploads = loadUploads();

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, please try again later" }
});

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || "";
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, and WEBP images are allowed"));
    }
  },
});

// A message may only reference an image its own sender uploaded, and each
// upload can be attached to one message only. Marks the upload as used.
function claimUpload(imagePath, username) {
  const fileName = parseImagePath(imagePath);
  const entry = fileName && Object.hasOwn(uploads, fileName) ? uploads[fileName] : null;
  if (!entry || entry.owner !== username || entry.used) return false;

  entry.used = true;
  saveUploads(uploads);
  return true;
}

// Deletes the file behind a removed message's image, unless some other
// message still shows it. Only paths of our own upload format are touched.
function releaseImage(imagePath) {
  const fileName = parseImagePath(imagePath);
  if (!fileName) return;
  if (messages.some((m) => m.image === imagePath)) return;

  delete uploads[fileName];
  saveUploads(uploads);
  fs.unlink(path.join("uploads", fileName), () => {}); // best-effort cleanup, ignore errors
}

function trimRoomHistory(room) {
  const roomMessages = messages.filter((m) => m.room === room);
  if (roomMessages.length <= MAX_HISTORY) return;

  let overflow = roomMessages.length - MAX_HISTORY;
  messages = messages.filter((m) => {
    if (m.room === room && overflow > 0) {
      overflow--;
      return false;
    }
    return true;
  });
}

app.post("/auth/register", authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Username must be 3-20 characters (letters, numbers, _ or -)" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const token = await registerUser(username, password);
    res.json({ token, username });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.post("/auth/login", authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password required" });
  }

  try {
    const token = await loginUser(username, password);
    res.json({ token, username });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

app.post("/upload", uploadLimiter, authenticate, (req, res) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    uploads[req.file.filename] = { owner: req.user.username, createdAt: new Date().toISOString(), used: false };
    saveUploads(uploads);

    res.json({ imageUrl: `/uploads/${req.file.filename}` });
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    socket.data.username = verifyToken(token).username;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

function getRoomUsers(room) {
  const socketIds = io.sockets.adapter.rooms.get(room);
  if (!socketIds) return [];

  const usernames = new Set();
  for (const id of socketIds) {
    const username = io.sockets.sockets.get(id)?.data?.username;
    if (username) usernames.add(username);
  }
  return Array.from(usernames);
}

function broadcastRoomUsers(room) {
  io.to(room).emit("roomUsers", { room, users: getRoomUsers(room) });
}

io.on('connection', (socket) => {
  const MESSAGE_RATE_LIMIT = 5;
  const MESSAGE_RATE_WINDOW_MS = 10000;
  const messageTimestamps = [];

  // Shared budget for sending, editing, and deleting messages so none of
  // them can be used to route around the others' rate limit.
  function checkRateLimit() {
    const now = Date.now();
    while (messageTimestamps.length && now - messageTimestamps[0] > MESSAGE_RATE_WINDOW_MS) {
      messageTimestamps.shift();
    }
    if (messageTimestamps.length >= MESSAGE_RATE_LIMIT) {
      socket.emit("rateLimitExceeded", { message: "You're sending messages too fast" });
      return false;
    }
    messageTimestamps.push(now);
    return true;
  }

  // Every client-triggered event goes through safeHandler, so a malformed
  // payload is ignored instead of throwing and crashing the server. Handlers
  // that take an object payload ignore null/primitive payloads automatically;
  // handlers whose payload is a string or nothing opt out.
  const on = (event, handler, options) => socket.on(event, safeHandler(handler, options));
  const ANY_PAYLOAD = { expectObject: false };

  const defaultRoom = rooms.includes("general") ? "general" : rooms[0];
  socket.data.currentRoom = defaultRoom;
  socket.join(defaultRoom);

  socket.emit("roomList", rooms);
  socket.emit("roomMessages", {
    room: defaultRoom,
    messages: messages.filter((m) => m.room === defaultRoom),
  });
  broadcastRoomUsers(defaultRoom);

  on("createRoom", (roomName) => {
    if (!isValidRoomName(roomName)) {
      socket.emit("roomError", { message: "Room names must be 2-30 characters (letters, numbers, _ or -)" });
      return;
    }
    if (rooms.some((r) => r.toLowerCase() === roomName.toLowerCase())) {
      socket.emit("roomError", { message: "Room already exists" });
      return;
    }
    if (rooms.length >= MAX_ROOMS) {
      socket.emit("roomError", { message: "Room limit reached" });
      return;
    }

    rooms.push(roomName);
    saveRooms(rooms);
    io.emit("roomList", rooms);
  }, ANY_PAYLOAD);

  on("joinRoom", (roomName) => {
    if (!rooms.includes(roomName)) {
      socket.emit("roomError", { message: "No such room" });
      return;
    }

    socket.to(socket.data.currentRoom).emit("userStoppedTyping", { username: socket.data.username });

    const previousRoom = socket.data.currentRoom;
    socket.leave(previousRoom);
    socket.data.currentRoom = roomName;
    socket.join(roomName);

    socket.emit("roomMessages", {
      room: roomName,
      messages: messages.filter((m) => m.room === roomName),
    });

    broadcastRoomUsers(previousRoom);
    broadcastRoomUsers(roomName);
  }, ANY_PAYLOAD);

  on("sendMessage", (message) => {
    if (!checkRateLimit()) return;
    if (!isValidMessage(message)) return;
    if (message.image && !claimUpload(message.image, socket.data.username)) return;

    const room = socket.data.currentRoom;

    const safeMessage = {
      id: uuidv4(),
      room,
      username: socket.data.username,
      text: message.text.trim().slice(0, MAX_TEXT_LENGTH),
      image: message.image || null,
      timestamp: new Date().toISOString(),
    };

    messages.push(safeMessage);
    trimRoomHistory(room);
    saveMessages(messages);

    io.to(room).emit("receiveMessage", safeMessage);
  }, ANY_PAYLOAD);

  on("editMessage", ({ id, text }) => {
    if (!checkRateLimit()) return;
    if (typeof id !== "string") return;

    const existing = messages.find((m) => m.id === id);
    // Ownership is checked server-side from the authenticated socket, never
    // trusted from the client, so a user can only ever edit their own messages.
    if (!existing || existing.username !== socket.data.username) return;
    if (!isValidMessage({ text, image: existing.image })) return;

    existing.text = text.trim().slice(0, MAX_TEXT_LENGTH);
    existing.edited = true;
    saveMessages(messages);

    io.to(existing.room).emit("messageEdited", existing);
  });

  on("deleteMessage", ({ id }) => {
    if (!checkRateLimit()) return;
    if (typeof id !== "string") return;

    const existing = messages.find((m) => m.id === id);
    if (!existing || existing.username !== socket.data.username) return;

    messages = messages.filter((m) => m.id !== id);
    saveMessages(messages);

    if (existing.image) releaseImage(existing.image);

    io.to(existing.room).emit("messageDeleted", { id, room: existing.room });
  });

  on("toggleReaction", ({ id, emoji }) => {
    if (!checkRateLimit()) return;
    if (typeof id !== "string") return;
    if (typeof emoji !== "string" || emoji.length === 0 || emoji.length > 8) return;

    const existing = messages.find((m) => m.id === id);
    if (!existing) return;

    existing.reactions = toggleReaction(existing.reactions, emoji, socket.data.username);
    saveMessages(messages);

    io.to(existing.room).emit("reactionUpdated", { id: existing.id, reactions: existing.reactions });
  });

  on("disconnect", () => {
    socket.to(socket.data.currentRoom).emit("userStoppedTyping", { username: socket.data.username });
    broadcastRoomUsers(socket.data.currentRoom);
  }, ANY_PAYLOAD);

  on("typing", () => {
    socket.to(socket.data.currentRoom).emit("userTyping", { username: socket.data.username });
  }, ANY_PAYLOAD);

  on("stopTyping", () => {
    socket.to(socket.data.currentRoom).emit("userStoppedTyping", { username: socket.data.username });
  }, ANY_PAYLOAD);
});

server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
