# TrApp (PlayTrap)

Location-based trap game: place virtual traps on the map, catch other players, disarm traps, climb the rankings.

| Folder | What | Stack |
|---|---|---|
| `android/` | Android app (`com.fairco.trap`) | Kotlin, XML views + Jetpack Compose, Google Maps, Firebase |
| `backend/functions/` | Cloud Functions (game logic, payments, email, admin API) | TypeScript, Node 22, firebase-functions v7 |
| `backend/admin-web/` | Admin panel (Firebase Hosting) | React 18 + Vite |
| `backend/firestore.rules` | Firestore security rules + indexes | |
| `store-assets/` | Google Play listing graphics | |
| `ios/` *(planned)* | iOS app | see `docs/ROADMAP.md` |
| `wear/` *(planned)* | Wear OS / Apple Watch alarm | see `docs/ROADMAP.md` |

## Secrets (never in git)

| File | Where it goes | How to get it |
|---|---|---|
| `android/local.properties` | Android build | copy `android/local.properties.example`; `MAPS_API_KEY`, `ADMOB_APP_ID`, `KEYSTORE_*` |
| `android/app/google-services.json` | Android build | Firebase console → Project settings → Android app |
| release keystore (`*.jks`) | outside the repo, path in `KEYSTORE_FILE` | keep a backup offline; losing it blocks updates unless Play App Signing is enabled |
| `backend/functions/.env` | Functions runtime | copy `.env.example` (SMTP / Resend) |
| service-account JSON | local admin scripts only | Firebase console → Service accounts; prefer `gcloud auth application-default login` |

## Build & deploy

```bash
# Android release bundle
cd android && ./gradlew bundleRelease

# Backend
cd backend/functions && npm ci && npm run build
cd backend/admin-web && npm ci && npm run build
cd backend && firebase deploy --only functions,firestore,hosting
```

The Firebase project alias in `backend/.firebaserc` is `staging` → `playtrapnow`.
