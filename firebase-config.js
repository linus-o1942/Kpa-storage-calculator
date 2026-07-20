// ===========================================================
// OMLIN CONSULTANCY LTD — Firebase project configuration
// ===========================================================
// Replace every value below with the config object from:
// Firebase Console -> Project Settings -> General -> Your apps -> SDK setup and configuration
//
// This file is safe to be public (it ships to the browser). Firebase web
// API keys are not secret — real protection comes from Firestore Security
// Rules (see firestore.rules) and Firebase Authentication.
// ===========================================================
export const firebaseConfig = {
  apiKey: "AIzaSyC61kRpKd1gpak2bDYKu1dYOCTmAQ0s2To",
  authDomain: "storage-calculator-5ec12.firebaseapp.com",
  projectId: "storage-calculator-5ec12",
  storageBucket: "storage-calculator-5ec12.firebasestorage.app",
  messagingSenderId: "950186908261",
  appId: "1:950186908261:web:f50b34a65b9fdd8916848c"
};

// M-Pesa / WhatsApp business details used across the app
export const PAYMENT_INFO = {
  tillNumber: "3266806",
  whatsappNumber: "254708718180" // 0708 718 180 in international format
};

// Subscription plan definitions — change prices/durations here in one place
export const PLANS = {
  "2 Weeks": { label: "2 Weeks", price: 100, days: 14 },
  "1 Month": { label: "1 Month", price: 150, days: 30 }
};
