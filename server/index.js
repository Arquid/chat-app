import "dotenv/config";
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const MAX_USERNAME_LENGTH = 50;
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

app.post("/upload", (req, res) => {
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

function isValidMessage(message) {
  return (
    message &&
    typeof message.username === "string" &&
    message.username.trim().length > 0 &&
    message.username.length <= MAX_USERNAME_LENGTH &&
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
      username: message.username.trim().slice(0, MAX_USERNAME_LENGTH),
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
