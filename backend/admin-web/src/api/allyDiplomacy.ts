import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export type AllyGroupSize = 2 | 4 | 8 | 16 | 32 | 64;

export type AllyGroupRoleItem = {
  id: string;
  groupId: string;
  name: string;
  key: string;
  priority: number;
  isSystem: boolean;
  canManageMembers: boolean;
  canManageRoles: boolean;
  canManageEnemies: boolean;
  canEditGroup: boolean;
};

export type AllyGroupMemberItem = {
  id: string;
  groupId: string;
  uid: string;
  status: "active" | "invited" | "left" | "removed";
  roleId: string;
  roleName?: string | null;
  roleKey?: string | null;
  isLeader: boolean;
  invitedByUid?: string | null;
  joinedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type EnemyRelationItem = {
  id: string;
  sourceType: "user" | "ally_group";
  sourceId: string;
  targetType: "user" | "ally_group";
  targetId: string;
  status: "active" | "removed";
  createdByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export async function createAllyGroupV2(input: {
  name: string;
  maxMembers: AllyGroupSize;
}) {
  const fn = httpsCallable(functions, "createAllyGroupV2");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    groupId: string;
    leaderUid: string;
    maxMembers: AllyGroupSize;
  };
}

export async function inviteToAllyGroupV2(input: {
  groupId: string;
  targetUid: string;
}) {
  const fn = httpsCallable(functions, "inviteToAllyGroupV2");
  const res = await fn({
    groupId: input.groupId,
    targetUid: input.targetUid,
  });
  return res.data as {
    ok: boolean;
    groupId: string;
    targetUid: string;
    invited: boolean;
  };
}

export async function acceptAllyGroupInviteV2(input: { groupId: string }) {
  const fn = httpsCallable(functions, "acceptAllyGroupInviteV2");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    groupId: string;
    uid: string;
    joined: boolean;
  };
}

export async function listAllyGroupMembersWithRoles(input: { groupId: string }) {
  const fn = httpsCallable(functions, "listAllyGroupMembersWithRoles");
  const res = await fn(input);
  return (res.data as { ok: boolean; items: AllyGroupMemberItem[] }).items ?? [];
}

export async function listAllyGroupRoles(input: { groupId: string }) {
  const fn = httpsCallable(functions, "listAllyGroupRoles");
  const res = await fn(input);
  return (res.data as { ok: boolean; items: AllyGroupRoleItem[] }).items ?? [];
}

export async function createAllyGroupRole(input: {
  groupId: string;
  name: string;
  key?: string;
  priority?: number;
  canManageMembers?: boolean;
  canManageRoles?: boolean;
  canManageEnemies?: boolean;
  canEditGroup?: boolean;
}) {
  const fn = httpsCallable(functions, "createAllyGroupRole");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    roleId: string;
    groupId: string;
    key: string;
    name: string;
  };
}

export async function updateAllyGroupRole(input: {
  roleId: string;
  name?: string;
  priority?: number;
  canManageMembers?: boolean;
  canManageRoles?: boolean;
  canManageEnemies?: boolean;
  canEditGroup?: boolean;
}) {
  const fn = httpsCallable(functions, "updateAllyGroupRole");
  const res = await fn(input);
  return res.data as { ok: boolean; roleId: string };
}

export async function deleteAllyGroupRole(input: { roleId: string }) {
  const fn = httpsCallable(functions, "deleteAllyGroupRole");
  const res = await fn(input);
  return res.data as { ok: boolean; roleId: string; reassignedMembers: number };
}

export async function assignAllyGroupMemberRole(input: {
  groupId: string;
  targetUid: string;
  roleId: string;
}) {
  const fn = httpsCallable(functions, "assignAllyGroupMemberRole");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    groupId: string;
    targetUid: string;
    roleId: string;
  };
}

export async function transferAllyGroupLeadership(input: {
  groupId: string;
  newLeaderUid: string;
}) {
  const fn = httpsCallable(functions, "transferAllyGroupLeadership");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    groupId: string;
    previousLeaderUid: string;
    newLeaderUid: string;
  };
}

export async function declareEnemyRelation(input: {
  sourceType: "user" | "ally_group";
  sourceId: string;
  targetType: "user" | "ally_group";
  targetId: string;
}) {
  const fn = httpsCallable(functions, "declareEnemyRelation");
  const res = await fn(input);
  return res.data as {
    ok: boolean;
    relationId: string;
    sourceType: "user" | "ally_group";
    sourceId: string;
    targetType: "user" | "ally_group";
    targetId: string;
  };
}

export async function removeEnemyRelation(input: {
  sourceType: "user" | "ally_group";
  sourceId: string;
  targetType: "user" | "ally_group";
  targetId: string;
}) {
  const fn = httpsCallable(functions, "removeEnemyRelation");
  const res = await fn(input);
  return res.data as { ok: boolean; relationId: string };
}

export async function listEnemyRelations(input: {
  sourceType: "user" | "ally_group";
  sourceId: string;
}) {
  const fn = httpsCallable(functions, "listEnemyRelations");
  const res = await fn(input);
  return (res.data as { ok: boolean; items: EnemyRelationItem[] }).items ?? [];
}