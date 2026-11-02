import { useState } from "react";
import AllyGroupMembersPanel from "./AllyGroupMembersPanel";
import AllyGroupRolesPanel from "./AllyGroupRolesPanel";
import AllyGroupEnemiesPanel from "./AllyGroupEnemiesPanel";

type TabKey = "members" | "roles" | "enemies";

export default function AllyGroupDetailPanel({
  groupId,
}: {
  groupId: string;
}) {
  const [tab, setTab] = useState<TabKey>("members");

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>Ally Group Detail</h2>
        <div style={{ opacity: 0.8, marginTop: 4 }}>Group ID: {groupId}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setTab("members")}>Members</button>
        <button onClick={() => setTab("roles")}>Roles</button>
        <button onClick={() => setTab("enemies")}>Enemies</button>
      </div>

      {tab === "members" ? <AllyGroupMembersPanel groupId={groupId} /> : null}
      {tab === "roles" ? <AllyGroupRolesPanel groupId={groupId} /> : null}
      {tab === "enemies" ? <AllyGroupEnemiesPanel groupId={groupId} /> : null}
    </section>
  );
}