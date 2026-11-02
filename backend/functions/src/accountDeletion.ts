/**
 * accountDeletion.ts
 *
 * Self-service account deletion (Google Play / GDPR Art. 17 requirement).
 *
 *   deleteMyAccount({ confirm: "DELETE" }) → { ok: true }
 *
 * Deletes ONLY the caller's own data (request.auth.uid). Accounting records
 * (payments, donations, subscriptions) are anonymised, not deleted — see
 * shared/userDataCleanup.ts. The Firebase Auth user is deleted last, so a
 * failed run can be retried by the still-signed-in client.
 *
 * Public description: https://playtrapnow.web.app/delete-account/
 */

import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { writeAuditLog } from "./adminAuditLog";
import { requireUser } from "./shared/appCheck";
import { deleteAuthUser, purgeUserData } from "./shared/userDataCleanup";

export const deleteMyAccount = onCall({ timeoutSeconds: 300 }, async (request) => {
  try {
    const uid = requireUser(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    if (data.confirm !== "DELETE") {
      throw new HttpsError(
        "invalid-argument",
        'Account deletion must be confirmed with { confirm: "DELETE" }.'
      );
    }

    logger.info("deleteMyAccount: started", { uid });
    const summary = await purgeUserData(uid);

    // No e-mail / name in the audit entry — only the (now orphaned) uid and counts.
    await writeAuditLog({
      adminUid: uid,
      adminName: "self-service",
      category: "users",
      action: "SELF_DELETE_ACCOUNT",
      targetId: uid,
      summary: "User deleted their own account from the app",
      details: summary,
    });

    await deleteAuthUser(uid);
    logger.info("deleteMyAccount: finished", { uid, summary });

    return { ok: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("deleteMyAccount: failed", error);
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Account deletion failed."
    );
  }
});
