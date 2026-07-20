// ===========================================================
// OMLIN CONSULTANCY LTD — Authentication helpers
// ===========================================================
import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Create a new account + matching Firestore profile document.
 * The Firestore document is created with subscription fields locked to
 * their safe defaults — the client is not permitted (by security rules)
 * to set plan/status/dates to anything else on creation.
 */
export async function signUp(name, email, password){
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    name: name,
    email: email,
    plan: "none",
    subscriptionStatus: "inactive",
    activatedAt: null,
    expiresAt: null,
    createdAt: serverTimestamp()
  });

  return cred.user;
}

export async function logIn(email, password){
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut(){
  await signOut(auth);
}

/** Fetch the caller's own Firestore profile document. */
export async function getUserProfile(uid){
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/** Check whether the given uid has an admin document (admins/{uid}). */
export async function isAdminUser(uid){
  const snap = await getDoc(doc(db, "admins", uid));
  return snap.exists();
}

/** Resolve once Firebase has determined the current auth state. */
export function waitForAuth(){
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/**
 * Renders the shared top navigation bar into el (a container element),
 * lighting up the active link and showing the subscription status pill.
 * Call after you know whether the user is logged in / their profile.
 */
export function renderNav(el, { activePage, user, profile, isAdmin }){
  const statusClass = profile ? computeLiveStatus(profile).status : "none";
  const statusLabel = {
    active: "Active", expired: "Expired", inactive: "Inactive", none: "No Plan"
  }[statusClass] || "No Plan";

  const link = (href, label, key) =>
    `<a href="${href}" class="${activePage === key ? 'active' : ''}">${label}</a>`;

  el.innerHTML = `
    <a class="brand-row" href="${user ? 'app.html' : 'login.html'}">
      <span class="brand-logo">${logoSvg()}</span>
      <span class="brand-name">
        <span class="co">OMLIN CONSULTANCY LTD</span>
        <span class="tag">Shipping · Customs · Logistics</span>
      </span>
    </a>
    <nav class="top-nav">
      ${user ? `
        ${link('app.html', 'Calculator', 'app')}
        ${link('account.html', 'My Subscription', 'account')}
        ${link('subscribe.html', 'Subscribe', 'subscribe')}
        ${isAdmin ? link('admin.html', 'Admin', 'admin') : ''}
        <span class="pill ${statusClass}">${statusLabel}</span>
        <button id="navLogoutBtn" title="Sign out">Sign out</button>
      ` : `
        ${link('login.html', 'Log In', 'login')}
        ${link('signup.html', 'Sign Up', 'signup')}
      `}
    </nav>
  `;

  const logoutBtn = document.getElementById('navLogoutBtn');
  if(logoutBtn){
    logoutBtn.addEventListener('click', async () => {
      await logOut();
      window.location.href = 'login.html';
    });
  }
}

export function logoSvg(){
  return `<svg width="22" height="22" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="24" cy="12" r="4.5" stroke="#C9A24A" stroke-width="2.2"/>
    <line x1="24" y1="16.5" x2="24" y2="38" stroke="#C9A24A" stroke-width="2.2"/>
    <line x1="15" y1="22" x2="33" y2="22" stroke="#C9A24A" stroke-width="2.2"/>
    <path d="M12 28c0 7 5.4 12.6 12 12.6S36 35 36 28" stroke="#C9A24A" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="12" y1="28" x2="12" y2="24" stroke="#C9A24A" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="36" y1="28" x2="36" y2="24" stroke="#C9A24A" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Compute the *live* subscription status from Firestore data — never from
 * localStorage or a browser timer. expiresAt is a Firestore Timestamp;
 * we compare it to the current moment every time this runs.
 */
export function computeLiveStatus(profile){
  if(!profile || profile.plan === "none" || !profile.expiresAt){
    return { status: "none", daysRemaining: 0 };
  }
  const expiresDate = profile.expiresAt.toDate ? profile.expiresAt.toDate() : new Date(profile.expiresAt);
  const now = new Date();
  const msRemaining = expiresDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));

  if(profile.subscriptionStatus === "active" && msRemaining > 0){
    return { status: "active", daysRemaining, expiresDate };
  }
  return { status: "expired", daysRemaining: 0, expiresDate };
}
