import { useState } from "react";
import CreateAllyGroupPanel from "./CreateAllyGroupPanel";
import AllyGroupDetailPanel from "./AllyGroupDetailPanel";

export default function AllyGroupsPanel() {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [manualGroupId, setManualGroupId] = useState("");

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <CreateAllyGroupPanel onCreated={setSelectedGroupId} />

      <div style={{ border: "1px solid #334155", borderRadius: 12, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Open Existing Ally Group</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={manualGroupId}
            onChange={(e) => setManualGroupId(e.target.value)}
            placeholder="Enter ally group ID"
          />
          <button onClick={() => setSelectedGroupId(manualGroupId.trim())}>
            Open
          </button>
        </div>
      </div>

      {selectedGroupId ? <AllyGroupDetailPanel groupId={selectedGroupId} /> : null}
    </section>
  );
}