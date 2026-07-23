# React Real-Time Chat App

[![CI](https://github.com/Arquid/chat-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Arquid/chat-app/actions/workflows/ci.yml)

A real-time chat application built with **React**, **Socket.io**, and **Node.js/Express**. Supports user accounts, image uploads, emoji reactions, and rate-limited messaging.

## Features

- **Real-time messaging** with multiple users via Socket.io
- **User accounts** — registration and login with hashed passwords (bcrypt) and JWT-based sessions
- **Image uploads** (JPEG, PNG, WEBP, max 2MB) with live preview and loading indicator
- **Emoji picker** integration (`emoji-picker-react`)
- **Rate limiting** on login/register, uploads, and outgoing messages to curb abuse
- **Persistent chat history** — the last 200 messages survive a server restart
- Server-side validation of message length and content — the server, not the client, decides who sent what
- Automatic scrolling to the newest message, connection/disconnection handling, and error alerts

## Tech stack

| | |
|---|---|
| Client | React 19, Vite |
| Server | Node.js, Express 5, Socket.io |
| Auth | JWT (`jsonwebtoken`), password hashing (`bcryptjs`) |
| Uploads | `multer` |
| Rate limiting | `express-rate-limit` + a custom per-socket limiter for messages |

## Project structure

This is a single project — both the client (`src/`) and the server (`server/`) share one `package.json`.

```
src/            React client (Vite)
  __tests__/            App-level tests
  components/__tests__/ Chat component tests
server/
  index.js      Express + Socket.io server
  users.js      User registration/login, password hashing, JWT helpers
  users.json    User store (created at runtime, not committed)
  messages.js   Chat history persistence
  messages.json Chat history store (created at runtime, not committed)
  validation.js Shared input validation (username, password, message)
  __tests__/    Server-side tests
uploads/        Uploaded images (not committed)
```

## Prerequisites

- Node.js >= 18
- npm

## Getting started

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Used by | Description |
|---|---|---|
| `PORT` | server | Port the Express/Socket.io server listens on (default `5000`) |
| `CLIENT_ORIGIN` | server | Allowed CORS origin for HTTP and Socket.io requests (default `http://localhost:5173`) |
| `VITE_SERVER_URL` | client | Base URL the browser uses to reach the server (default `http://localhost:5000`) |
| `JWT_SECRET` | server | Secret used to sign session tokens. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Run

```bash
# Terminal 1 - server
node server/index.js

# Terminal 2 - client
npm run dev
```

### Tests

```bash
npm test          # run once
npm run test:watch # watch mode
```

Covers server-side auth/validation/persistence logic (`server/__tests__/`) and client-side login/register and chat behavior (`src/__tests__/`, `src/components/__tests__/`), using [Vitest](https://vitest.dev/) and [React Testing Library](https://testing-library.com/react).

Lint, tests, and build run automatically on every push and pull request to `main` via GitHub Actions (see `.github/workflows/ci.yml`, tested against Node 18.x and 20.x).

## Usage

1. Open the app in your browser and register an account (username 3-20 characters, password 8+ characters), or log in if you already have one
2. Type a message and press Enter or click Send
3. Click 😀 to open the emoji picker and select emojis
4. Click 📎 to attach an image — a preview appears before sending
5. Click Logout to end your session

## Security notes

- Passwords are hashed with bcrypt; plaintext passwords are never stored
- Message identity (`username`) is assigned server-side from the JWT, not trusted from the client
- Uploaded files are renamed to a random ID + validated extension — the original filename is never used
- Login/register are rate-limited (10 requests / 15 min / IP) to slow down brute-force attempts
- Outgoing chat messages are rate-limited per connection (5 messages / 10s)

## Known limitations

- JWTs cannot be revoked server-side; logging out only discards the token on the client, it stays valid until it expires (7 days)
- Chat history (last 200 messages) and user accounts are stored as JSON files on disk rather than in a real database — this survives a server restart but won't hold up under concurrent writes at higher traffic
