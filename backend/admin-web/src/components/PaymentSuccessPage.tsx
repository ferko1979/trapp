import { useEffect, useState } from "react";

export default function PaymentSuccessPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionId(params.get("session_id"));
  }, []);

  // Countdown timer — mobile apps often open this in a WebView
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F7FB",
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
        {/* Animated checkmark circle */}
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            background: "rgba(22,163,74,0.15)",
            border: "2px solid rgba(34,197,94,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8rem",
            margin: "0 auto 28px",
            animation: "pulse 2s ease-in-out infinite",
          }}
        >
          ✅
        </div>

        <h1
          style={{
            color: "#0D1F33",
            fontSize: "1.8rem",
            fontWeight: 800,
            marginBottom: 12,
            letterSpacing: "-0.3px",
          }}
        >
          Payment Successful!
        </h1>

        <p
          style={{
            color: "#3C516C",
            fontSize: "1rem",
            lineHeight: 1.6,
            marginBottom: 32,
          }}
        >
          Your membership has been activated. You can now access all features
          included in your new level.
        </p>

        {/* Info card */}
        <div
          style={{
            background: "#F4F7FB",
            border: "1px solid rgba(34,197,94,0.25)",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 28,
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              color: "#5F7491",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            What happens next
          </div>
          {[
            { icon: "📱", text: "Open the Playtrap app to access your new features" },
            { icon: "📧", text: "A confirmation email has been sent to your address" },
            { icon: "🔄", text: "For subscriptions, you will be billed automatically every 30 days" },
          ].map(({ icon, text }) => (
            <div
              key={text}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "8px 0",
                borderBottom: "1px solid #DCE4EE",
              }}
            >
              <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: "0.875rem", color: "#26394F", lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        {/* Return to app button */}
        <a
          href="playtrap://"
          style={{
            display: "block",
            background: "#0B6C86",
            color: "#fff",
            textDecoration: "none",
            padding: "14px 24px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: "1rem",
            marginBottom: 14,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = "#0B6C86";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = "#0B6C86";
          }}
        >
          🪤 Return to Playtrap
        </a>

        <p style={{ fontSize: "0.78rem", color: "#DCE4EE" }}>
          You may close this window.
          {countdown > 0 ? ` Auto-closing in ${countdown}s…` : ""}
        </p>

        {/* Session ID for debugging */}
        {sessionId && (
          <p
            style={{
              fontSize: "0.68rem",
              color: "#DCE4EE",
              marginTop: 24,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            ref: {sessionId}
          </p>
        )}

        {/* Branding */}
        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: "1px solid #EEF2F7",
            fontSize: "0.75rem",
            color: "#DCE4EE",
          }}
        >
          🪤 Playtrap · Secure payment processed by Stripe
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.25); }
          50% { box-shadow: 0 0 0 16px rgba(34, 197, 94, 0); }
        }
      `}</style>
    </div>
  );
}
