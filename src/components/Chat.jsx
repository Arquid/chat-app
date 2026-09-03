import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import Picker from "emoji-picker-react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

function Chat({ username, token, onLogout }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [rooms, setRooms] = useState(["general"]);
  const [currentRoom, setCurrentRoom] = useState("general");
  const [newRoomName, setNewRoomName] = useState("");
  const [roomError, setRoomError] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const [roomUsers, setRoomUsers] = useState([]);

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const socketRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_TEXT_LENGTH = 2000;
  const ERROR_DISPLAY_MS = 4000;
  const TYPING_TIMEOUT_MS = 2000;

  useEffect(() => {
    socketRef.current = io(SERVER_URL, {
      auth: { token },
      reconnectionAttempts: 5,
      timeout: 5000,
    });

    socketRef.current.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      if (err.message === "Authentication required" || err.message === "Invalid or expired token") {
        alert("Your session has expired. Please log in again.");
        onLogout();
        return;
      }
      alert("Failed to connect to chat server. Please refresh.");
    });

    socketRef.current.on("roomList", (roomList) => setRooms(roomList));
    socketRef.current.on("roomMessages", ({ room, messages }) => {
      setCurrentRoom(room);
      setMessages(messages);
      setTypingUsers([]);
      setRoomUsers([]);
    });
    socketRef.current.on("roomUsers", ({ users }) => setRoomUsers(users));
    socketRef.current.on("roomError", (data) => setRoomError(data.message));
    socketRef.current.on("userTyping", ({ username: typingUsername }) => {
      setTypingUsers((prev) => (prev.includes(typingUsername) ? prev : [...prev, typingUsername]));
    });
    socketRef.current.on("userStoppedTyping", ({ username: typingUsername }) => {
      setTypingUsers((prev) => prev.filter((u) => u !== typingUsername));
    });
    socketRef.current.on("receiveMessage", (message) => setMessages((prev) => [...prev, message]));
    socketRef.current.on("rateLimitExceeded", (data) => {
      setUploadError(data.message);
    });

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      socketRef.current.disconnect();
    };
  }, [token, onLogout]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!uploadError) return;
    const timer = setTimeout(() => setUploadError(""), ERROR_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [uploadError]);

  useEffect(() => {
    if (!roomError) return;
    const timer = setTimeout(() => setRoomError(""), ERROR_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [roomError]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [showEmojiPicker]);

  const onEmojiClick = (emoji) => {
    setMessage((prev) => prev + emoji.emoji);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      alert("Only JPEG, PNG, and WEBP images are allowed.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      alert("File size must be less than 2MB.");
      return;
    }

    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    const previewUrl = URL.createObjectURL(file);

    setImage(file);
    setImagePreview(previewUrl);
    setUploadError("");
  };

  const uploadImage = async (file) => {
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch(`${SERVER_URL}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Image upload failed: ${text}`);
      }

      const data = await response.json();
      return data.imageUrl;
    } catch (error) {
      console.error("Error uploading image:", error);
      setUploadError(error.message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = async () => {
    if (!message.trim() && !image) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    socketRef.current.emit("stopTyping");

    let imageUrl = null;
    if (image) {
      imageUrl = await uploadImage(image);
      if (!imageUrl) return;
    }

    const msgData = {
      text: message,
      image: imageUrl,
    };

    socketRef.current.emit("sendMessage", msgData);

    setMessage("");
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setShowEmojiPicker(false);
  };

  const switchRoom = (room) => {
    if (room === currentRoom) return;
    socketRef.current.emit("joinRoom", room);
  };

  const createRoom = (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    setRoomError("");
    socketRef.current.emit("createRoom", newRoomName.trim());
    setNewRoomName("");
  };

  const handleMessageChange = (e) => {
    setMessage(e.target.value);

    socketRef.current.emit("typing");

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current.emit("stopTyping");
    }, TYPING_TIMEOUT_MS);
  };

  return (
    <div className="chat">
      <div className="rooms-sidebar">
        <h3>Rooms</h3>
        <ul>
          {rooms.map((room) => (
            <li key={room}>
              <button
                className={room === currentRoom ? "active-room" : ""}
                onClick={() => switchRoom(room)}
              >
                # {room}
              </button>
            </li>
          ))}
        </ul>
        <form className="create-room-form" onSubmit={createRoom}>
          <input
            type="text"
            placeholder="New room name"
            value={newRoomName}
            maxLength={30}
            onChange={(e) => setNewRoomName(e.target.value)}
          />
          <button type="submit">+ Create</button>
        </form>
        {roomError && <p className="error-text">{roomError}</p>}
      </div>

      <div className="chat-main">
        <div className="chat-header">
          <h2>Chat — #{currentRoom} — {username}</h2>
          <button className="logout-button" onClick={onLogout}>Logout</button>
        </div>
        <div className="room-users">
          <span className="online-dot" aria-hidden="true" />
          <strong>Online ({roomUsers.length}):</strong> {roomUsers.join(", ")}
        </div>
        <div className="messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.username === username ? "own-message" : "other-message"}`}
            >
              <div className="message-avatar" aria-hidden="true">
                {msg.username.charAt(0).toUpperCase()}
              </div>
              <div className="message-bubble">
                <div className="message-meta">
                  <strong>{msg.username}</strong>
                  {msg.timestamp && (
                    <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  )}
                </div>
                {msg.text && <div className="message-text">{msg.text}</div>}
                {msg.image && (
                  <img src={`${SERVER_URL}${msg.image}`} alt="Uploaded" className="sent-image" />
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {typingUsers.length > 0 && (
          <p className="typing-indicator">
            {typingUsers.length === 1
              ? `${typingUsers[0]} is typing...`
              : `${typingUsers.join(", ")} are typing...`}
          </p>
        )}
        {showEmojiPicker && (
          <div ref={emojiPickerRef} className="emoji-picker">
            <Picker onEmojiClick={onEmojiClick} />
          </div>
        )}

        <div className="input-area">
          <button
            className="icon-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowEmojiPicker((prev) => !prev);
            }}
          >
            😀
          </button>

          <input
            type="text"
            placeholder="Type a message..."
            value={message}
            maxLength={MAX_TEXT_LENGTH}
            onChange={handleMessageChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
          />

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button className="icon-button" onClick={() => fileInputRef.current.click()}>📎</button>
          <button className="send-button" onClick={sendMessage} disabled={uploading}>
            Send
          </button>
        </div>

        {uploading && <p className="status-text">Uploading image...</p>}
        {uploadError && <p className="error-text">{uploadError}</p>}

        {imagePreview && (
          <div className="preview">
            <h4>Image Preview:</h4>
            <img src={imagePreview} alt="Preview" className="sent-image" />
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;