import { httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState } from "react";
import { functions } from "../firebase";

type ConversationItem = {
  id: string;
  kind: string;
  supportTicketId?: string;
  supportTicketNo?: string;
  memberUids: string[];
  memberUsernames: string[];
  otherUid: string;
  otherUsername: string;
  lastMessageText: string;
  lastMessageSenderUid: string;
  unread: boolean;
  lastMessageAtEpochMs: number | null;
};

type ConversationMessage = {
  id: string;
  senderUid: string;
  senderUsername: string;
  text: string;
  kind?: string;
  supportTicketId?: string;
  supportTicketNo?: string;
  createdAtEpochMs: number | null;
};

type ThreadResponse = {
  ok?: boolean;
  conversation?: {
    id: string;
    kind: string;
    supportTicketId?: string;
    supportTicketNo?: string;
    memberUids: string[];
    memberUsernames: string[];
  };
  messages?: ConversationMessage[];
};

function titleForConversation(item: ConversationItem) {
  if (item.kind === "support") {
    return item.supportTicketNo
      ? `Support · ${item.supportTicketNo}`
      : "Support";
  }
  return item.otherUsername || item.memberUsernames.join(", ") || "Conversation";
}

export default function UserInboxPanel() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [threadMeta, setThreadMeta] = useState<ThreadResponse["conversation"]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadConversations() {
    setError("");
    const fn = httpsCallable<unknown, { ok?: boolean; items?: ConversationItem[] }>(
      functions,
      "listMyConversations"
    );
    const res = await fn();
    setItems(res.data.items ?? []);
  }

  async function openConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setLoading(true);
    setError("");

    try {
      const fn = httpsCallable<{ conversationId: string }, ThreadResponse>(
        functions,
        "getConversationThread"
      );
      const res = await fn({ conversationId });
      setThreadMeta(res.data.conversation);
      setMessages(res.data.messages ?? []);
      await loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversation.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  const unreadCount = useMemo(
    () => items.filter((x) => x.unread).length,
    [items]
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
      <section
        style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #334155",
          maxHeight: "82vh",
          overflow: "auto",
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Inbox</h3>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {items.length} conversations · {unreadCount} unread
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => void openConversation(item.id)}
              style={{
                textAlign: "left",
                background:
                  selectedConversationId === item.id ? "#1d4ed8" : "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 12,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <strong>{titleForConversation(item)}</strong>
                {item.unread ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#fecaca",
                      background: "#7f1d1d",
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    new
                  </span>
                ) : null}
              </div>

              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                {item.kind === "support" ? "Support conversation" : "Direct message"}
              </div>

              <div
                style={{
                  fontSize: 12,
                  marginTop: 8,
                  opacity: 0.85,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.lastMessageText}
              </div>

              <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
                {item.lastMessageAtEpochMs
                  ? new Date(item.lastMessageAtEpochMs).toLocaleString()
                  : ""}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section
        style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #334155",
          minHeight: 500,
        }}
      >
        {!selectedConversationId ? (
          <div style={{ opacity: 0.75 }}>Select a conversation.</div>
        ) : loading ? (
          <div style={{ opacity: 0.75 }}>Loading…</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {threadMeta?.kind === "support"
                  ? `Support${
                      threadMeta.supportTicketNo
                        ? ` · ${threadMeta.supportTicketNo}`
                        : ""
                    }`
                  : "Conversation"}
              </h3>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                {threadMeta?.memberUsernames?.join(" · ")}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                maxHeight: "68vh",
                overflow: "auto",
                paddingRight: 4,
              }}
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    background:
                      message.kind === "support" ? "#1e3a8a" : "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{message.senderUsername || "Unknown"}</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {message.createdAtEpochMs
                        ? new Date(message.createdAtEpochMs).toLocaleString()
                        : ""}
                    </span>
                  </div>

                  {message.kind === "support" && message.supportTicketNo ? (
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      Linked to {message.supportTicketNo}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {message.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error ? <div style={{ color: "#fca5a5", marginTop: 10 }}>{error}</div> : null}
      </section>
    </div>
  );
}