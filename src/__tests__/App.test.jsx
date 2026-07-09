import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../App.jsx";

// Chat has its own test file and its own socket.io mocking — stub it here so
// App's tests stay focused on login/register/session behavior.
vi.mock("../components/Chat.jsx", () => ({
  default: ({ username, onLogout }) => (
    <div>
      <p>Logged in as {username}</p>
      <button onClick={onLogout}>Logout</button>
    </div>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("shows the login form by default", () => {
    render(<App />);
    expect(screen.getByText("Login to Chat")).toBeInTheDocument();
  });

  it("switches to the registration form and back", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Need an account? Register"));
    expect(screen.getByText("Create an account")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Already have an account? Login"));
    expect(screen.getByText("Login to Chat")).toBeInTheDocument();
  });

  it("logs in and renders Chat on success, persisting the session", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "fake-token", username: "alice" }),
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(screen.getByText("Logged in as alice")).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("chatAuth"))).toEqual({ token: "fake-token", username: "alice" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows the server's error message when login fails", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Invalid username or password" }),
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(screen.getByText("Invalid username or password")).toBeInTheDocument());
    expect(localStorage.getItem("chatAuth")).toBeNull();
  });

  it("restores an existing session from localStorage without showing the login form", () => {
    localStorage.setItem("chatAuth", JSON.stringify({ token: "t", username: "bob" }));
    render(<App />);
    expect(screen.getByText("Logged in as bob")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs out, clears the stored session, and returns to the login form", async () => {
    localStorage.setItem("chatAuth", JSON.stringify({ token: "t", username: "bob" }));
    render(<App />);

    fireEvent.click(screen.getByText("Logout"));

    expect(localStorage.getItem("chatAuth")).toBeNull();
    expect(await screen.findByText("Login to Chat")).toBeInTheDocument();
  });
});
