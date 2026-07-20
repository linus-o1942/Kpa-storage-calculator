# Omlin Consultancy — Storage Charge Calculator + Subscriptions

A Firebase-backed subscription system in front of the Storage Charge
Calculator. Users sign up, subscribe by paying via M-Pesa Till and sending
their confirmation on WhatsApp, and you manually activate them from a
password-protected (Firebase Auth) admin dashboard. No backend server —
everything runs as static files on Netlify, talking directly to Firebase.

## File map

```
index.html        redirects to app.html or login.html depending on auth state
login.html         email/password login
signup.html        email/password signup (creates the Firestore user doc)
app.html            the Storage Charge Calculator — requires an ACTIVE subscription
account.html        "My Subscription" status page (plan, dates, days remaining)
subscribe.html       payment instructions + WhatsApp deep links per plan
admin.html          admin-only dashboard: view all users, activate/deactivate
firestore.rules      Firestore Security Rules — deploy these to your project
css/styles.css       shared brand styling
js/firebase-config.js   <-- put your Firebase project keys here
js/firebase-init.js     initializes the Firebase SDK (no edits needed)
js/auth.js               signup/login/logout + nav rendering + status helpers
js/guard.js               page-level access control (subscription + admin)
js/calculator.js          the storage-charge calculator logic (unchanged math)
```

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and create a new project.
2. **Build → Authentication → Get started → Sign-in method** → enable
   **Email/Password**.
3. **Build → Firestore Database → Create database** → start in
   **production mode** (the rules file below secures it properly) →
   pick a region close to Kenya (e.g. `europe-west1` or `us-central1`).
4. **Project settings (gear icon) → General → Your apps → Add app → Web
   (</>)**. Register the app (nickname can be anything, no need for
   Firebase Hosting). Copy the `firebaseConfig` object it gives you.

## 2. Add your config

Open `js/firebase-config.js` and paste your real values in place of the
`YOUR_...` placeholders. This file is safe to publish — Firebase web API
keys are not secret; real protection comes from the security rules below.

You can also change the M-Pesa Till number, WhatsApp number, or plan
prices/durations in this same file (`PAYMENT_INFO` and `PLANS`).

## 3. Deploy the Firestore Security Rules

Paste the contents of `firestore.rules` into **Firestore Database → Rules**
in the console and click **Publish** (or use the Firebase CLI:
`firebase deploy --only firestore:rules` if you have the project linked).

These rules do the important part of requirement 7 & 8:

- A signed-in user can read/update **only their own** profile document.
- A user can **never** set `plan`, `activatedAt`, or `expiresAt` themselves.
- A user can flip their own `subscriptionStatus` from `"active"` to
  `"expired"` **only** if `expiresAt` has genuinely passed according to
  Firestore's own server clock (`request.time`) — never client-side.
- Only documents listed in `/admins/{uid}` can write subscription fields
  (activate/deactivate) or read every user's profile (for the dashboard).

## 4. Create your admin account

1. Deploy the site (or run it locally) and **sign up** normally with the
   email you want to use as the administrator.
2. In the Firebase Console, go to **Build → Authentication → Users** and
   copy that account's **User UID**.
3. Go to **Firestore Database → Data** and manually create a new document:
   - Collection: `admins`
   - Document ID: *paste the UID you copied*
   - Add any field, e.g. `role: "admin"` (the field value doesn't matter —
     the rules only check that the document exists).
4. Log back in with that account and visit `admin.html` — you should now
   see the dashboard. Everyone else is redirected away from it.

> There's no self-service way to become an admin from the app — that's
> intentional. Repeat step 2–3 for any additional admins.

## 5. Deploy to Netlify

This is a static site, so there's nothing to build:

1. Push this folder to a GitHub repo (or drag-and-drop the folder into
   Netlify's dashboard under **Sites → Add new site → Deploy manually**).
2. Build command: *(leave blank)*. Publish directory: `/` (the folder
   containing `index.html`).
3. Once deployed, in the Firebase Console go to **Authentication →
   Settings → Authorized domains** and add your Netlify domain (e.g.
   `your-site.netlify.app`) — Firebase Auth blocks unrecognized domains
   by default.

## How access control works (requirement 3)

Every protected page calls `requireActiveSubscription()` (in `guard.js`)
before it shows anything. That function:

1. Waits for Firebase to confirm who's signed in.
2. Reads that user's **live** Firestore document (never a cached copy).
3. Compares `expiresAt` to the current time.
4. If `subscriptionStatus` is `"active"` **and** `expiresAt` is still in
   the future → shows the page.
5. Otherwise → (if it just expired) writes `subscriptionStatus:"expired"`
   using the narrow, server-time-gated rule described above, then
   redirects to `subscribe.html`.

Nothing about this decision is stored in `localStorage`/`sessionStorage`
or driven by a `setTimeout` — it's re-evaluated against Firestore on
every page load, exactly as requested.

## Admin activation logic (requirement 5)

Clicking **Activate 2 Weeks** / **Activate 1 Month** always writes a
**fresh** `activatedAt` (now) and `expiresAt` (now + 14 or 30 days) —
per your spec, an existing active subscription is *reset* from today
rather than stacking extra days on top of the old expiry. **Deactivate**
sets `subscriptionStatus` to `"inactive"`, which immediately blocks
access to `app.html` on the user's next load.

## Notes / things you may want to change later

- Passwords are handled entirely by Firebase Authentication (hashed,
  never touches your own code).
- The admin dashboard uses a live Firestore listener (`onSnapshot`), so
  new signups and status changes appear without refreshing.
- If you ever outgrow manual verification, M-Pesa's Daraja API (STK
  Push / C2B) could later replace the WhatsApp step — the Firestore
  structure here would not need to change.
