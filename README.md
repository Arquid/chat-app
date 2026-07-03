# React Real-Time Chat App

A modern, real-time chat application built with **React**, **Socket.io**, and **Node.js/Express**. Supports emojis, image uploads with preview, auto-scrolling, and robust error handling.

## Features

- **Real-time messaging** with multiple users via Socket.io  
- **Emoji picker** integration (`emoji-picker-react`)  
- **Image uploads** (JPEG, PNG, WEBP) with live preview, loading indicator, and error handling  
- **Automatic scrolling** to newest messages  
- **Unique message IDs** to prevent duplicate keys  
- Simple **login system** using a username  
- Socket connection handling: connect, disconnect, and error alerts  

## Prerequisites

- Node.js >= 18  
- npm or yarn  

## Installation

This is a single project with both the client (`src/`) and server (`server/`) in the same `package.json`.

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

| Variable | Used by | Description |
|---|---|---|
| `PORT` | server | Port the Express/Socket.io server listens on (default `5000`) |
| `CLIENT_ORIGIN` | server | Allowed CORS origin for HTTP and Socket.io requests (default `http://localhost:5173`) |
| `VITE_SERVER_URL` | client | Base URL the browser uses to reach the server (default `http://localhost:5000`) |

### Run

```bash
# Terminal 1 - server
node server/index.js

# Terminal 2 - client
npm run dev
```

## Usage

1. Open the app in your browser
2. Enter a username and click Login
3. Type a message and press Enter or click Send
4. Click 😀 to open the emoji picker and select emojis
5. Click 📎 to select an image
6. Images show preview, and a loading indicator appears while uploading
7. Upload errors are displayed in red below the input
