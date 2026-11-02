# Trap Firebase backend template

This template gives you a Firebase backend for **Trap** with:

- Firebase Authentication login
- Firestore storage for users, daily state, traps, captures, leaderboard
- Callable Cloud Functions for placing traps and checking captures
- A daily reset job at local midnight in `Europe/Budapest`
- Owner-only trap visibility through Firestore Security Rules

## Before you start

You already have a Firebase project. You still need to make sure these services are enabled in the Firebase console:

1. **Authentication**
2. **Cloud Firestore** in **Native mode**
3. **Cloud Functions**
4. **Billing / Blaze plan** if you want to deploy Cloud Functions and scheduled jobs

## What the backend does

### Main callable functions

- `bootstrapProfile`
  - Creates the user's `users/{uid}` doc if missing
  - Creates today's daily state if missing
- `placeTrap`
  - Validates the request
  - Checks today's remaining traps
  - Creates the trap
  - Deducts one available trap
- `updatePlayerLocation`
  - Stores the user's last location
  - Looks for nearby active traps
  - Captures the user if another player's trap is within range
  - Deducts 5 available traps from the captured user for the day
  - Increments the trap owner's capture count

### Scheduled jobs

- `resetDailyState`
  - Runs every day at `00:00:05` in `Europe/Budapest`
  - Expires all still-active traps
- `refreshLeaderboard`
  - Rebuilds the top 50 leaderboard every 10 minutes

## Firestore collections used

- `users/{uid}`
- `daily_state/{uid_YYYYMMDD}`
- `traps/{trapId}`
- `player_locations/{uid}`
- `captures/{captureId}`
- `leaderboard/global`

## Step by step setup

### 1. Install prerequisites

Install:

- Node.js 20
- npm
- Firebase CLI

Command:

```bash
npm install -g firebase-tools
```

### 2. Log in and link your project

```bash
firebase login
cd trap-firebase-template
cp .firebaserc.example .firebaserc
```

Open `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your real Firebase project ID.

### 3. Install functions dependencies

```bash
cd functions
npm install
cd ..
```

### 4. Deploy Firestore rules and indexes

```bash
firebase deploy --only firestore
```

### 5. Deploy functions

```bash
firebase deploy --only functions
```

### 6. Test locally with the emulator

From the project root:

```bash
firebase emulators:start
```

Open the Emulator UI at `http://127.0.0.1:4000`.

## Android client flow

### On sign-in

After Firebase Auth login succeeds, call:

- `bootstrapProfile({ platform: "android" })`

### When user places a trap

Call:

- `placeTrap({ lat, lng, radiusMeters: 25 })`

### When user location changes

Call:

- `updatePlayerLocation({ lat, lng })`

## Suggested Android callable example

Kotlin outline:

```kotlin
val functions = Firebase.functions("europe-west1")

functions
    .getHttpsCallable("bootstrapProfile")
    .call(mapOf("platform" to "android"))

functions
    .getHttpsCallable("placeTrap")
    .call(mapOf(
        "lat" to latitude,
        "lng" to longitude,
        "radiusMeters" to 25
    ))

functions
    .getHttpsCallable("updatePlayerLocation")
    .call(mapOf(
        "lat" to latitude,
        "lng" to longitude
    ))
```

## Suggested iOS callable example later

Swift outline:

```swift
let functions = Functions.functions(region: "europe-west1")

functions.httpsCallable("bootstrapProfile").call(["platform": "ios"])
functions.httpsCallable("placeTrap").call([
  "lat": lat,
  "lng": lng,
  "radiusMeters": 25
])
functions.httpsCallable("updatePlayerLocation").call([
  "lat": lat,
  "lng": lng
])
```

## Important game logic choices in this template

- Daily reset is keyed to `Europe/Budapest`
- Active traps expire at the next daily reset
- Capture radius defaults to **25 meters**
- If a player is captured, the penalty is `max(0, trapsAvailable - 5)` for that day
- Traps are readable only by their owner

## Next steps after backend deployment

1. Add App Check
2. Add rate limiting or anti-spam logic on `updatePlayerLocation`
3. Add push notifications on capture
4. Add a friends / party model if you later want selective visibility
5. Add emulator tests for rules and functions
