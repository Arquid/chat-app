import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Chat from "../Chat.jsx";

const handlers = {};
const mockSocket = {
  on: vi.fn((event, cb) => {
    handlers[event] = cb;
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("socket.io-client", () => ({
  default: vi.fn(() => mockSocket),
}));

beforeEach(() => {
  mockSocket.on.mockClear();
  mockSocket.emit.mockClear();
  mockSocket.disconnect.mockClear();
  for (const key of Object.keys(handlers)) delete handlers[key];
});

describe("Chat", () => {
  it("connects to the socket with the auth token and registers listeners", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    expect(mockSocket.on).toHaveBeenCalledWith("roomList", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("roomMessages", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("roomError", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("receiveMessage", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("rateLimitExceeded", expect.any(Function));
  });

  it("renders messages received via roomMessages", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomMessages({
        room: "general",
        messages: [
          { id: "1", username: "bob", text: "hi there", image: null, timestamp: "2026-01-01T00:00:00.000Z" },
        ],
      });
    });
    expect(screen.getByText(/hi there/)).toBeInTheDocument();
  });

  it("appends messages received live via receiveMessage", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomMessages({ room: "general", messages: [] });
      handlers.receiveMessage({
        id: "2",
        username: "alice",
        text: "new message",
        image: null,
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    });
    expect(screen.getByText(/new message/)).toBeInTheDocument();
  });

  it("prefixes image messages with the server URL", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomMessages({
        room: "general",
        messages: [
          { id: "3", username: "bob", text: "", image: "/uploads/photo.png", timestamp: "2026-01-01T00:00:00.000Z" },
        ],
      });
    });
    const img = screen.getByAltText("Uploaded");
    expect(img.src).toBe("http://localhost:5000/uploads/photo.png");
  });

  it("does not emit sendMessage when the input is empty and no image is attached", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByText("Send"));
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it("emits sendMessage with the typed text and clears the input afterwards", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    const input = screen.getByPlaceholderText("Type a message...");

    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.click(screen.getByText("Send"));

    expect(mockSocket.emit).toHaveBeenCalledWith("sendMessage", { text: "hello world", image: null });
    expect(input.value).toBe("");
  });

  it("sends on Enter as well as on the Send button", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    const input = screen.getByPlaceholderText("Type a message...");

    fireEvent.change(input, { target: { value: "via enter" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockSocket.emit).toHaveBeenCalledWith("sendMessage", { text: "via enter", image: null });
  });

  it("shows the rate-limit message from the server", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.rateLimitExceeded({ message: "You're sending messages too fast" });
    });
    expect(screen.getByText("You're sending messages too fast")).toBeInTheDocument();
  });

  it("clears the rate-limit message on its own after a few seconds", () => {
    vi.useFakeTimers();
    try {
      render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
      act(() => {
        handlers.rateLimitExceeded({ message: "You're sending messages too fast" });
      });
      expect(screen.getByText("You're sending messages too fast")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText("You're sending messages too fast")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onLogout when the Logout button is clicked", () => {
    const onLogout = vi.fn();
    render(<Chat username="alice" token="tok-123" onLogout={onLogout} />);
    fireEvent.click(screen.getByText("Logout"));
    expect(onLogout).toHaveBeenCalled();
  });

  it("disconnects the socket on unmount", () => {
    const { unmount } = render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});

describe("Rooms", () => {
  it("defaults to the general room and shows it in the header", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    expect(screen.getByText("Chat — #general — alice")).toBeInTheDocument();
  });

  it("renders the room list received via roomList", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomList(["general", "random", "tech"]);
    });
    expect(screen.getByText("# general")).toBeInTheDocument();
    expect(screen.getByText("# random")).toBeInTheDocument();
    expect(screen.getByText("# tech")).toBeInTheDocument();
  });

  it("emits joinRoom when clicking a different room", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomList(["general", "random"]);
    });

    fireEvent.click(screen.getByText("# random"));

    expect(mockSocket.emit).toHaveBeenCalledWith("joinRoom", "random");
  });

  it("does not emit joinRoom when clicking the already-active room", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomList(["general", "random"]);
    });

    fireEvent.click(screen.getByText("# general"));

    expect(mockSocket.emit).not.toHaveBeenCalledWith("joinRoom", expect.anything());
  });

  it("switches the displayed room and messages when roomMessages arrives", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomMessages({
        room: "random",
        messages: [
          { id: "1", username: "bob", text: "in random", image: null, timestamp: "2026-01-01T00:00:00.000Z" },
        ],
      });
    });

    expect(screen.getByText("Chat — #random — alice")).toBeInTheDocument();
    expect(screen.getByText(/in random/)).toBeInTheDocument();
  });

  it("emits createRoom with the trimmed name and clears the input", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    const input = screen.getByPlaceholderText("New room name");

    fireEvent.change(input, { target: { value: "  gaming  " } });
    fireEvent.click(screen.getByText("+ Create"));

    expect(mockSocket.emit).toHaveBeenCalledWith("createRoom", "gaming");
    expect(input.value).toBe("");
  });

  it("does not emit createRoom for a blank name", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByText("+ Create"));
    expect(mockSocket.emit).not.toHaveBeenCalledWith("createRoom", expect.anything());
  });

  it("shows a room error from the server", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.roomError({ message: "Room already exists" });
    });
    expect(screen.getByText("Room already exists")).toBeInTheDocument();
  });

  it("clears the room error on its own after a few seconds", () => {
    vi.useFakeTimers();
    try {
      render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
      act(() => {
        handlers.roomError({ message: "Room already exists" });
      });
      expect(screen.getByText("Room already exists")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByText("Room already exists")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
