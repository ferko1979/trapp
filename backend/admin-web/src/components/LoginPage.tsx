import { useState } from "react";
import { loginWithEmail } from "../auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleLogin() {
    try {
      setError("");
      await loginWithEmail(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    }
  }

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "80px auto",
        padding: 24,
        background: "#1e293b",
        borderRadius: 12,
      }}
    >
      <h1>Trap Admin</h1>
      <p>Sign in with your admin email and password.</p>

      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 12, marginBottom: 12, borderRadius: 8 }}
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 12, marginBottom: 12, borderRadius: 8 }}
      />

      <button
        onClick={() => void handleLogin()}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 8,
          border: "none",
          background: "#22c55e",
          color: "#052e16",
          fontWeight: 700,
        }}
      >
        Log in
      </button>

      {error ? (
        <div style={{ marginTop: 12, color: "#fca5a5" }}>{error}</div>
      ) : null}
    </div>
  );
}
