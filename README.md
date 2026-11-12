# React Real-Time Chat App

[![CI](https://github.com/Arquid/chat-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Arquid/chat-app/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-339933?logo=node.js&logoColor=white)](package.json)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](package.json)
[![Vitest](https://img.shields.io/badge/tested%20with-vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)

A real-time, multi-room chat application built with **React**, **Socket.io**, and **Node.js/Express** — user accounts with hashed passwords and JWT sessions, chat rooms, image uploads, emoji reactions, rate limiting, and persistent history.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)

## Features

- **Real-time messaging** with multiple users via Socket.io
- **Rooms** — join the default `general` room or create your own; each room keeps its own history and only members of a room see its messages
- **Online presence** — see who's currently in the room with you, updated live as people join, switch rooms, or disconnect
- **"X is typing..." indicator** — per-room, self-clearing after a pause or when the message is sent
- **User accounts** — registration and login with hashed passwords (bcrypt) and JWT-based sessions
- **Image uploads** (JPEG, PNG, WEBP, max 2MB) with live preview and loading indicator
- **Emoji picker** integration (`emoji-picker-react`) for composing messages and reacting to them
- **Emoji reactions** — react to any message with any emoji; click an existing reaction to add or remove your own, counts and your own highlighted reactions update live for everyone in the room
- **Rate limiting** on login/register, uploads, room creation, and outgoing messages to curb abuse
- **Persistent history** — the last 200 messages per room survive a server restart
- **Edit and delete your own messages** — ownership is checked server-side, so a message can only ever be changed or removed by the person who sent it; deleting an image message also removes the uploaded file
- Server-side validation of usernames, room names, and message content — the server, not the client, decides who sent what
- Auto-scrolling to the newest message, connection/disconnection handling, and self-dismissing error/warning banners

## Tech stack

| | |
|---|---|
| Client | React 19, Vite |
| Server | Node.js, Express 5, Socket.io |
| HTTP hardening | `helmet` security headers, one central error handler (`server/index.js`) |
| Auth | JWT (`jsonwebtoken`), password hashing (`bcryptjs`) |
| Uploads | `multer` |
| Rate limiting | `express-rate-limit` for HTTP + a custom per-user sliding-window limiter (`server/rateLimiter.js`) for socket events |
| Testing | Vitest, React Testing Library |
| CI | GitHub Actions (lint, test, build on every push/PR to `main`) |

## Project structure

This is a single project — both the client (`src/`) and the server (`server/`) share one `package.json`.

```
src/
  App.jsx                  Login / register screen, session handling
  components/Chat.jsx      Chat UI: rooms sidebar, messages, composer
  __tests__/                App-level tests
  components/__tests__/     Chat component tests

server/
  index.js          Express + Socket.io server
  users.js          Registration/login, password hashing, JWT helpers
  users.json         User store (created at runtime, not committed)
  rooms.js          Room list persistence
  rooms.json         Room store (created at runtime, not committed)
  messages.js       Chat history persistence
  messages.json      Chat history store (created at runtime, not committed)
  uploads.js        Upload registry (who uploaded which image)
  uploads.json       Upload registry store (created at runtime, not committed)
  rateLimiter.js    Per-user sliding-window rate limiter used for messages and room creation
  roomOwners.js     Room ownership store (who created which room, for the per-user room quota)
  roomOwners.json    Room ownership data (created at runtime, not committed)
  reactions.js      Reaction toggling that is safe for client-supplied keys
  safeHandler.js    Wrapper that keeps a malformed socket message from crashing the server
  validation.js     Shared input validation (username, password, room, message, image path)
  errors.js         UserError: the only kind of error whose message is shown to the client
  paths.js          Where data files and uploads live (the repository, or DATA_DIR), independent of the working directory
  __tests__/        Server-side unit and integration tests (the integration tests start the real server)

uploads/             Uploaded images (not committed)
```

## Prerequisites

- Node.js >= 20.12 (Vite 8's rolldown bundler requires `node:util`'s `styleText`, unavailable on Node 18)
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
| `NODE_ENV` | server | Set to `production` when deploying (`.env.example` does). Error responses never include stack traces or file paths, whatever its value |
| `DATA_DIR` | server | Optional. Directory that holds `server/*.json` and `uploads/`. Defaults to the repository root, so the server can be started from any directory. Relative paths are resolved against the working directory |

### Run

```bash
# Terminal 1 - server (works from any directory; data stays in the repository unless DATA_DIR is set)
node server/index.js

# Terminal 2 - client
npm run dev
```

### Tests

```bash
npm test           # run once
npm run test:watch # watch mode
```

Covers server-side auth/validation/persistence logic (`server/__tests__/`) and client-side login/register/chat/room behavior (`src/__tests__/`, `src/components/__tests__/`), using [Vitest](https://vitest.dev/) and [React Testing Library](https://testing-library.com/react). `server/__tests__/hardening.integration.test.js` starts the real server as a child process and checks that malformed client messages cannot crash it, that uploads cannot be claimed by other users, and that concurrent registrations are all saved. `server/__tests__/httpHardening.integration.test.js` checks the security headers, that errors never expose stack traces or file paths, and that the server keeps its files in `DATA_DIR` whatever directory it was started from. The integration tests always start the server from an empty working directory and a temporary `DATA_DIR`, so they never touch your real `server/*.json` files.

Lint, an audit of the production dependencies (`npm audit --omit=dev --audit-level=high`), tests, and build run automatically on every push and pull request to `main` via GitHub Actions (see `.github/workflows/ci.yml`, tested against Node 20.x and 22.x). Dependabot opens weekly update PRs.

## Usage

1. Open the app in your browser and register an account (username 3-20 characters, password 8+ characters), or log in if you already have one
2. You land in the `general` room — pick a different one from the sidebar or create a new one (room names: 2-30 characters); the header shows everyone currently in the room, including you
3. Type a message and press Enter or click Send — everyone else in the room briefly sees your username with an "is typing..." notice while you compose it
4. Click 😀 to open the emoji picker and select emojis
5. Click 📎 to attach an image — a preview appears before sending
6. Click ☺+ under any message to react with an emoji, or click an existing reaction to toggle your own
7. Your own messages show Edit/Delete links — edits show an "(edited)" tag, deletes ask for confirmation first
8. Click Logout to end your session

## Security notes

- Passwords are hashed with bcrypt; plaintext passwords are never stored
- Message identity (`username`) is assigned server-side from the JWT, not trusted from the client
- Uploaded files are renamed to a random ID + validated extension — the original filename is never used
- A message can only attach an image its sender uploaded themselves, and each upload can be attached once; deleting a message removes only its own image file
- Socket event handlers ignore malformed payloads (null, wrong types, keys such as `toString`) instead of throwing, so one bad client message cannot take the server down for everyone
- User registration saves accounts atomically, so simultaneous signups cannot overwrite each other
- A failed login costs one bcrypt comparison and gives the same answer whether the username exists or not, so response timing does not reveal which usernames are registered (registration still reports names that are taken)
- Responses carry security headers (`helmet`: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, ...) and do not announce the framework (`X-Powered-By` is removed). Uploaded images are served with `Cross-Origin-Resource-Policy: cross-origin` so the client on another port can display them
- Errors are answered with short JSON messages. Only expected errors (`UserError`: username taken, wrong password) show their own message; broken JSON gets `400 Invalid JSON`, an oversized body `413`, an unknown route a JSON `404`, and anything unexpected (such as a damaged `users.json`) a generic `500 Internal server error` while the details go to the server log only. A failing user store is therefore never reported as "username taken" or "wrong password"
- Login/register are rate-limited (10 requests / 15 min / IP) to slow down brute-force attempts
- Sending, editing, deleting and reacting share one budget per user across all of their connections (5 per 10 s), and a user can have at most 5 simultaneous connections (a sixth is refused with "Too many connections")
- Room creation is limited to 3 per minute and 5 rooms per user (50 in total), so one user cannot fill every room slot

## Known limitations

- JWTs cannot be revoked server-side; logging out only discards the token on the client, it stays valid until it expires (7 days)
- Chat history, rooms, and user accounts are stored as JSON files on disk rather than in a real database — this survives a server restart but won't hold up under concurrent writes at higher traffic
- Rooms cannot be deleted, and there is no per-room access control or moderation. Rooms created before the per-user quota existed (such as `general`) have no owner and count toward nobody's quota
- The rate limits are kept in memory, so they reset when the server restarts and would not be shared between several server processes
