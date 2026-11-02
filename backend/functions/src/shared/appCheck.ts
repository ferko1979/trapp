import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

/**
 * Enforces Firebase App Check on the request when APP_CHECK_ENFORCE=true.
 *
 * Turn it on only after the Play App Signing SHA-256 (not the upload key) is
 * registered for Play Integrity, and App Attest for iOS — otherwise every
 * store-installed app is rejected. Until then missing tokens are only logged.
 */
export function requireAppCheck(request: CallableRequest<unknown>): void {
  if (request.app != undefined) return;
  if (process.env.APP_CHECK_ENFORCE === "true") {
    throw new HttpsError("failed-precondition", "App Check verification failed.");
  }
  console.warn("[AppCheck] Request missing valid App Check token — enforcement off (APP_CHECK_ENFORCE).");
}

/**
 * Enforces App Check + authentication.
 * Returns the authenticated UID.
 *
 * Drop-in replacement for all local requireAuthUid / requireAuth helpers.
 */
export function requireUser(request: CallableRequest<unknown>): string {
  requireAppCheck(request);
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  return uid;
}
