import { useEffect, useState } from "react";
import {
  AllyGroupMemberItem,
  AllyGroupRoleItem,
  assignAllyGroupMemberRole,
  inviteToAllyGroupV2,
  listAllyGroupMembersWithRoles,
  listAllyGroupRoles,
  transferAllyGroupLeadership,
} from "../api/allyDiplomacy";

export default function AllyGroupMembersPanel({ groupId }: { groupId: string }) {
  const [members, setMembers] = useState<AllyGroupMemberItem[]>([]);
  const [roles, setRoles] = useState<AllyGroupRoleItem[]>([]);
  const [result, setResult] = useState("");
  const [inviteUid, setInviteUid] = useState("");

  async function loadAll() {
    try {
      const [memberItems, roleItems] = await Promise.all([
        listAllyGroupMembersWithRoles({ groupId }),
        listAllyGroupRoles({ groupId }),
      ]);
      setMembers(memberItems);
      setRoles(roleItems);
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
    void loadAll();
  }, [groupId]);

  async function invite() {
    if (!inviteUid.trim()) {
      setResult("Target UID is required.");
      return;
    }

    try {
      const res = await inviteToAllyGroupV2({
        groupId,
        targetUid: inviteUid.trim(),
      });
      setResult(JSON.stringify(res, null, 2));
      setInviteUid("");
      await loadAll();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Invite failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  async function setRole(targetUid: string, roleId: string) {
    try {
      const res = await assignAllyGroupMemberRole({
        groupId,
        targetUid,
        roleId,
      });
      setResult(JSON.stringify(res, null, 2));
      await loadAll();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Assign failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  async function transferLeader(newLeaderUid: string) {
    try {
      const res = await transferAllyGroupLeadership({
        groupId,
        newLeaderUid,
      });
      setResult(JSON.stringify(res, null, 2));
      await loadAll();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Leadership transfer failed",
            code: error?.code ?? null,
          },
          null,
          2
        )
      );
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Members</h3>

      <div style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Invite member</h4>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={inviteUid}
            onChange={(e) => setInviteUid(e.target.value)}
            placeholder="Target user UID"
          />
          <button onClick={() => void invite()}>Invite</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {members.map((member) => (
          <div
            key={member.id}
            style={{
              border: "1px solid #DCE4EE",
              borderRadius: 10,
              padding: 12,
              display: "grid",
              gap: 8,
            }}
          >
            <div>
              <strong>{member.uid}</strong>
            </div>
            <div>
              Status: {member.status} | Leader: {member.isLeader ? "yes" : "no"}
            </div>
            <div>
              Role: {member.roleName ?? "-"} ({member.roleKey ?? member.roleId ?? "-"})
            </div>

            {member.status === "active" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!member.isLeader ? (
                  <select
                    value={member.roleId}
                    onChange={(e) => void setRole(member.uid, e.target.value)}
                  >
                    {roles
                      .filter((role) => role.key !== "leader")
                      .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                ) : null}

                {!member.isLeader ? (
                  <button onClick={() => void transferLeader(member.uid)}>
                    Make leader
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}