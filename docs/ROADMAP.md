# TrApp — review findings & roadmap (2026-11-02)

Based on a read-only review of `android/` (≈16k lines Kotlin, v0.3.9/24) and `backend/` (Cloud Functions, rules, admin web).
Severity: 🔴 blocks release / security hole · 🟠 fix before scaling · 🟢 improvement.

---

## 0. Do first — secrets (🔴)

The old local backend folder (`C:\firebase\trap-firebase-template`) had a git history with
`serviceAccountKey.json` and `functions/.env` committed (its ignore file was named `.gitignore-firebase-template`, so it never applied),
and `functions/.env.example` contained the real SMTP password. **This repo was started with a clean history and none of these files**, but:

- [ ] Rotate the Firebase service-account key (Console → Service accounts → delete old key, create new).
- [ ] Change the SMTP mailbox password (`playtrap@fairco.hu`).
- [ ] Never push the old folder's history anywhere.
- [ ] Restrict the Maps API key (Android app + SHA-1) and the Firebase web API key (HTTP referrers) in Google Cloud.
- [ ] Enable **Play App Signing**; keep `trap-release.jks` + passwords in a password manager, not next to the project.

## 1. Google Play blockers

| # | Issue | Where | Fix |
|---|---|---|---|
| 🔴 | Premium (bigger bag, faster actions, no ads) sold via Revolut/Stripe web checkout | `SubscriptionActivity.kt:179-207` | Play Billing subscriptions/IAP for in-game benefits; keep Stripe/Revolut only for the web/admin side. Donations without in-game benefit can stay external only in some regions — safest is Play Billing too. |
| 🔴 | No in-app account deletion (+ web deletion URL) | — | Callable `deleteMyAccount` (Auth + Firestore + Storage cleanup) + Settings button + public web page on Hosting |
| 🔴 | `POST_NOTIFICATIONS` never requested → all alerts silent on Android 13+ | `AndroidManifest.xml:9` | Runtime request after onboarding |
| 🔴 | `ACCESS_BACKGROUND_LOCATION` declared, never requested; boot-start of location FGS crashes on Android 14+ | `BootReceiver.kt:26`, `LocationTrackingService.kt:100` | Remove background location + BootReceiver, or make tracking an explicit opt-in "Hunt mode" with proper declaration/video |
| 🟠 | targetSdk 35 — Play now expects 36 | `app/build.gradle.kts` | Bump to 36, fix edge-to-edge insets on the 17 View screens |
| 🟠 | `setFullScreenIntent` without `USE_FULL_SCREEN_INTENT` (alarm/calling apps only) | `NotificationHelper.kt:144` | Drop full-screen intent; use high-priority heads-up |
| 🟠 | Live AdMob unit IDs hard-coded → debug builds serve real ads | `AdManager.kt:23,89` | Test IDs in debug via BuildConfig |
| 🟢 | `firebase-appcheck-debug` shipped in release | `app/build.gradle.kts` | `debugImplementation` |
| 🟢 | `READ_CONTACTS` for invites | `InviteFriendsActivity.kt` | Replace with share sheet → no sensitive permission |

**Data safety form** must list: precise location (continuously sent), name, birth date, gender, email, advertising ID, messages, contacts (on device), purchases.

## 2. Backend security (🔴/🟠)

1. 🔴 **Players can edit their own user doc almost freely** (`firestore.rules:31-33`): `levelId`, `membership`, `xp`, `emailVerified`, `username`, `role`… → allowlist with `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])`.
2. 🔴 **App Check not enforced** (`shared/appCheck.ts` only logs) → enforce on all callables after iOS App Attest is registered.
3. 🔴 **Any signed-in user can reset the trap catalogue** (`seedTrapDefinitions`, `traps/gameplay.ts:1001`) → admin-only or delete.
4. 🔴 **Revolut webhook** skips verification when no secret, and parses a Stripe-style header (`revolut/webhook.ts:26`, `revolut/api.ts:151`) → verify `Revolut-Signature` over `v1.{timestamp}.{body}`, reject when unset, re-fetch the order.
5. 🔴 **Rewarded ads can be faked** (`claimAdReward.ts`) → verify AdMob SSV ECDSA signature; grant only from SSV.
6. 🟠 **Exact location of every player within 10 km** returned by `listNearbyUsers`; caller's location is client-supplied → coarse/jittered positions, opt-in visibility, use server-stored last position.
7. 🟢 Stripe `returnUrl` open redirect; public `debugAuth` callable; unescaped `displayName` in email HTML.

## 3. Email & deliverability — Resend

Today two parallel paths: `.env` SMTP (verification, reset, test send, newsletter) and Firestore-configured SES/SMTP (purchase, reminders, inactivity). The admin "test send" doesn't test the provider actually used.

**Step A — no code change (today):**
1. Resend → add domain (e.g. `mail.playtrap.app` / `fairco.hu` sub-domain) → add SPF, DKIM (`resend._domainkey`), MX for bounce, and a DMARC record (`p=none` → later `quarantine`).
2. `functions/.env`: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASS=<re_ key>`, `SMTP_FROM_EMAIL=noreply@<verified domain>` (see `.env.example`).
3. Clear `smtpHost`/SES fields in the admin "Email automation" settings so everything uses env.
   Note: the current `.env` has port 465 with `SMTP_SECURE=false` — that combination is wrong.

**Step B — proper provider (recommended):**
- `provider: "resend"` in `shared/email.ts` using the HTTP API (`fetch`, no new dependency), key via `defineSecret("RESEND_API_KEY")` (Secret Manager) — remove SMTP/SES passwords from Firestore.
- One `sendEmail()` for every mail; `Idempotency-Key`; `List-Unsubscribe` + one-click unsubscribe for newsletter/reminders.
- Resend webhook (Svix-signed) → `email_events` log + suppression list (bounces/complaints).
- Use only custom verification/reset emails (`generate*Link` + `actionCodeSettings` with own domain, Android package + iOS bundle ID); stop calling Firebase's built-in `sendEmailVerification()` from the app; set custom action URL so links aren't on `firebaseapp.com`.

**Admin "health" page (new):** provider in use per email type · test send through the real path · Resend domain DNS status (SPF/DKIM/DMARC) · last 50 sends + bounces · webhook last-received/failed counts (Stripe, Revolut, AdMob SSV, Resend) · App Check enforcement switch · last run of each scheduled job · rules/indexes deployed-vs-repo.

## 4. Environments & deploy

- Only `staging → playtrapnow` exists and it is effectively production; `playtrapnow` is hard-coded in `admin-web/src/firebase.ts`, `payments.ts`, `revolut/donations.ts`.
  → Create `playtrap-prod`, move IDs to env/config, Android `staging`/`prod` product flavors with separate `google-services.json`.
- Missing composite indexes for reminder/inactivity queries (`adminEmailAutomation.ts:314,421`).
- `maxInstances: 10` will throttle; consider `minInstances: 1` on hot gameplay callables.
- **CI (GitHub Actions):** Android `lint` + `assembleRelease` (secrets from GitHub Secrets) · functions `tsc` + rules unit tests on the emulator · manual-approval deploy to prod · Play internal-track upload (Gradle Play Publisher / fastlane).

## 5. Android correctness & redesign

- Notification "Disarm"/tap actions do nothing (extras never read) — `TrapProximityNotifier.kt:56`, `NotificationHelper.kt:114`.
- Proximity alerts only work while the game screen is open (`TrapDisarmViewModel` driven by `GameActivity`).
- `LocationTrackingService`: `ToneGenerator` in field initializer can crash; `startForeground` on every fix; 5 s high-accuracy GPS + a function call each time (battery & cost) → 15-30 s balanced + distance filter, server geofencing.
- Approximate location treated as denied (Android 12+).
- Release logs include part of the Maps key (`GameActivity.kt:558`) → strip `Log` in ProGuard.
- Dead code: `LauncherActivity.kt`, root `SplashActivity.kt`, `activity_main.xml`.

**Redesign:**
- One design system: 14 XML screens use Material 2, 7 Compose screens use M3 with 359 hard-coded colours → a single `TrapTheme` (M3, dark-first "radar" look, Exo2/Rajdhani type scale), migrate screens to Compose incrementally starting with Login/Register/Profile.
- Split `GameActivity` (2,404 lines) into map, HUD, menu and overlay components.
- 130+ hard-coded Compose strings and English-only notifications → move to `strings.xml`; Hebrew has 264/523 strings and no RTL check.
- Accessibility: content descriptions on icons, touch targets ≥48dp, colour-contrast check on the neon palette.

## 6. iOS app

Recommendation: **native SwiftUI** in `ios/` — the Android client is thin (59 callables, 11 listeners); there is little shared logic to justify KMP/Flutter, and native CoreLocation/watchOS matter most.

Needs: Firebase iOS SDK · MapKit or Google Maps SDK · **StoreKit 2** + App Store Server Notifications v2 endpoint that sets `levelId` · APNs key in FCM · App Attest for App Check · Sign in with Apple if any social login is added · universal links (`apple-app-site-association` on Hosting) · in-app account deletion.
Background: region monitoring (≤20 nearest traps) + server-side geofence → time-sensitive APNs push; no continuous polling.
Build: Xcode Cloud or GitHub Actions macOS runner / EAS-style cloud build (Windows can't build iOS). Apple Developer Program ($99/yr), D-U-N-S if publishing as a company.

## 7. Watch alarm

| Stage | Wear OS | Apple Watch |
|---|---|---|
| 1 — quick win | Phone notifications already mirror: add `WearableExtender` with a **Disarm** action + strong vibration pattern | iOS notifications mirror automatically; use `.timeSensitive` interruption level + custom haptic category |
| 2 — real "alarm" | Small `wear/` module: Data Layer message from one central `AlertDispatcher` (fed by FCM + location service) → full-screen alarm with haptics, distance/compass to the trap, Disarm / Snooze | watchOS app target: WatchConnectivity or direct APNs → alarm view with haptics + direction |
| 3 — standalone | Wear tile/complication "traps nearby", radar on the watch | Complication + Smart Stack widget |

Prerequisite for both: fix §5 so proximity alerts work in the background (server-side geofencing → push), otherwise the watch only rings when the phone app is open.

## 8. Feature ideas

- **Hunt mode** session (opt-in background tracking for 30/60 min) — solves the background-location policy problem and battery.
- Push digest ("3 traps placed near your home today"), streaks and daily quests.
- Safe zones (home/work/school) where traps can't be placed — also a safety requirement for a location game.
- Report/block players, rate-limit chat, profanity filter on usernames (store review asks for UGC moderation).
- Seasonal events & trap skins (ties in with Play Billing cosmetics).
- Referral codes instead of contact access.
- Crashlytics + Analytics funnels (onboarding → first trap → first catch) and Remote Config for game tuning.

## Suggested order

1. Secrets rotation · rules allowlist · webhook/ad-reward verification · App Check enforce (backend)
2. Notifications permission · account deletion · drop boot/background location · targetSdk 36 · Play Billing → **Play internal testing**
3. Resend (A today, B next) + admin health page
4. Prod Firebase project + CI
5. Design system + Compose migration
6. Wear OS stage 1→2
7. iOS SwiftUI app + Apple Watch
