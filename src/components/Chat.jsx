import { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import Picker from "emoji-picker-react";
import { v4 as uuidv4 } from "uuid";

function Chat({ username }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  const socketRef = useRef(null);
  const emojiPickerRef = useRef(null);

  const MAX_FILE_SIZE = 2 * 1024 * 1024;
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  // --- Socket.io setup ---
  useEffect(() => {
    socketRef.current = io("http://localhost:5000", {
      reconnectionAttempts: 5,
      timeout: 5000,
    });

    socketRef.current.on("connect", () => {
      console.log("Connected to server:", socketRef.current.id);
    });

    socketRef.current.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      alert("Failed to connect to chat server. Please refresh.");
    });

    socketRef.current.on("disconnect", (reason) => {
      console.log("Disconnected:", reason);
    });

    socketRef.current.on("initialMessages", (messages) => setMessages(messages));
    socketRef.current.on("receiveMessage", (message) => setMessages((prev) => [...prev, message]));

    return () => {
      socketRef.current.disconnect();
    };
  }, []);

  // --- Scroll to bottom ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Emoji picker click outside ---
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

  // --- Add emoji to message ---
  const onEmojiClick = (emoji) => {
    setMessage((prev) => prev + emoji.emoji);
  };

  // --- Handle file upload ---
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

  // --- Upload image to server ---
  const uploadImage = async (file) => {
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("http://localhost:5000/upload", {
        method: "POST",
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

  // --- Send message ---
  const sendMessage = async () => {
    if (!message.trim() && !image) return;

    let imageUrl = null;
    if (image) {
      imageUrl = await uploadImage(image);
      if (!imageUrl) return;
    }

    const msgData = {
      id: uuidv4(),
      username,
      text: message,
      image: imageUrl,
      timestamp: new Date().toISOString(),
    };

    socketRef.current.emit("sendMessage", msgData);

    setMessage("");
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setShowEmojiPicker(false);
  };

  return (
    <div className="chat">
      <h2>Chat</h2>
      <div className="messages">
        {messages.map((msg) => (
          <div key={msg.id} className="message">
            <strong>{msg.username}</strong>: {msg.text}
            {msg.image && <img src={msg.image} alt="Uploaded" className="sent-image" />}
            {msg.timestamp && (
              <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="emoji-picker">
          <Picker onEmojiClick={onEmojiClick} />
        </div>
      )}

      <div className="input-area">
        <button
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
          onChange={(e) => setMessage(e.target.value)}
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
        <button onClick={() => fileInputRef.current.click()}>📎</button>
        <button onClick={sendMessage} disabled={uploading}>
          Send
        </button>
      </div>

      {uploading && <p>Uploading image...</p>}
      {uploadError && <p style={{ color: "red" }}>{uploadError}</p>}

      {imagePreview && (
        <div className="preview">
          <h4>Image Preview:</h4>
          <img src={imagePreview} alt="Preview" className="sent-image" />
        </div>
      )}
    </div>
  );
}

export default Chat;