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
    expect(mockSocket.on).toHaveBeenCalledWith("initialMessages", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("receiveMessage", expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith("rateLimitExceeded", expect.any(Function));
  });

  it("renders messages received via initialMessages", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.initialMessages([
        { id: "1", username: "bob", text: "hi there", image: null, timestamp: "2026-01-01T00:00:00.000Z" },
      ]);
    });
    expect(screen.getByText(/hi there/)).toBeInTheDocument();
  });

  it("appends messages received live via receiveMessage", () => {
    render(<Chat username="alice" token="tok-123" onLogout={vi.fn()} />);
    act(() => {
      handlers.initialMessages([]);
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
      handlers.initialMessages([
        { id: "3", username: "bob", text: "", image: "/uploads/photo.png", timestamp: "2026-01-01T00:00:00.000Z" },
      ]);
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
