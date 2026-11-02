import { useState } from "react";

export default function PaymentCancelPage() {
  const [closing, setClosing] = useState(false);

  function tryAgain() {
    // Signal the app to re-open checkout; fall back to deep link
    window.location.href = "playtrap://payment/retry";
  }

  function closeWindow() {
    setClosing(true);
    window.close();
    // Fallback if window.close() is blocked
    setTimeout(() => {
      window.location.href = "playtrap://";
    }, 400);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0b1120",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "rgba(100,116,139,0.12)",
            border: "2px solid rgba(100,116,139,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8rem",
            margin: "0 auto 28px",
          }}
        >
          🚫
        </div>

        <h1
          style={{
            color: "#f8fafc",
            fontSize: "1.8rem",
            fontWeight: 800,
            marginBottom: 12,
            letterSpacing: "-0.3px",
          }}
        >
          Payment Cancelled
        </h1>

        <p
          style={{
            color: "#94a3b8",
            fontSize: "1rem",
            lineHeight: 1.6,
            marginBottom: 32,
          }}
        >
          No charge was made. Your current membership level has not changed.
          You can try again whenever you are ready.
        </p>

        {/* Info card */}
        <div
          style={{
            background: "#0f172a",
            border: "1px solid #1e3a5f",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 28,
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Good to know
          </div>
          {[
            { icon: "💳", text: "You have not been charged — no payment was taken" },
            { icon: "🔒", text: "Your account and data are safe and unchanged" },
            { icon: "⏰", text: "You can upgrade your membership at any time from the app" },
          ].map(({ icon, text }) => (
            <div
              key={text}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "8px 0",
                borderBottom: "1px solid #1a2e45",
              }}
            >
              <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: "0.875rem", color: "#cbd5e1", lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={tryAgain}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              padding: "14px 24px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: "1rem",
              cursor: "pointer",
              transition: "background 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#1d4ed8";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#2563eb";
            }}
          >
            🔄 Try Again
          </button>

          <button
            onClick={closeWindow}
            disabled={closing}
            style={{
              background: "transparent",
              color: "#64748b",
              border: "1px solid #1e3a5f",
              padding: "12px 24px",
              borderRadius: 10,
              fontWeight: 500,
              fontSize: "0.9rem",
              cursor: "pointer",
              transition: "all 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#334155";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#1e3a5f";
            }}
          >
            {closing ? "Closing…" : "← Back to App"}
          </button>
        </div>

        {/* Support link */}
        <p
          style={{
            fontSize: "0.8rem",
            color: "#374151",
            marginTop: 28,
            lineHeight: 1.6,
          }}
        >
          Having trouble? Contact us through the app's support section.
        </p>

        {/* Branding */}
        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: "1px solid #1e293b",
            fontSize: "0.75rem",
            color: "#374151",
          }}
        >
          🪤 Playtrap · Secure payment processed by Stripe
        </div>
      </div>
    </div>
  );
}
