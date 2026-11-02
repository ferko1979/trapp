import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useState } from "react";
import { functions, storage } from "../firebase";

type UploadedAttachment = {
  path: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  downloadURL?: string;
};

export default function CreateSupportTicketForm() {
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function uploadAttachments(ticketSeed: string): Promise<UploadedAttachment[]> {
    const uploaded: UploadedAttachment[] = [];

    for (const file of files) {
      const safeName = file.name.replace(/\s+/g, "_");
      const path = `support_uploads/${ticketSeed}/${Date.now()}_${safeName}`;
      const fileRef = ref(storage, path);

      await uploadBytes(fileRef, file, {
        contentType: file.type || "application/octet-stream",
      });

      const downloadURL = await getDownloadURL(fileRef);

      uploaded.push({
        path,
        fileName: file.name,
        contentType: file.type || undefined,
        sizeBytes: file.size,
        downloadURL,
      });
    }

    return uploaded;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setError("");

    try {
      if (!subject.trim()) {
        throw new Error("Subject is required.");
      }
      if (!message.trim()) {
        throw new Error("Message is required.");
      }

      const uploadSeed = crypto.randomUUID();
      const attachments = await uploadAttachments(uploadSeed);

      const fn = httpsCallable<
        {
          category: string;
          priority: string;
          subject: string;
          message: string;
          attachments: UploadedAttachment[];
        },
        { ok?: boolean; ticketId?: string; ticketNo?: string }
      >(functions, "createSupportTicket");

      const res = await fn({
        category,
        priority,
        subject: subject.trim(),
        message: message.trim(),
        attachments,
      });

      setSuccess(
        res.data.ticketNo
          ? `Support ticket created: ${res.data.ticketNo}`
          : "Support ticket created."
      );
      setSubject("");
      setMessage("");
      setFiles([]);
      const input = document.getElementById(
        "support-file-input"
      ) as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create support ticket.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "grid",
        gap: 14,
        background: "#EEF2F7",
        padding: 20,
        borderRadius: 12,
        border: "1px solid #DCE4EE",
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>Contact support</h3>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          Your ticket will also appear in your inbox.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #5F7491",
              background: "#F4F7FB",
              color: "#0D1F33",
            }}
          >
            <option value="email_change">Change email</option>
            <option value="bug_report">Bug report</option>
            <option value="account">Account issue</option>
            <option value="billing">Billing issue</option>
            <option value="general">General</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #5F7491",
              background: "#F4F7FB",
              color: "#0D1F33",
            }}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <span>Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What is this about?"
          maxLength={200}
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #5F7491",
            background: "#F4F7FB",
            color: "#0D1F33",
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <span>Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={8}
          placeholder="Describe the issue or request."
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #5F7491",
            background: "#F4F7FB",
            color: "#0D1F33",
            resize: "vertical",
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <span>Attachments</span>
        <input
          id="support-file-input"
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #5F7491",
            background: "#F4F7FB",
            color: "#0D1F33",
          }}
        />
      </label>

      {files.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            fontSize: 12,
            opacity: 0.85,
          }}
        >
          {files.map((file) => (
            <div key={`${file.name}-${file.size}`}>
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "12px 16px",
          borderRadius: 10,
          border: "1px solid #0B6C86",
          background: "#0B6C86",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        {loading ? "Sending…" : "Send support ticket"}
      </button>

      {success ? <div style={{ color: "#178A55" }}>{success}</div> : null}
      {error ? <div style={{ color: "#C8283B" }}>{error}</div> : null}
    </form>
  );
}