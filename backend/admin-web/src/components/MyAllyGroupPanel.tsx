import { useEffect, useState } from "react";
import {
  EnemyRelationItem,
  acceptAllyGroupInviteV2,
  AllyGroupMemberItem,
  listAllyGroupMembersWithRoles,
  listEnemyRelations,
} from "../api/allyDiplomacy";

export default function MyAllyGroupPanel({
  groupId,
  pendingInviteGroupId,
}: {
  groupId?: string | null;
  pendingInviteGroupId?: string | null;
}) {
  const [members, setMembers] = useState<AllyGroupMemberItem[]>([]);
  const [enemies, setEnemies] = useState<EnemyRelationItem[]>([]);
  const [result, setResult] = useState("");

  async function loadForGroup(currentGroupId: string) {
    try {
      const [memberItems, enemyItems] = await Promise.all([
        listAllyGroupMembersWithRoles({ groupId: currentGroupId }),
        listEnemyRelations({
          sourceType: "ally_group",
          sourceId: currentGroupId,
        }),
      ]);
      setMembers(memberItems);
      setEnemies(enemyItems);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Load failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  useEffect(() => {
    if (groupId) {
      void loadForGroup(groupId);
    } else {
      setMembers([]);
      setEnemies([]);
    }
  }, [groupId]);

  async function acceptInvite() {
    if (!pendingInviteGroupId) return;

    try {
      const res = await acceptAllyGroupInviteV2({ groupId: pendingInviteGroupId });
      setResult(JSON.stringify(res, null, 2));
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Accept failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h2 style={{ margin: 0 }}>My Ally Group</h2>

      {!groupId ? (
        <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
          <div>You are not currently in an active ally group.</div>
          {pendingInviteGroupId ? (
            <div style={{ marginTop: 10 }}>
              <div>Pending invite: {pendingInviteGroupId}</div>
              <button onClick={() => void acceptInvite()}>Accept invite</button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            Active group ID: {groupId}
          </div>

          <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Members</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {members.map((member) => (
                <div key={member.id}>
                  {member.uid} — {member.roleName ?? member.roleId}{" "}
                  {member.isLeader ? "(Leader)" : ""}
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Enemy Ally Groups</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {enemies.length === 0 ? <div>No enemies configured.</div> : null}
              {enemies.map((enemy) => (
                <div key={enemy.id}>{enemy.targetId}</div>
              ))}
            </div>
          </div>
        </>
      )}

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}