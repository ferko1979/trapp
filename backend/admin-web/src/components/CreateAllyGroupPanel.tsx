import { useState } from "react";
import { AllyGroupSize, createAllyGroupV2 } from "../api/allyDiplomacy";

export default function CreateAllyGroupPanel({
  onCreated,
}: {
  onCreated?: (groupId: string) => void;
}) {
  const [name, setName] = useState("");
  const [maxMembers, setMaxMembers] = useState<AllyGroupSize>(2);
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setResult("Group name is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await createAllyGroupV2({
        name: name.trim(),
        maxMembers,
      });
      setResult(JSON.stringify(res, null, 2));
      setName("");
      setMaxMembers(2);
      onCreated?.(res.groupId);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Unknown error",
            code: error?.code ?? null,
            details: error?.details ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Create Ally Group</h3>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name"
      />

      <select
        value={maxMembers}
        onChange={(e) => setMaxMembers(Number(e.target.value) as AllyGroupSize)}
      >
        {[2, 4, 8, 16, 32, 64].map((size) => (
          <option key={size} value={size}>
            {size} members
          </option>
        ))}
      </select>

      <button onClick={() => void submit()} disabled={saving}>
        {saving ? "Creating..." : "Create ally group"}
      </button>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}