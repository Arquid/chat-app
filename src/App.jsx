import { useState } from "react";
import Chat from "./components/Chat";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:5000";

function App() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [auth, setAuth] = useState(() => {
    const stored = localStorage.getItem("chatAuth");
    return stored ? JSON.parse(stored) : null;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(`${SERVER_URL}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong");

      const newAuth = { token: data.token, username: data.username };
      localStorage.setItem("chatAuth", JSON.stringify(newAuth));
      setAuth(newAuth);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("chatAuth");
    setAuth(null);
  };

  if (auth) {
    return <Chat username={auth.username} token={auth.token} onLogout={handleLogout} />;
  }

  return (
    <div className="App">
      <h2>{mode === "login" ? "Login to Chat" : "Create an account"}</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          maxLength={20}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {mode === "login" ? "Login" : "Register"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError("");
        }}
      >
        {mode === "login" ? "Need an account? Register" : "Already have an account? Login"}
      </button>
    </div>
  );
}

export default App;
