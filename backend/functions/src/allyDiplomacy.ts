import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import { requireUser as requireAuthUid } from "./shared/appCheck";

type AllyGroupSize = 2 | 4 | 8 | 16 | 32 | 64;

type RolePermissions = {
  canManageMembers: boolean;
  canManageRoles: boolean;
  canManageEnemies: boolean;
  canEditGroup: boolean;
};

type EnemySourceType = "user" | "ally_group";
type EnemyTargetType = "user" | "ally_group";

const ALLOWED_GROUP_SIZES: AllyGroupSize[] = [2, 4, 8, 16, 32, 64];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isAllowedGroupSize(value: number): value is AllyGroupSize {
  return ALLOWED_GROUP_SIZES.includes(value as AllyGroupSize);
}

function normalizeRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function assertEnemyCombinationAllowed(
  sourceType: EnemySourceType,
  targetType: EnemyTargetType
) {
  const isUserVsUser = sourceType === "user" && targetType === "user";
  const isGroupVsGroup =
    sourceType === "ally_group" && targetType === "ally_group";

  if (isUserVsUser || isGroupVsGroup) {
    return;
  }

  throw new HttpsError(
    "invalid-argument",
    "Only user-vs-user and ally-group-vs-ally-group enemy relations are allowed."
  );
}

function getEnemyRelationDocId(
  sourceType: EnemySourceType,
  sourceId: string,
  targetType: EnemyTargetType,
  targetId: string
): string {
  return `${sourceType}_${sourceId}__${targetType}_${targetId}`;
}

function getDefaultGroupRoles() {
  return [
    {
      key: "leader",
      name: "Leader",
      priority: 100,
      isSystem: true,
      canManageMembers: true,
      canManageRoles: true,
      canManageEnemies: true,
      canEditGroup: true,
    },
    {
      key: "president",
      name: "President",
      priority: 90,
      isSystem: true,
      canManageMembers: true,
      canManageRoles: true,
      canManageEnemies: true,
      canEditGroup: true,
    },
    {
      key: "general",
      name: "General",
      priority: 80,
      isSystem: true,
      canManageMembers: true,
      canManageRoles: false,
      canManageEnemies: true,
      canEditGroup: false,
    },
    {
      key: "commander",
      name: "Commander",
      priority: 70,
      isSystem: true,
      canManageMembers: true,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "captain",
      name: "Captain",
      priority: 60,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "lieutenant",
      name: "Lieutenant",
      priority: 50,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "sergeant",
      name: "Sergeant",
      priority: 40,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "officer",
      name: "Officer",
      priority: 30,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "strategist",
      name: "Strategist",
      priority: 25,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "scout",
      name: "Scout",
      priority: 20,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "member",
      name: "Member",
      priority: 10,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
    {
      key: "recruit",
      name: "Recruit",
      priority: 5,
      isSystem: true,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    },
  ] as const;
}

async function getGroupDocOrThrow(groupId: string) {
  const db = getDb();
  const snap = await db.collection("ally_groups").doc(groupId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Ally group not found.");
  }
  return { ref: snap.ref, data: snap.data() ?? {} };
}

async function getActiveGroupMember(groupId: string, uid: string) {
  const db = getDb();
  const snap = await db
    .collection("ally_group_members")
    .where("groupId", "==", groupId)
    .where("uid", "==", uid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (snap.empty) {
    return null;
  }

  const doc = snap.docs[0];
  return {
    ref: doc.ref,
    id: doc.id,
    data: doc.data() ?? {},
  };
}

async function getRoleDoc(groupId: string, roleId: string) {
  const db = getDb();
  const ref = db.collection("ally_group_roles").doc(roleId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (asString(data.groupId) !== groupId) return null;
  return { ref, id: snap.id, data };
}

async function getRolePermissionsForMember(
  groupId: string,
  uid: string
): Promise<
  RolePermissions & {
    isLeader: boolean;
    roleId: string | null;
  }
> {
  const member = await getActiveGroupMember(groupId, uid);
  if (!member) {
    throw new HttpsError("permission-denied", "You are not an active group member.");
  }

  const isLeader = member.data.isLeader === true;
  const roleId = asString(member.data.roleId) || null;

  if (isLeader) {
    return {
      isLeader: true,
      roleId,
      canManageMembers: true,
      canManageRoles: true,
      canManageEnemies: true,
      canEditGroup: true,
    };
  }

  if (!roleId) {
    return {
      isLeader: false,
      roleId: null,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    };
  }

  const role = await getRoleDoc(groupId, roleId);
  if (!role) {
    return {
      isLeader: false,
      roleId,
      canManageMembers: false,
      canManageRoles: false,
      canManageEnemies: false,
      canEditGroup: false,
    };
  }

  return {
    isLeader: false,
    roleId,
    canManageMembers: asBoolean(role.data.canManageMembers),
    canManageRoles: asBoolean(role.data.canManageRoles),
    canManageEnemies: asBoolean(role.data.canManageEnemies),
    canEditGroup: asBoolean(role.data.canEditGroup),
  };
}

async function assertCanManageRoles(groupId: string, uid: string) {
  const perms = await getRolePermissionsForMember(groupId, uid);
  if (!perms.canManageRoles) {
    throw new HttpsError("permission-denied", "You cannot manage group roles.");
  }
  return perms;
}

async function assertCanManageMembers(groupId: string, uid: string) {
  const perms = await getRolePermissionsForMember(groupId, uid);
  if (!perms.canManageMembers) {
    throw new HttpsError("permission-denied", "You cannot manage group members.");
  }
  return perms;
}

async function assertCanManageEnemies(groupId: string, uid: string) {
  const perms = await getRolePermissionsForMember(groupId, uid);
  if (!perms.canManageEnemies) {
    throw new HttpsError("permission-denied", "You cannot manage enemy relations.");
  }
  return perms;
}

async function countGroupMembers(groupId: string): Promise<number> {
  const db = getDb();
  const snap = await db
    .collection("ally_group_members")
    .where("groupId", "==", groupId)
    .where("status", "==", "active")
    .get();
  return snap.size;
}

async function seedDefaultRolesForGroup(groupId: string) {
  const db = getDb();
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const role of getDefaultGroupRoles()) {
    const docId = `${groupId}__${role.key}`;
    batch.set(
      db.collection("ally_group_roles").doc(docId),
      {
        groupId,
        name: role.name,
        key: role.key,
        priority: role.priority,
        isSystem: role.isSystem,
        canManageMembers: role.canManageMembers,
        canManageRoles: role.canManageRoles,
        canManageEnemies: role.canManageEnemies,
        canEditGroup: role.canEditGroup,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
}

export const createAllyGroupV2 = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const name = getTrimmedString(data.name);
  const maxMembersRaw = asNumber(data.maxMembers, 2);

  if (!name) {
    throw new HttpsError("invalid-argument", "name is required.");
  }
  if (!isAllowedGroupSize(maxMembersRaw)) {
    throw new HttpsError("invalid-argument", "maxMembers must be one of 2,4,8,16,32,64.");
  }

  const db = getDb();
  const groupRef = db.collection("ally_groups").doc();
  const memberRef = db.collection("ally_group_members").doc(`${groupRef.id}__${uid}`);
  const leaderRoleId = `${groupRef.id}__leader`;

  await db.runTransaction(async (tx) => {
    const existingMemberships = await db
      .collection("ally_group_members")
      .where("uid", "==", uid)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!existingMemberships.empty) {
      throw new HttpsError(
        "failed-precondition",
        "User is already an active member of an ally group."
      );
    }

    tx.set(groupRef, {
      name,
      createdByUid: uid,
      leaderUid: uid,
      maxMembers: maxMembersRaw,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(memberRef, {
      groupId: groupRef.id,
      uid,
      status: "active",
      roleId: leaderRoleId,
      isLeader: true,
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await seedDefaultRolesForGroup(groupRef.id);

  await db.collection("users").doc(uid).set(
    {
      primaryAllyGroupId: groupRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ok: true,
    groupId: groupRef.id,
    leaderUid: uid,
    maxMembers: maxMembersRaw,
  };
});

export const listAllyGroupRoles = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const groupId = getTrimmedString(data.groupId);

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  await getRolePermissionsForMember(groupId, uid);

  const db = getDb();
  const snap = await db
    .collection("ally_group_roles")
    .where("groupId", "==", groupId)
    .get();

  const items = snap.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }))
    .sort(
      (a, b) =>
        asNumber((b as Record<string, unknown>).priority) -
        asNumber((a as Record<string, unknown>).priority)
    );

  return { ok: true, items };
});

export const createAllyGroupRole = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const groupId = getTrimmedString(data.groupId);
  const name = getTrimmedString(data.name);
  const keyInput = getTrimmedString(data.key);

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }
  if (!name) {
    throw new HttpsError("invalid-argument", "name is required.");
  }

  await assertCanManageRoles(groupId, uid);

  const key = normalizeRoleKey(keyInput || name);
  if (!key) {
    throw new HttpsError("invalid-argument", "A valid role key could not be generated.");
  }

  const db = getDb();
  const roleId = `${groupId}__${key}`;
  const ref = db.collection("ally_group_roles").doc(roleId);
  const existing = await ref.get();

  if (existing.exists) {
    throw new HttpsError("already-exists", "A role with this key already exists.");
  }

  await ref.set({
    groupId,
    name,
    key,
    priority: asNumber(data.priority, 10),
    isSystem: false,
    canManageMembers: asBoolean(data.canManageMembers),
    canManageRoles: asBoolean(data.canManageRoles),
    canManageEnemies: asBoolean(data.canManageEnemies),
    canEditGroup: asBoolean(data.canEditGroup),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, roleId, groupId, key, name };
});

export const updateAllyGroupRole = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const roleId = getTrimmedString(data.roleId);
  if (!roleId) {
    throw new HttpsError("invalid-argument", "roleId is required.");
  }

  const db = getDb();
  const ref = db.collection("ally_group_roles").doc(roleId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Role not found.");
  }

  const role = snap.data() ?? {};
  const groupId = asString(role.groupId);
  if (!groupId) {
    throw new HttpsError("failed-precondition", "Role is missing groupId.");
  }

  await assertCanManageRoles(groupId, uid);

  const isSystem = role.isSystem === true;
  const key = asString(role.key);

  if (isSystem && key === "leader") {
    throw new HttpsError("failed-precondition", "Leader role cannot be modified.");
  }

  const patch: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof data.name === "string" && data.name.trim()) {
    patch.name = data.name.trim();
  }
  if (typeof data.priority === "number" && Number.isFinite(data.priority)) {
    patch.priority = Math.floor(data.priority);
  }

  if (!isSystem) {
    patch.canManageMembers = asBoolean(data.canManageMembers, asBoolean(role.canManageMembers));
    patch.canManageRoles = asBoolean(data.canManageRoles, asBoolean(role.canManageRoles));
    patch.canManageEnemies = asBoolean(data.canManageEnemies, asBoolean(role.canManageEnemies));
    patch.canEditGroup = asBoolean(data.canEditGroup, asBoolean(role.canEditGroup));
  }

  await ref.set(patch, { merge: true });

  return { ok: true, roleId };
});

export const deleteAllyGroupRole = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const roleId = getTrimmedString(data.roleId);
  if (!roleId) {
    throw new HttpsError("invalid-argument", "roleId is required.");
  }

  const db = getDb();
  const ref = db.collection("ally_group_roles").doc(roleId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Role not found.");
  }

  const role = snap.data() ?? {};
  const groupId = asString(role.groupId);
  const key = asString(role.key);
  const isSystem = role.isSystem === true;

  await assertCanManageRoles(groupId, uid);

  if (isSystem) {
    throw new HttpsError("failed-precondition", "System roles cannot be deleted.");
  }
  if (key === "leader") {
    throw new HttpsError("failed-precondition", "Leader role cannot be deleted.");
  }

  const fallbackRoleId = `${groupId}__member`;

  const membersSnap = await db
    .collection("ally_group_members")
    .where("groupId", "==", groupId)
    .where("roleId", "==", roleId)
    .where("status", "==", "active")
    .get();

  const batch = db.batch();
  membersSnap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        roleId: fallbackRoleId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  batch.delete(ref);
  await batch.commit();

  return { ok: true, roleId, reassignedMembers: membersSnap.size };
});

export const assignAllyGroupMemberRole = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const groupId = getTrimmedString(data.groupId);
  const targetUid = getTrimmedString(data.targetUid);
  const roleId = getTrimmedString(data.roleId);

  if (!groupId || !targetUid || !roleId) {
    throw new HttpsError("invalid-argument", "groupId, targetUid, and roleId are required.");
  }

  await assertCanManageMembers(groupId, uid);

  const role = await getRoleDoc(groupId, roleId);
  if (!role) {
    throw new HttpsError("not-found", "Target role not found.");
  }
  if (asString(role.data.key) === "leader") {
    throw new HttpsError(
      "failed-precondition",
      "Use transferAllyGroupLeadership to assign leader role."
    );
  }

  const member = await getActiveGroupMember(groupId, targetUid);
  if (!member) {
    throw new HttpsError("not-found", "Target user is not an active member.");
  }
  if (member.data.isLeader === true) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot directly change the leader role here. Use transfer leadership."
    );
  }

  await member.ref.set(
    {
      roleId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, groupId, targetUid, roleId };
});

export const transferAllyGroupLeadership = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const groupId = getTrimmedString(data.groupId);
  const newLeaderUid = getTrimmedString(data.newLeaderUid);

  if (!groupId || !newLeaderUid) {
    throw new HttpsError("invalid-argument", "groupId and newLeaderUid are required.");
  }

  const group = await getGroupDocOrThrow(groupId);
  if (asString(group.data.leaderUid) !== uid) {
    throw new HttpsError("permission-denied", "Only the current leader can transfer leadership.");
  }

  const currentLeaderMember = await getActiveGroupMember(groupId, uid);
  const newLeaderMember = await getActiveGroupMember(groupId, newLeaderUid);

  if (!currentLeaderMember || !newLeaderMember) {
    throw new HttpsError("not-found", "Leader or target member not found.");
  }

  const db = getDb();
  const batch = db.batch();

  batch.set(
    currentLeaderMember.ref,
    {
      isLeader: false,
      roleId: `${groupId}__president`,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    newLeaderMember.ref,
    {
      isLeader: true,
      roleId: `${groupId}__leader`,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    group.ref,
    {
      leaderUid: newLeaderUid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    db.collection("users").doc(uid),
    {
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    db.collection("users").doc(newLeaderUid),
    {
      primaryAllyGroupId: groupId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return { ok: true, groupId, previousLeaderUid: uid, newLeaderUid };
});

export const declareEnemyRelation = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const sourceType = getTrimmedString(data.sourceType) as EnemySourceType;
  const sourceId = getTrimmedString(data.sourceId);
  const targetType = getTrimmedString(data.targetType) as EnemyTargetType;
  const targetId = getTrimmedString(data.targetId);

  if (!sourceType || !sourceId || !targetType || !targetId) {
    throw new HttpsError(
      "invalid-argument",
      "sourceType, sourceId, targetType, and targetId are required."
    );
  }

  if (sourceId === targetId && sourceType === targetType) {
    throw new HttpsError("invalid-argument", "An entity cannot be enemy to itself.");
  }

  assertEnemyCombinationAllowed(sourceType, targetType);

  if (sourceType === "user") {
    if (sourceId !== uid) {
      throw new HttpsError("permission-denied", "Users may only declare enemies for themselves.");
    }
  } else {
    await assertCanManageEnemies(sourceId, uid);
  }

  if (targetType === "ally_group") {
    await getGroupDocOrThrow(targetId);
  } else {
    const targetUser = await getDb().collection("users").doc(targetId).get();
    if (!targetUser.exists) {
      throw new HttpsError("not-found", "Target user not found.");
    }
  }

  const db = getDb();
  const docId = getEnemyRelationDocId(sourceType, sourceId, targetType, targetId);
  const reverseDocId = getEnemyRelationDocId(targetType, targetId, sourceType, sourceId);

  const ref = db.collection("enemy_relations").doc(docId);
  const reverseRef = db.collection("enemy_relations").doc(reverseDocId);

  await ref.set(
    {
      sourceType,
      sourceId,
      targetType,
      targetId,
      status: "active",
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (
    (sourceType === "ally_group" && targetType === "ally_group") ||
    (sourceType === "user" && targetType === "user")
  ) {
    await reverseRef.set(
      {
        sourceType: targetType,
        sourceId: targetId,
        targetType: sourceType,
        targetId: sourceId,
        status: "active",
        createdByUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    ok: true,
    relationId: docId,
    sourceType,
    sourceId,
    targetType,
    targetId,
  };
});

export const removeEnemyRelation = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const sourceType = getTrimmedString(data.sourceType) as EnemySourceType;
  const sourceId = getTrimmedString(data.sourceId);
  const targetType = getTrimmedString(data.targetType) as EnemyTargetType;
  const targetId = getTrimmedString(data.targetId);

  if (!sourceType || !sourceId || !targetType || !targetId) {
    throw new HttpsError(
      "invalid-argument",
      "sourceType, sourceId, targetType, and targetId are required."
    );
  }

  assertEnemyCombinationAllowed(sourceType, targetType);

  if (sourceType === "user") {
    if (sourceId !== uid) {
      throw new HttpsError("permission-denied", "Users may only remove their own enemies.");
    }
  } else {
    await assertCanManageEnemies(sourceId, uid);
  }

  const db = getDb();
  const docId = getEnemyRelationDocId(sourceType, sourceId, targetType, targetId);
  const reverseDocId = getEnemyRelationDocId(targetType, targetId, sourceType, sourceId);

  const ref = db.collection("enemy_relations").doc(docId);
  await ref.set(
    {
      status: "removed",
      updatedAt: FieldValue.serverTimestamp(),
      removedByUid: uid,
    },
    { merge: true }
  );

  if (
    (sourceType === "ally_group" && targetType === "ally_group") ||
    (sourceType === "user" && targetType === "user")
  ) {
    await db.collection("enemy_relations").doc(reverseDocId).set(
      {
        status: "removed",
        updatedAt: FieldValue.serverTimestamp(),
        removedByUid: uid,
      },
      { merge: true }
    );
  }

  return { ok: true, relationId: docId };
});

export const listEnemyRelations = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const sourceType = getTrimmedString(data.sourceType) as EnemySourceType;
  const sourceId = getTrimmedString(data.sourceId);

  if (!sourceType || !sourceId) {
    throw new HttpsError("invalid-argument", "sourceType and sourceId are required.");
  }

  if (sourceType === "user") {
    if (sourceId !== uid) {
      throw new HttpsError("permission-denied", "Users may only list their own enemies.");
    }
  } else {
    await getRolePermissionsForMember(sourceId, uid);
  }

  const db = getDb();
  const snap = await db
    .collection("enemy_relations")
    .where("sourceType", "==", sourceType)
    .where("sourceId", "==", sourceId)
    .where("status", "==", "active")
    .get();

  const items = snap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));

  return { ok: true, items };
});

export const listAllyGroupMembersWithRoles = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const groupId = getTrimmedString(data.groupId);

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  await getRolePermissionsForMember(groupId, uid);

  const db = getDb();
  const [membersSnap, rolesSnap] = await Promise.all([
    db
      .collection("ally_group_members")
      .where("groupId", "==", groupId)
      .where("status", "==", "active")
      .get(),
    db.collection("ally_group_roles").where("groupId", "==", groupId).get(),
  ]);

  const roleMap = new Map<string, Record<string, unknown>>(
    rolesSnap.docs.map((doc) => [
      doc.id,
      {
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      },
    ])
  );

  const items = membersSnap.docs.map((doc) => {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const roleId = asString(data.roleId);
    const role = roleMap.get(roleId);

    return {
      id: doc.id,
      ...data,
      roleName: role ? asString(role["name"]) : null,
      roleKey: role ? asString(role["key"]) : null,
    };
  });

  return { ok: true, items };
});

export const inviteToAllyGroupV2 = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const groupId = getTrimmedString(data.groupId);
  const targetUid = getTrimmedString(data.uid || data.targetUid);

  if (!groupId || !targetUid) {
    throw new HttpsError("invalid-argument", "groupId and targetUid are required.");
  }

  await assertCanManageMembers(groupId, uid);

  const group = await getGroupDocOrThrow(groupId);
  const maxMembers = asNumber(group.data.maxMembers, 2);
  const activeCount = await countGroupMembers(groupId);

  if (activeCount >= maxMembers) {
    throw new HttpsError("failed-precondition", "Ally group is already at max capacity.");
  }

  const existingMember = await getActiveGroupMember(groupId, targetUid);
  if (existingMember) {
    throw new HttpsError("already-exists", "User is already an active member.");
  }

  const db = getDb();
  const inviteRef = db.collection("ally_group_members").doc(`${groupId}__${targetUid}`);

  await inviteRef.set(
    {
      groupId,
      uid: targetUid,
      status: "invited",
      roleId: `${groupId}__recruit`,
      isLeader: false,
      invitedByUid: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, groupId, targetUid, invited: true };
});

export const acceptAllyGroupInviteV2 = onCall(async (request) => {
  const uid = requireAuthUid(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const groupId = getTrimmedString(data.groupId);

  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const db = getDb();
  const inviteRef = db.collection("ally_group_members").doc(`${groupId}__${uid}`);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "Invite not found.");
  }

  const invite = inviteSnap.data() ?? {};
  if (asString(invite.status) !== "invited") {
    throw new HttpsError("failed-precondition", "Invite is not active.");
  }

  const existingMemberships = await db
    .collection("ally_group_members")
    .where("uid", "==", uid)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!existingMemberships.empty) {
    throw new HttpsError(
      "failed-precondition",
      "User is already an active member of another ally group."
    );
  }

  const group = await getGroupDocOrThrow(groupId);
  const maxMembers = asNumber(group.data.maxMembers, 2);
  const activeCount = await countGroupMembers(groupId);

  if (activeCount >= maxMembers) {
    throw new HttpsError("failed-precondition", "Ally group is already at max capacity.");
  }

  await inviteRef.set(
    {
      status: "active",
      joinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("users").doc(uid).set(
    {
      primaryAllyGroupId: groupId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, groupId, uid, joined: true };
});