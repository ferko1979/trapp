import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

/*
  Replace these values with your Firebase Web App config
  from Project settings -> General -> Your apps -> Web app
*/
const firebaseConfig = {
  apiKey: "AIzaSyC5crcuUQjj_oomDru83NyJQOfjtZAcE4k",
  authDomain: "playtrapnow.firebaseapp.com",
  projectId: "playtrapnow",
  storageBucket: "playtrapnow.firebasestorage.app",
  messagingSenderId: "288165392573",
  appId: "1:288165392573:web:99bc3b8d75f90a5dfe07d4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "europe-west1");
