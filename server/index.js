import "dotenv/config";
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { registerUser, loginUser, verifyToken } from "./users.js";

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const MAX_TEXT_LENGTH = 2000;
const MAX_HISTORY = 200;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

let messages = [];

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;

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

app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || !USERNAME_REGEX.test(username)) {
    return res.status(400).json({ error: "Username must be 3-20 characters (letters, numbers, _ or -)" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const token = await registerUser(username, password);
    res.json({ token, username });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

app.post("/auth/login", async (req, res) => {
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

app.post("/upload", authenticate, (req, res) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

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

function isValidMessage(message) {
  return (
    message &&
    typeof message.text === "string" &&
    message.text.length <= MAX_TEXT_LENGTH &&
    (message.text.trim().length > 0 || typeof message.image === "string") &&
    (message.image === null || message.image === undefined || typeof message.image === "string")
  );
}

io.on('connection', (socket) => {
  socket.emit("initialMessages", messages);

  socket.on("sendMessage", (message) => {
    if (!isValidMessage(message)) return;

    const safeMessage = {
      id: uuidv4(),
      username: socket.data.username,
      text: message.text.trim().slice(0, MAX_TEXT_LENGTH),
      image: message.image || null,
      timestamp: new Date().toISOString(),
    };

    messages.push(safeMessage);
    if (messages.length > MAX_HISTORY) {
      messages = messages.slice(-MAX_HISTORY);
    }

    io.emit("receiveMessage", safeMessage);
  });
});

server.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});
