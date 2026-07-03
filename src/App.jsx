import { useState } from "react";
import Chat from "./components/Chat";

function App() {
  const [username, setUsername] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleLogin = () => {
    if (username.trim() !== "") {
      setIsLoggedIn(true);
    }
  };

  return (
    <div className="App">
      {!isLoggedIn ? (
        <div>
          <h2>Login to Chat</h2>
          <input
            type="text"
            placeholder="Enter your username"
            value={username}
            maxLength={50}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />
          <button onClick={handleLogin}>Login</button>
        </div>
      ) : (
        <Chat username={username} />
      )}
    </div>
  );
}

export default App;