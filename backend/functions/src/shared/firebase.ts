import { getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { Auth, getAuth } from "firebase-admin/auth";

let cachedDb: Firestore | null = null;
let cachedAuth: Auth | null = null;

function getAppInstance() {
  return getApps().length > 0 ? getApps()[0] : initializeApp();
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getAppInstance();
  cachedDb = getFirestore(app);
  return cachedDb;
}

export function getAdminAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app = getAppInstance();
  cachedAuth = getAuth(app);
  return cachedAuth;
}