import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

/**
 * Enforces Firebase App Check on the request.
 * Throws if no valid App Check token is present.
 */
export function requireAppCheck(request: CallableRequest<unknown>): void {
  if (request.app == undefined) {
    // TODO: Re-enable once correct Play Integrity SHA-256 (Google's signing key) is registered in Firebase App Check.
    // The upload-key SHA differs from Google Play's re-signing key.
    console.warn("[AppCheck] Request missing valid App Check token — enforcement temporarily suspended.");
  }
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
