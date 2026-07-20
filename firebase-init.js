// ===========================================================
// OMLIN CONSULTANCY LTD — Firebase initialization
// Loaded as an ES module. No build step required — works as-is on Netlify.
// ===========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Keep users signed in across tabs/refreshes (Firebase's own secure session
// storage — not app data, and not used for subscription/access decisions).
setPersistence(auth, browserLocalPersistence).catch(() => {});
