import { useEffect, useState } from "react";
import {
  EnemyRelationItem,
  declareEnemyRelation,
  listEnemyRelations,
  removeEnemyRelation,
} from "../api/allyDiplomacy";

export default function AllyGroupEnemiesPanel({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<EnemyRelationItem[]>([]);
  const [targetGroupId, setTargetGroupId] = useState("");
  const [result, setResult] = useState("");

  async function loadEnemies() {
    try {
      const res = await listEnemyRelations({
        sourceType: "ally_group",
        sourceId: groupId,
      });
      setItems(res);
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
    void loadEnemies();
  }, [groupId]);

  async function addEnemy() {
    if (!targetGroupId.trim()) {
      setResult("Target ally group ID is required.");
      return;
    }

    try {
      const res = await declareEnemyRelation({
        sourceType: "ally_group",
        sourceId: groupId,
        targetType: "ally_group",
        targetId: targetGroupId.trim(),
      });
      setResult(JSON.stringify(res, null, 2));
      setTargetGroupId("");
      await loadEnemies();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Declare failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  async function removeEnemy(targetId: string) {
    try {
      const res = await removeEnemyRelation({
        sourceType: "ally_group",
        sourceId: groupId,
        targetType: "ally_group",
        targetId,
      });
      setResult(JSON.stringify(res, null, 2));
      await loadEnemies();
    } catch (error: any) {
      setResult(
        JSON.stringify(
          { message: error?.message ?? "Remove failed", code: error?.code ?? null },
          null,
          2
        )
      );
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Enemy Ally Groups</h3>

      <div style={{ border: "1px solid #DCE4EE", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={targetGroupId}
            onChange={(e) => setTargetGroupId(e.target.value)}
            placeholder="Target ally group ID"
          />
          <button onClick={() => void addEnemy()}>Add enemy ally group</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              border: "1px solid #DCE4EE",
              borderRadius: 10,
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div>
              Target: {item.targetType} / {item.targetId}
            </div>
            <button onClick={() => void removeEnemy(item.targetId)}>Remove</button>
          </div>
        ))}
      </div>

      <pre style={{ whiteSpace: "pre-wrap" }}>{result}</pre>
    </section>
  );
}