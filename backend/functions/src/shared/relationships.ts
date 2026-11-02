export function normalizeRelationship(
  value: unknown
): "friend" | "enemy" | "ally" {
  if (value === "enemy") return "enemy";
  if (value === "ally") return "ally";
  return "friend";
}
