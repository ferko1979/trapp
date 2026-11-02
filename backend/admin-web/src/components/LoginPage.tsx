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
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "#0B1626",
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleLogin();
        }}
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "28px 26px",
          background: "#FFFFFF",
          border: "1px solid #DCE4EE",
          borderRadius: 16,
          boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l10 17H2z" fill="#38D3F2" />
          </svg>
          <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: "0.04em" }}>TRAPP</span>
          <span className="lbl" style={{ marginLeft: "auto", color: "#0B6C86" }}>
            Admin Console
          </span>
        </div>
        <p style={{ margin: "2px 0 6px" }}>Sign in with your admin email and password.</p>

        <input
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ height: 42 }}
        />

        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ height: 42 }}
        />

        <button type="submit" className="btn-primary" style={{ width: "100%", height: 42 }}>
          Log in
        </button>

        {error ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "#FDE7EA",
              color: "#C8283B",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
