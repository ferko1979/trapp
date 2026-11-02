import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDb } from "./shared/firebase";
import {
  appendConversationMessage,
  getUserPublic,
} from "./messages";
import { requireUser as requireAuthUid } from "./shared/appCheck";
import { requireAdmin } from "./shared/admin";

type SupportCategory =
  | "email_change"
  | "bug_report"
  | "account"
  | "billing"
  | "general";

type SupportPriority = "low" | "normal" | "high" | "urgent";
type SupportStatus =
  | "open"
  | "waiting_admin"
  | "waiting_user"
  | "answered"
  | "closed";

type AttachmentInput = {
  path: string;
  fileName: string;
  contentType?: string;
  sizeBytes?: number;
  downloadURL?: string;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeCategory(value: unknown): SupportCategory {
  const v = asString(value);
  if (
    v === "email_change" ||
    v === "bug_report" ||
    v === "account" ||
    v === "billing" ||
    v === "general"
  ) {
    return v;
  }
  return "general";
}

function normalizePriority(value: unknown): SupportPriority {
  const v = asString(value);
  if (v === "low" || v === "normal" || v === "high" || v === "urgent") {
    return v;
  }
  return "normal";
}

function normalizeStatus(value: unknown): SupportStatus {
  const v = asString(value);
  if (
    v === "open" ||
    v === "waiting_admin" ||
    v === "waiting_user" ||
    v === "answered" ||
    v === "closed"
  ) {
    return v;
  }
  return "open";
}

function normalizeAttachments(value: unknown): AttachmentInput[] {
  if (!Array.isArray(value)) return [];

  const result: AttachmentInput[] = [];

  for (const item of value) {
    const row = item as Record<string, unknown>;
    const path = asString(row.path).trim();
    const fileName = asString(row.fileName).trim();

    if (!path || !fileName) continue;

    result.push({
      path,
      fileName,
      contentType: asString(row.contentType) || undefined,
      sizeBytes:
        typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes)
          ? row.sizeBytes
          : undefined,
      downloadURL: asString(row.downloadURL) || undefined,
    });
  }

  return result;
}

async function nextTicketNo(): Promise<string> {
  const db = getDb();
  const counterRef = db.collection("counters").doc("support_tickets");

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() ?? {};
    const current = typeof data.current === "number" ? data.current : 0;
    const next = current + 1;

    tx.set(
      counterRef,
      {
        current: next,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return next;
  });

  return `TCK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
    result
  ).padStart(4, "0")}`;
}

async function recomputeAwaitingAdminCount() {
  const db = getDb();
  const snap = await db
    .collection("support_tickets")
    .where("hasUnreadAdmin", "==", true)
    .get();

  const count = snap.docs.reduce((sum, doc) => {
    const data = doc.data();
    return data.status === "closed" ? sum : sum + 1;
  }, 0);

  await db.collection("admin_metrics").doc("support").set(
    {
      awaitingAdminCount: count,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Replace this with your real provider later.
 */
async function notifyAdminsByEmail(params: {
  ticketId: string;
  ticketNo: string;
  subject: string;
  category: SupportCategory;
  createdByName: string;
  createdByEmail: string;
}) {
  logger.info("notifyAdminsByEmail stub", params);
}

async function getPrimaryAdminUid(): Promise<string | null> {
  const db = getDb();

  const snap = await db
    .collection("users")
    .where("isAdmin", "==", true)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].id;

  const fallback = await db
    .collection("users")
    .where("admin", "==", true)
    .limit(1)
    .get();
  if (!fallback.empty) return fallback.docs[0].id;

  const fallbackRole = await db
    .collection("users")
    .where("role", "==", "admin")
    .limit(1)
    .get();
  if (!fallbackRole.empty) return fallbackRole.docs[0].id;

  return null;
}

export const createSupportTicket = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;

    const subject = asString(data.subject).trim();
    const text = asString(data.message).trim();
    const category = normalizeCategory(data.category);
    const priority = normalizePriority(data.priority);
    const attachments = normalizeAttachments(data.attachments);

    if (!subject) {
      throw new HttpsError("invalid-argument", "subject is required.");
    }
    if (!text) {
      throw new HttpsError("invalid-argument", "message is required.");
    }
    if (subject.length > 200) {
      throw new HttpsError("invalid-argument", "subject is too long.");
    }
    if (text.length > 5000) {
      throw new HttpsError("invalid-argument", "message is too long.");
    }

    const db = getDb();
    const user = await getUserPublic(uid);
    const ticketNo = await nextTicketNo();

    const ticketRef = db.collection("support_tickets").doc();
    const messageRef = ticketRef.collection("messages").doc();

    await db.runTransaction(async (tx) => {
      tx.set(ticketRef, {
        ticketNo,
        createdByUid: uid,
        createdByName: user.name,
        createdByEmail: user.email,
        createdByUsername: user.username,
        category,
        priority,
        subject,
        status: "open",
        assignedAdminUid: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageBy: "user",
        closedAt: null,
        messagesCount: 1,
        hasUnreadAdmin: true,
        hasUnreadUser: false,
        firstAttachmentCount: attachments.length,
      });

      tx.set(messageRef, {
        senderUid: uid,
        senderType: "user",
        senderName: user.name,
        senderUsername: user.username,
        text,
        createdAt: FieldValue.serverTimestamp(),
        isInternal: false,
        attachmentCount: attachments.length,
      });

      for (const attachment of attachments) {
        tx.set(messageRef.collection("attachments").doc(), {
          path: attachment.path,
          fileName: attachment.fileName,
          contentType: attachment.contentType ?? null,
          sizeBytes: attachment.sizeBytes ?? null,
          downloadURL: attachment.downloadURL ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    await recomputeAwaitingAdminCount();

    await notifyAdminsByEmail({
      ticketId: ticketRef.id,
      ticketNo,
      subject,
      category,
      createdByName: user.name,
      createdByEmail: user.email,
    });

    const primaryAdminUid = await getPrimaryAdminUid();
    if (primaryAdminUid && primaryAdminUid !== uid) {
      await appendConversationMessage({
        senderUid: uid,
        recipientUid: primaryAdminUid,
        text: `[Support ${ticketNo}] ${subject}\n\n${text}`,
        conversationKind: "support",
        supportTicketId: ticketRef.id,
        supportTicketNo: ticketNo,
        meta: {
          supportCategory: category,
          supportPriority: priority,
        },
      });
    }

    return {
      ok: true,
      ticketId: ticketRef.id,
      ticketNo,
    };
  } catch (error) {
    logger.error("createSupportTicket crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const listMySupportTickets = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const db = getDb();

    const snap = await db
      .collection("support_tickets")
      .where("createdByUid", "==", uid)
      .orderBy("lastMessageAt", "desc")
      .get();

    const items = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ticketNo: asString(data.ticketNo),
        category: asString(data.category),
        priority: asString(data.priority),
        subject: asString(data.subject),
        status: asString(data.status),
        messagesCount:
          typeof data.messagesCount === "number" ? data.messagesCount : 0,
        hasUnreadUser: data.hasUnreadUser === true,
        hasUnreadAdmin: data.hasUnreadAdmin === true,
        createdAtEpochMs:
          data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
        lastMessageAtEpochMs:
          data.lastMessageAt instanceof Timestamp
            ? data.lastMessageAt.toMillis()
            : null,
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("listMySupportTickets crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const getSupportTicketThread = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const ticketId = asString(data.ticketId).trim();

    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId is required.");
    }

    const db = getDb();
    const ticketRef = db.collection("support_tickets").doc(ticketId);
    const ticketSnap = await ticketRef.get();
    const ticket = ticketSnap.data();

    if (!ticket) {
      throw new HttpsError("not-found", "Ticket not found.");
    }
    if (ticket.createdByUid !== uid) {
      throw new HttpsError("permission-denied", "Not your ticket.");
    }

    const messagesSnap = await ticketRef
      .collection("messages")
      .orderBy("createdAt", "asc")
      .get();

    const messages = await Promise.all(
      messagesSnap.docs.map(async (doc) => {
        const row = doc.data();
        const attachmentsSnap = await doc.ref.collection("attachments").get();

        return {
          id: doc.id,
          senderUid: asString(row.senderUid),
          senderType: asString(row.senderType),
          senderName: asString(row.senderName),
          senderUsername: asString(row.senderUsername),
          text: asString(row.text),
          isInternal: row.isInternal === true,
          createdAtEpochMs:
            row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
          attachments: attachmentsSnap.docs.map((a) => {
            const x = a.data();
            return {
              id: a.id,
              path: asString(x.path),
              fileName: asString(x.fileName),
              contentType: asString(x.contentType),
              sizeBytes: typeof x.sizeBytes === "number" ? x.sizeBytes : null,
              downloadURL: asString(x.downloadURL),
            };
          }),
        };
      })
    );

    if (ticket.hasUnreadUser === true) {
      await ticketRef.set(
        {
          hasUnreadUser: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      ok: true,
      ticket: {
        id: ticketRef.id,
        ticketNo: asString(ticket.ticketNo),
        category: asString(ticket.category),
        priority: asString(ticket.priority),
        subject: asString(ticket.subject),
        status: asString(ticket.status),
        messagesCount:
          typeof ticket.messagesCount === "number" ? ticket.messagesCount : 0,
      },
      messages,
    };
  } catch (error) {
    logger.error("getSupportTicketThread crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const replyToSupportTicket = onCall(async (request) => {
  try {
    const uid = requireAuthUid(request);
    const data = (request.data ?? {}) as Record<string, unknown>;

    const ticketId = asString(data.ticketId).trim();
    const text = asString(data.message).trim();
    const attachments = normalizeAttachments(data.attachments);

    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId is required.");
    }
    if (!text) {
      throw new HttpsError("invalid-argument", "message is required.");
    }

    const db = getDb();
    const user = await getUserPublic(uid);
    const ticketRef = db.collection("support_tickets").doc(ticketId);
    const messageRef = ticketRef.collection("messages").doc();

    let ticketNo = "";
    let subject = "";
    let adminUid: string | null = null;

    await db.runTransaction(async (tx) => {
      const ticketSnap = await tx.get(ticketRef);
      const ticket = ticketSnap.data();

      if (!ticket) {
        throw new HttpsError("not-found", "Ticket not found.");
      }
      if (ticket.createdByUid !== uid) {
        throw new HttpsError("permission-denied", "Not your ticket.");
      }
      if (ticket.status === "closed") {
        throw new HttpsError("failed-precondition", "Ticket is closed.");
      }

      ticketNo = asString(ticket.ticketNo);
      subject = asString(ticket.subject);
      adminUid = asString(ticket.assignedAdminUid) || null;

      const currentMessagesCount =
        typeof ticket.messagesCount === "number" ? ticket.messagesCount : 0;

      tx.set(messageRef, {
        senderUid: uid,
        senderType: "user",
        senderName: user.name,
        senderUsername: user.username,
        text,
        createdAt: FieldValue.serverTimestamp(),
        isInternal: false,
        attachmentCount: attachments.length,
      });

      for (const attachment of attachments) {
        tx.set(messageRef.collection("attachments").doc(), {
          path: attachment.path,
          fileName: attachment.fileName,
          contentType: attachment.contentType ?? null,
          sizeBytes: attachment.sizeBytes ?? null,
          downloadURL: attachment.downloadURL ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(
        ticketRef,
        {
          status: "waiting_admin",
          updatedAt: FieldValue.serverTimestamp(),
          lastMessageAt: FieldValue.serverTimestamp(),
          lastMessageBy: "user",
          messagesCount: currentMessagesCount + 1,
          hasUnreadAdmin: true,
          hasUnreadUser: false,
        },
        { merge: true }
      );
    });

    await recomputeAwaitingAdminCount();

    const targetAdminUid = adminUid ?? (await getPrimaryAdminUid());
    if (targetAdminUid && targetAdminUid !== uid) {
      await appendConversationMessage({
        senderUid: uid,
        recipientUid: targetAdminUid,
        text: `[Support ${ticketNo}] ${subject}\n\n${text}`,
        conversationKind: "support",
        supportTicketId: ticketId,
        supportTicketNo: ticketNo,
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("replyToSupportTicket crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminListSupportTickets = onCall(async (request) => {
  try {
    requireAdmin(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const statusFilter = asString(data.status).trim();
    const db = getDb();

    let query = db.collection("support_tickets").orderBy("lastMessageAt", "desc");
    if (statusFilter) {
      query = query.where("status", "==", normalizeStatus(statusFilter)) as typeof query;
    }

    const snap = await query.get();

    const items = snap.docs.map((doc) => {
      const row = doc.data();
      return {
        id: doc.id,
        ticketNo: asString(row.ticketNo),
        createdByUid: asString(row.createdByUid),
        createdByName: asString(row.createdByName),
        createdByEmail: asString(row.createdByEmail),
        createdByUsername: asString(row.createdByUsername),
        category: asString(row.category),
        priority: asString(row.priority),
        subject: asString(row.subject),
        status: asString(row.status),
        assignedAdminUid: asString(row.assignedAdminUid),
        hasUnreadAdmin: row.hasUnreadAdmin === true,
        hasUnreadUser: row.hasUnreadUser === true,
        messagesCount:
          typeof row.messagesCount === "number" ? row.messagesCount : 0,
        createdAtEpochMs:
          row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
        lastMessageAtEpochMs:
          row.lastMessageAt instanceof Timestamp
            ? row.lastMessageAt.toMillis()
            : null,
      };
    });

    return { ok: true, items };
  } catch (error) {
    logger.error("adminListSupportTickets crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminGetSupportStats = onCall(async (request) => {
  try {
    requireAdmin(request);

    const db = getDb();

    // Full scan — same approach as adminListSupportTickets which is known to work.
    // Count statuses manually so we're not dependent on Firestore index queries.
    const snap = await db.collection("support_tickets").get();

    const counts: Record<string, number> = {
      open: 0,
      waiting_admin: 0,
      waiting_user: 0,
      answered: 0,
      closed: 0,
    };

    for (const doc of snap.docs) {
      const status = asString(doc.data().status);
      if (status in counts) {
        counts[status]++;
      }
    }

    logger.info("adminGetSupportStats full scan", {
      totalDocs: snap.size,
      counts,
    });

    const open        = counts["open"] ?? 0;
    const waitingAdmin = counts["waiting_admin"] ?? 0;
    const waitingUser  = counts["waiting_user"] ?? 0;
    const answered     = counts["answered"] ?? 0;
    const closed       = counts["closed"] ?? 0;
    const total        = snap.size;
    const needsAttention = open + waitingAdmin;

    return {
      ok: true,
      // New fields expected by DashboardHome.tsx
      open,
      waitingAdmin,
      waitingUser,
      answered,
      closed,
      total,
      needsAttention,
      unreadByAdmin: needsAttention,
      // Legacy field expected by SupportOverviewPanel.tsx
      awaitingAdminCount: waitingAdmin,
      updatedAtEpochMs: Date.now(),
    };
  } catch (error) {
    logger.error("adminGetSupportStats crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminGetSupportTicketThread = onCall(async (request) => {
  try {
    requireAdmin(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const ticketId = asString(data.ticketId).trim();

    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId is required.");
    }

    const db = getDb();
    const ticketRef = db.collection("support_tickets").doc(ticketId);
    const ticketSnap = await ticketRef.get();
    const ticket = ticketSnap.data();

    if (!ticket) {
      throw new HttpsError("not-found", "Ticket not found.");
    }

    const messagesSnap = await ticketRef
      .collection("messages")
      .orderBy("createdAt", "asc")
      .get();

    const messages = await Promise.all(
      messagesSnap.docs.map(async (doc) => {
        const row = doc.data();
        const attachmentsSnap = await doc.ref.collection("attachments").get();

        return {
          id: doc.id,
          senderUid: asString(row.senderUid),
          senderType: asString(row.senderType),
          senderName: asString(row.senderName),
          senderUsername: asString(row.senderUsername),
          text: asString(row.text),
          isInternal: row.isInternal === true,
          createdAtEpochMs:
            row.createdAt instanceof Timestamp ? row.createdAt.toMillis() : null,
          attachments: attachmentsSnap.docs.map((a) => {
            const x = a.data();
            return {
              id: a.id,
              path: asString(x.path),
              fileName: asString(x.fileName),
              contentType: asString(x.contentType),
              sizeBytes: typeof x.sizeBytes === "number" ? x.sizeBytes : null,
              downloadURL: asString(x.downloadURL),
            };
          }),
        };
      })
    );

    if (ticket.hasUnreadAdmin === true) {
      await ticketRef.set(
        {
          hasUnreadAdmin: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await recomputeAwaitingAdminCount();
    }

    return {
      ok: true,
      ticket: {
        id: ticketRef.id,
        ticketNo: asString(ticket.ticketNo),
        createdByUid: asString(ticket.createdByUid),
        createdByName: asString(ticket.createdByName),
        createdByEmail: asString(ticket.createdByEmail),
        createdByUsername: asString(ticket.createdByUsername),
        category: asString(ticket.category),
        priority: asString(ticket.priority),
        subject: asString(ticket.subject),
        status: asString(ticket.status),
        assignedAdminUid: asString(ticket.assignedAdminUid),
        messagesCount:
          typeof ticket.messagesCount === "number" ? ticket.messagesCount : 0,
      },
      messages,
    };
  } catch (error) {
    logger.error("adminGetSupportTicketThread crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});

export const adminReplyToSupportTicket = onCall(async (request) => {
  try {
    const uid = requireAdmin(request);
    const admin = await getUserPublic(uid);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const ticketId = asString(data.ticketId).trim();
    const text = asString(data.message).trim();
    const attachments = normalizeAttachments(data.attachments);
    const nextStatus = data.status ? normalizeStatus(data.status) : "answered";

    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId is required.");
    }
    if (!text) {
      throw new HttpsError("invalid-argument", "message is required.");
    }

    const db = getDb();
    const ticketRef = db.collection("support_tickets").doc(ticketId);
    const messageRef = ticketRef.collection("messages").doc();

    let ticketNo = "";
    let subject = "";
    let createdByUid = "";

    await db.runTransaction(async (tx) => {
      const ticketSnap = await tx.get(ticketRef);
      const ticket = ticketSnap.data();

      if (!ticket) {
        throw new HttpsError("not-found", "Ticket not found.");
      }

      ticketNo = asString(ticket.ticketNo);
      subject = asString(ticket.subject);
      createdByUid = asString(ticket.createdByUid);

      const currentMessagesCount =
        typeof ticket.messagesCount === "number" ? ticket.messagesCount : 0;

      tx.set(messageRef, {
        senderUid: uid,
        senderType: "admin",
        senderName: admin.name,
        senderUsername: admin.username,
        text,
        createdAt: FieldValue.serverTimestamp(),
        isInternal: false,
        attachmentCount: attachments.length,
      });

      for (const attachment of attachments) {
        tx.set(messageRef.collection("attachments").doc(), {
          path: attachment.path,
          fileName: attachment.fileName,
          contentType: attachment.contentType ?? null,
          sizeBytes: attachment.sizeBytes ?? null,
          downloadURL: attachment.downloadURL ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(
        ticketRef,
        {
          status: nextStatus,
          assignedAdminUid: uid,
          updatedAt: FieldValue.serverTimestamp(),
          lastMessageAt: FieldValue.serverTimestamp(),
          lastMessageBy: "admin",
          messagesCount: currentMessagesCount + 1,
          hasUnreadAdmin: false,
          hasUnreadUser: true,
          closedAt: nextStatus === "closed" ? FieldValue.serverTimestamp() : null,
        },
        { merge: true }
      );
    });

    await recomputeAwaitingAdminCount();

    if (createdByUid && createdByUid !== uid) {
      await appendConversationMessage({
        senderUid: uid,
        recipientUid: createdByUid,
        text: `[Support ${ticketNo}] ${subject}\n\n${text}`,
        senderUsername: admin.username,
        conversationKind: "support",
        supportTicketId: ticketId,
        supportTicketNo: ticketNo,
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("adminReplyToSupportTicket crashed", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
});