import { useEffect, useState } from "react";
import {
  AllyGroupRoleItem,
  createAllyGroupRole,
  deleteAllyGroupRole,
  listAllyGroupRoles,
  updateAllyGroupRole,
} from "../api/allyDiplomacy";

type RoleDraft = {
  name: string;
  key: string;
  priority: string;
  canManageMembers: boolean;
  canManageRoles: boolean;
  canManageEnemies: boolean;
  canEditGroup: boolean;
};

function buildDraft(role?: AllyGroupRoleItem): RoleDraft {
  return {
    name: role?.name ?? "",
    key: role?.key ?? "",
    priority: String(role?.priority ?? 10),
    canManageMembers: role?.canManageMembers ?? false,
    canManageRoles: role?.canManageRoles ?? false,
    canManageEnemies: role?.canManageEnemies ?? false,
    canEditGroup: role?.canEditGroup ?? false,
  };
}

export default function AllyGroupRolesPanel({ groupId }: { groupId: string }) {
  const [roles, setRoles] = useState<AllyGroupRoleItem[]>([]);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const [newDraft, setNewDraft] = useState<RoleDraft>(buildDraft());
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RoleDraft>(buildDraft());

  async function loadRoles() {
    if (!groupId) return;
    setLoading(true);
    try {
      const items = await listAllyGroupRoles({ groupId });
      setRoles(items);
    } catch (error: any) {
      setResult(
        JSON.stringify(
          {
            message: error?.message ?? "Failed to load roles",
            code: error?.code ?? null,
          },
          null,
          2
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRoles();
  }, [groupId]);

  async function createRole() {
    try {
      const res = await createAllyGroupRole({
        groupId,
        name: newDraft.name.trim(),
        key: newDraft.key.trim() || undefined,
        priority: Number(newDraft.priority) || 10,
        canManageMembers: newDraft.canManageMembers,
        canManageRoles: newDraft.canManageRoles,
        canManageEnemies: newDraft.canManageEnemies,
        canEditGroup: newDraft.canEditGroup,
      });
      setResult(JSON.stringify(res, null, 2));
      setNewDraft(buildDraft());
      await loadRoles();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Create failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  async function saveRole(roleId: string) {
    try {
      const res = await updateAllyGroupRole({
        roleId,
        name: editDraft.name.trim(),
        priority: Number(editDraft.priority) || 10,
        canManageMembers: editDraft.canManageMembers,
        canManageRoles: editDraft.canManageRoles,
        canManageEnemies: editDraft.canManageEnemies,
        canEditGroup: editDraft.canEditGroup,
      });
      setResult(JSON.stringify(res, null, 2));
      setEditingRoleId(null);
      await loadRoles();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Update failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  async function removeRole(roleId: string) {
    try {
      const res = await deleteAllyGroupRole({ roleId });
      setResult(JSON.stringify(res, null, 2));
      await loadRoles();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Delete failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  function checkbox(
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void
  ) {
    return (
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Roles</h3>

      <div style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Create custom role</h4>
        <div style={{ display: "grid", gap: 8 }}>
          <input
            value={newDraft.name}
            onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
            placeholder="Role name"
          />
          <input
            value={newDraft.key}
            onChange={(e) => setNewDraft({ ...newDraft, key: e.target.value })}
            placeholder="Role key (optional)"
          />
          <input
            value={newDraft.priority}
            onChange={(e) => setNewDraft({ ...newDraft, priority: e.target.value })}
            placeholder="Priority"
            type="number"
          />
          {checkbox("Can manage members", newDraft.canManageMembers, (v) =>
            setNewDraft({ ...newDraft, canManageMembers: v })
          )}
          {checkbox("Can manage roles", newDraft.canManageRoles, (v) =>
            setNewDraft({ ...newDraft, canManageRoles: v })
          )}
          {checkbox("Can manage enemies", newDraft.canManageEnemies, (v) =>
            setNewDraft({ ...newDraft, canManageEnemies: v })
          )}
          {checkbox("Can edit group", newDraft.canEditGroup, (v) =>
            setNewDraft({ ...newDraft, canEditGroup: v })
          )}
          <button onClick={() => void createRole()}>Create role</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {loading ? <div>Loading roles...</div> : null}

        {roles.map((role) => {
          const isEditing = editingRoleId === role.id;
          return (
            <div
              key={role.id}
              style={{
                border: "1px solid #DCE4EE",
                borderRadius: 10,
                padding: 12,
                display: "grid",
                gap: 8,
              }}
            >
              {!isEditing ? (
                <>
                  <div>
                    <strong>{role.name}</strong> ({role.key})
                  </div>
                  <div>
                    Priority: {role.priority} | System: {role.isSystem ? "yes" : "no"}
                  </div>
                  <div>
                    Members: {role.canManageMembers ? "yes" : "no"} | Roles:{" "}
                    {role.canManageRoles ? "yes" : "no"} | Enemies:{" "}
                    {role.canManageEnemies ? "yes" : "no"} | Edit group:{" "}
                    {role.canEditGroup ? "yes" : "no"}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => {
                        setEditingRoleId(role.id);
                        setEditDraft(buildDraft(role));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void removeRole(role.id)}
                      disabled={role.isSystem}
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    placeholder="Role name"
                  />
                  <input
                    value={editDraft.priority}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, priority: e.target.value })
                    }
                    type="number"
                    placeholder="Priority"
                  />
                  {checkbox("Can manage members", editDraft.canManageMembers, (v) =>
                    setEditDraft({ ...editDraft, canManageMembers: v })
                  )}
                  {checkbox("Can manage roles", editDraft.canManageRoles, (v) =>
                    setEditDraft({ ...editDraft, canManageRoles: v })
                  )}
                  {checkbox("Can manage enemies", editDraft.canManageEnemies, (v) =>
                    setEditDraft({ ...editDraft, canManageEnemies: v })
                  )}
                  {checkbox("Can edit group", editDraft.canEditGroup, (v) =>
                    setEditDraft({ ...editDraft, canEditGroup: v })
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => void saveRole(role.id)}>Save</button>
                    <button onClick={() => setEditingRoleId(null)}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}