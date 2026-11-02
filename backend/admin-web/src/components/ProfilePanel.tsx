import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../firebase";

type ProfileData = {
  email?: string | null;
  username?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  status?: string | null;
  levelId?: string | null;
  membership?: string | null;
  timeZone?: string | null;
  birthDate?: string | null;
  age?: number | null;
  ageGroup?: "minor" | "adult" | null;
  gender?: string | null;
  captureCount?: number | null;
  timesCaught?: number | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastSeenAt?: unknown;
  [key: string]: unknown;
};

function formatTimestamp(value: unknown) {
  if (!value) return "-";

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toLocaleString();
    } catch {
      return "-";
    }
  }

  return String(value);
}

function line(label: string, value: unknown) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12 }}>
      <div style={{ opacity: 0.75 }}>{label}</div>
      <div>{value === null || value === undefined || value === "" ? "-" : String(value)}</div>
    </div>
  );
}

export default function ProfilePanel() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const uid = auth.currentUser?.uid;
        if (!uid) {
          setError("No authenticated user.");
          setProfile(null);
          return;
        }

        const snap = await getDoc(doc(db, "users", uid));
        setProfile((snap.data() as ProfileData | undefined) ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load profile.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <section
      style={{
        background: "#1e293b",
        padding: 20,
        borderRadius: 12,
        border: "1px solid #334155",
        display: "grid",
        gap: 16,
      }}
    >
      <div>
        <h2 style={{ margin: 0 }}>My Admin Profile</h2>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          Structured profile view with raw JSON below
        </div>
      </div>

      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#fca5a5" }}>{error}</div> : null}

      {!loading && !error && profile ? (
        <>
          <div
            style={{
              display: "grid",
              gap: 8,
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 10,
              padding: 16,
            }}
          >
            {line("Email", profile.email)}
            {line("Username", profile.username)}
            {line("Display name", profile.displayName)}
            {line("First name", profile.firstName)}
            {line("Last name", profile.lastName)}
            {line("Role", profile.role)}
            {line("Status", profile.status)}
            {line("Level", profile.levelId)}
            {line("Membership", profile.membership)}
            {line("Time zone", profile.timeZone)}
            {line("Birthdate", profile.birthDate)}
            {line("Age", profile.age)}
            {line("Age group", profile.ageGroup)}
            {line("Gender", profile.gender)}
            {line("Capture count", profile.captureCount)}
            {line("Times caught", profile.timesCaught)}
            {line("Created at", formatTimestamp(profile.createdAt))}
            {line("Updated at", formatTimestamp(profile.updatedAt))}
            {line("Last seen", formatTimestamp(profile.lastSeenAt))}
          </div>

          <div
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Raw JSON</div>
            <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {JSON.stringify(profile, null, 2)}
            </pre>
          </div>
        </>
      ) : null}
    </section>
  );
}