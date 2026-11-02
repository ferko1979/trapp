import { httpsCallable } from "firebase/functions";
import { useEffect, useState } from "react";
import { functions } from "../firebase";

type TicketListItem = {
  id: string;
  ticketNo: string;
  createdByUid: string;
  createdByName: string;
  createdByEmail: string;
  category: string;
  priority: string;
  subject: string;
  status: string;
  assignedAdminUid: string;
  hasUnreadAdmin: boolean;
  hasUnreadUser: boolean;
  messagesCount: number;
  createdAtEpochMs: number | null;
  lastMessageAtEpochMs: number | null;
};

type TicketThreadMessage = {
  id: string;
  senderUid: string;
  senderType: string;
  senderName: string;
  text: string;
  isInternal: boolean;
  createdAtEpochMs: number | null;
  attachments: Array<{
    id: string;
    path: string;
    fileName: string;
    contentType: string;
    sizeBytes: number | null;
    downloadURL: string;
  }>;
};

type TicketThreadResponse = {
  ok?: boolean;
  ticket?: {
    id: string;
    ticketNo: string;
    createdByUid: string;
    createdByName: string;
    createdByEmail: string;
    category: string;
    priority: string;
    subject: string;
    status: string;
    assignedAdminUid: string;
    messagesCount: number;
  };
  messages?: TicketThreadMessage[];
};

type AdminListSupportTicketsResponse = {
  ok?: boolean;
  items?: TicketListItem[];
};

export default function AdminSupportTicketsPanel() {
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [selectedTicket, setSelectedTicket] =
    useState<TicketThreadResponse["ticket"]>();
  const [messages, setMessages] = useState<TicketThreadMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState("answered");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadTickets() {
    const fn = httpsCallable<unknown, AdminListSupportTicketsResponse>(
      functions,
      "adminListSupportTickets"
    );
    const res = await fn();
    setTickets(res.data.items ?? []);
  }

  async function openTicket(ticketId: string) {
    setSelectedTicketId(ticketId);
    setError("");
    const fn = httpsCallable<{ ticketId: string }, TicketThreadResponse>(
      functions,
      "adminGetSupportTicketThread"
    );
    const res = await fn({ ticketId });
    setSelectedTicket(res.data.ticket);
    setMessages(res.data.messages ?? []);
  }

  async function sendReply() {
    if (!selectedTicketId || !replyText.trim()) return;

    setLoading(true);
    setError("");

    try {
      const fn = httpsCallable<
        { ticketId: string; message: string; status: string; attachments: unknown[] },
        { ok?: boolean }
      >(functions, "adminReplyToSupportTicket");

      await fn({
        ticketId: selectedTicketId,
        message: replyText.trim(),
        status: replyStatus,
        attachments: [],
      });

      setReplyText("");
      await openTicket(selectedTicketId);
      await loadTickets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send reply.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }}>
      <section
        style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #334155",
          maxHeight: "80vh",
          overflow: "auto",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Support Tickets</h3>

        <div style={{ display: "grid", gap: 10 }}>
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              onClick={() => void openTicket(ticket.id)}
              style={{
                textAlign: "left",
                background: selectedTicketId === ticket.id ? "#1d4ed8" : "#0f172a",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 12,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{ticket.ticketNo}</div>
              <div style={{ fontWeight: 700 }}>{ticket.subject}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {ticket.createdByName} • {ticket.category} • {ticket.status}
              </div>
              {ticket.hasUnreadAdmin ? (
                <div style={{ marginTop: 6, color: "#fca5a5", fontSize: 12 }}>
                  Awaiting response
                </div>
              ) : null}
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
        {!selectedTicket ? (
          <div style={{ opacity: 0.75 }}>Select a ticket.</div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>{selectedTicket.subject}</h3>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                {selectedTicket.ticketNo} • {selectedTicket.createdByName} •{" "}
                {selectedTicket.createdByEmail} • {selectedTicket.status}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 12,
                maxHeight: 420,
                overflow: "auto",
                paddingRight: 4,
              }}
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    background: message.senderType === "admin" ? "#1e3a8a" : "#0f172a",
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
                    <strong>{message.senderName}</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {message.createdAtEpochMs
                        ? new Date(message.createdAtEpochMs).toLocaleString()
                        : ""}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {message.text}
                  </div>

                  {message.attachments.length > 0 ? (
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      {message.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.downloadURL}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#93c5fd" }}
                        >
                          {attachment.fileName}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={6}
                placeholder="Write a reply..."
                style={{
                  width: "100%",
                  borderRadius: 10,
                  border: "1px solid #475569",
                  padding: 12,
                  background: "#0f172a",
                  color: "#fff",
                }}
              />

              <select
                value={replyStatus}
                onChange={(e) => setReplyStatus(e.target.value)}
                style={{
                  borderRadius: 10,
                  border: "1px solid #475569",
                  padding: 12,
                  background: "#0f172a",
                  color: "#fff",
                }}
              >
                <option value="answered">Answered</option>
                <option value="waiting_user">Waiting user</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>

              <button
                onClick={() => void sendReply()}
                disabled={loading}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid #1d4ed8",
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {loading ? "Sending..." : "Send reply"}
              </button>

              {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}