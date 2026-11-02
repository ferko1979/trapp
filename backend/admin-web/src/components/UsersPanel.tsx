import { httpsCallable } from "firebase/functions";
import { useState } from "react";
import { functions } from "../firebase";

export default function UsersPanel() {
  const [targetUid, setTargetUid] = useState("");
  const [result, setResult] = useState("");

  async function makeAdmin() {
    const fn = httpsCallable(functions, "setUserAdmin");
    const res = await fn({ uid: targetUid, admin: true });
    setResult(JSON.stringify(res.data, null, 2));
  }

  async function removeAdmin() {
    const fn = httpsCallable(functions, "setUserAdmin");
    const res = await fn({ uid: targetUid, admin: false });
    setResult(JSON.stringify(res.data, null, 2));
  }

  return (
    <section style={{ background: "#EEF2F7", padding: 20, borderRadius: 12 }}>
      <h2>Admin Users</h2>
      <input
        value={targetUid}
        onChange={(e) => setTargetUid(e.target.value)}
        placeholder="Target UID"
        style={{ width: "100%", padding: 10, marginBottom: 12 }}
      />
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => void makeAdmin()}>Grant admin</button>
        <button onClick={() => void removeAdmin()}>Remove admin</button>
      </div>
      <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}
