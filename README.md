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

### 1. Server Setup

```bash
cd server
npm install express socket.io cors multer
node index.js
```

### 2. Client setup

```bash
cd client
npm install react react-dom socket.io-client emoji-picker-react uuid
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
