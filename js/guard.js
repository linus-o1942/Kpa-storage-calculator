// ===========================================================
// OMLIN CONSULTANCY LTD — Access control guard
// ===========================================================
// Every protected page calls requireActiveSubscription() (or
// requireAdmin() for the admin dashboard) before revealing any content.
// Access is decided by re-reading the user's Firestore document on every
// load — never from localStorage, sessionStorage, or a browser timer.
// ===========================================================
import { auth, db } from "./firebase-init.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { waitForAuth, getUserProfile, isAdminUser, computeLiveStatus, renderNav } from "./auth.js";

/**
 * Use on pages that require an ACTIVE, non-expired subscription
 * (e.g. app.html — the calculator itself).
 * Returns { user, profile } on success; otherwise redirects and never resolves.
 */
export async function requireActiveSubscription(navEl, activePage){
  console.log("%c[GUARD DEBUG] guard.js version: 2026-07-11-debug1", "color: orange; font-weight: bold;");

  const user = await waitForAuth();
  console.log("[GUARD DEBUG] waitForAuth() resolved. user =", user ? user.uid : null, user ? user.email : "(no user / not logged in)");
  if(!user){
    console.warn("[GUARD DEBUG] No user logged in -> redirecting to login.html");
    window.location.href = "login.html";
    return new Promise(() => {});
  }

  let profile, admin;
  try{
    profile = await getUserProfile(user.uid);
    console.log("[GUARD DEBUG] getUserProfile() returned:", profile);
  }catch(e){
    console.error("[GUARD DEBUG] getUserProfile() THREW AN ERROR:", e);
  }
  try{
    admin = await isAdminUser(user.uid);
    console.log("[GUARD DEBUG] isAdminUser(", user.uid, ") returned:", admin);
  }catch(e){
    console.error("[GUARD DEBUG] isAdminUser() THREW AN ERROR:", e);
    admin = false;
  }

  if(navEl) renderNav(navEl, { activePage, user, profile, isAdmin: admin });

  // Admins bypass the subscription check entirely — they're not required
  // to have an active plan to use the app.
  if(admin){
    console.log("%c[GUARD DEBUG] admin === true -> BYPASSING subscription check, granting access.", "color: lime; font-weight: bold;");
    return { user, profile, live: computeLiveStatus(profile), isAdmin: true };
  }
  console.warn("[GUARD DEBUG] admin was NOT true, continuing to subscription check (this is where non-admins get redirected).");

  if(!profile){
    console.warn("[GUARD DEBUG] No profile doc found for this uid -> redirecting to login.html");
    window.location.href = "login.html";
    return new Promise(() => {});
  }

  const live = computeLiveStatus(profile);
  console.log("[GUARD DEBUG] computeLiveStatus() returned:", live);

  // If Firestore still says "active" but the expiry date has actually
  // passed, flip it to "expired". Security rules only allow this exact
  // one-way transition (active -> expired, gated on server time) from a
  // non-admin user — see firestore.rules.
  if(profile.subscriptionStatus === "active" && live.status === "expired"){
    try{
      await updateDoc(doc(db, "users", user.uid), { subscriptionStatus: "expired" });
    }catch(e){ /* non-fatal — access is still denied below regardless */ }
  }

  if(live.status !== "active"){
    console.warn("[GUARD DEBUG] live.status !== 'active' (it's '" + live.status + "') -> redirecting to subscribe.html");
    window.location.href = "subscribe.html";
    return new Promise(() => {});
  }

  return { user, profile, live };
}

/**
 * Use on pages that any logged-in user may view regardless of
 * subscription status (e.g. account.html, subscribe.html).
 */
export async function requireLogin(navEl, activePage){
  const user = await waitForAuth();
  if(!user){
    window.location.href = "login.html";
    return new Promise(() => {});
  }
  const profile = await getUserProfile(user.uid);
  const admin = await isAdminUser(user.uid);
  if(navEl) renderNav(navEl, { activePage, user, profile, isAdmin: admin });
  return { user, profile, isAdmin: admin };
}

/**
 * Use on admin.html. Redirects any non-admin (even if logged in) back to
 * the calculator. Admin status is determined solely by the existence of
 * an admins/{uid} Firestore document — see README for how to create one.
 */
export async function requireAdmin(navEl){
  const user = await waitForAuth();
  if(!user){
    window.location.href = "login.html";
    return new Promise(() => {});
  }
  const admin = await isAdminUser(user.uid);
  const profile = await getUserProfile(user.uid);
  if(navEl) renderNav(navEl, { activePage: "admin", user, profile, isAdmin: admin });

  if(!admin){
    window.location.href = "app.html";
    return new Promise(() => {});
  }
  return { user };
}
