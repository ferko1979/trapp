const admin = require("firebase-admin");

// IMPORTANT: use your service account JSON
const serviceAccount = require("../../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uid = "zvA2V3tsCNRZmkaUi5zt5TxdnZu1";

async function makeAdmin() {
  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });

    console.log(`✅ User ${uid} is now ADMIN`);

    // optional: also update Firestore role field
    await admin.firestore().collection("users").doc(uid).set(
      {
        role: "admin",
      },
      { merge: true }
    );

    console.log("✅ Firestore role updated");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

makeAdmin();