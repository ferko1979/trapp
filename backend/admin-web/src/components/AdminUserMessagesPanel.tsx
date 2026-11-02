import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type Conversation = {
  id: string;
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
  createdAtEpochMs: number | null;
};

export default function AdminUserMessagesPanel() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState("");

  async function loadConversations() {
    try {
      const fn = httpsCallable<unknown, { ok?: boolean; items?: Conversation[] }>(
        functions,
        "listMyConversations"
      );
      const res = await fn();
      setItems(res.data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversations.");
    }
  }

  async function openConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    try {
      const fn = httpsCallable<
        { conversationId: string },
        { ok?: boolean; messages?: ConversationMessage[] }
      >(functions, "getConversationThread");
      const res = await fn({ conversationId });
      setMessages(res.data.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversation.");
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
      <section
        style={{
          background: "#EEF2F7",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #DCE4EE",
        }}
      >
        <h3 style={{ marginTop: 0 }}>User Messages</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => void openConversation(item.id)}
              style={{
                textAlign: "left",
                background:
                  selectedConversationId === item.id ? "#E6F6FB" : "#FFFFFF",
                border: "1px solid #DCE4EE",
                borderRadius: 10,
                padding: 12,
                color: "#0D1F33",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {item.otherUsername || item.memberUsernames.join(", ")}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                {item.lastMessageText}
              </div>
              {item.unread ? (
                <div style={{ marginTop: 6, fontSize: 12, color: "#C8283B" }}>
                  Unread
                </div>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section
        style={{
          background: "#EEF2F7",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #DCE4EE",
        }}
      >
        {!selectedConversationId ? (
          <div style={{ opacity: 0.75 }}>Select a conversation.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  background: "#F4F7FB",
                  border: "1px solid #DCE4EE",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{message.senderUsername}</strong>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    {message.createdAtEpochMs
                      ? new Date(message.createdAtEpochMs).toLocaleString()
                      : ""}
                  </span>
                </div>
                <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {error ? <div style={{ color: "#C8283B", marginTop: 10 }}>{error}</div> : null}
      </section>
    </div>
  );
}