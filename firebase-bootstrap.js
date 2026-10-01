// firebase-bootstrap.js
//
// This app used to run inside a Claude Artifact, which injected window.claude.use('db')
// and window.claude.use('assets') — a small Firestore-like database and a file-upload
// helper. Now that the app is hosted on its own, this file replaces that with the same
// shapes backed by real Firebase (Firestore + Storage + Authentication), so app-src.jsx
// barely had to change.
//
// The Firebase SDK is loaded here as ES modules straight from Google's CDN, which means
// it's fetched by each VISITOR'S browser, not during the build — no npm install needed.
//
// This is a classic, non-module script (app.js) that boots the actual React app, and it
// may start running before this module script finishes loading (module scripts execute
// after the page is parsed, like <script defer>, while a plain <script src="app.js"> in
// the page runs immediately at its position). So instead of assuming window.__fb exists
// on load, app-src.jsx waits for the 'fb-ready' event this file dispatches at the end.
//
// TO ACTIVATE: paste your Firebase project's web config into firebaseConfig below,
// replacing the placeholder values, then redeploy.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getFirestore,
  collection as fsCollection,
  query as fsQuery,
  orderBy as fsOrderBy,
  onSnapshot as fsOnSnapshot,
  doc as fsDoc,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  deleteDoc as fsDeleteDoc,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getBlob,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

// ---- 1) Paste your project's config here ---------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBoKn4MP7vmgZEBRuhBoApIJiotdcJB_V4",
  authDomain: "social-worker-d2519.firebaseapp.com",
  projectId: "social-worker-d2519",
  storageBucket: "social-worker-d2519.firebasestorage.app",
  messagingSenderId: "617751061380",
  appId: "1:617751061380:web:16f709a0368090303933d1",
};
// ---------------------------------------------------------------------------

function buildBridge() {
  const app = initializeApp(firebaseConfig);
  const firestoreDb = getFirestore(app);
  const storage = getStorage(app);
  const auth = getAuth(app);

  // Mirrors: db.collection(name).orderBy(field, dir).onSnapshot(onNext, onError)
  //          db.collection(name).doc(id).set/update/delete(...)
  function makeCollectionRef(name) {
    return {
      orderBy(field, dir) {
        const qRef = fsQuery(fsCollection(firestoreDb, name), fsOrderBy(field, dir || 'asc'));
        return {
          onSnapshot(onNext, onError) {
            return fsOnSnapshot(qRef, (snap) => {
              onNext({ docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })) });
            }, onError);
          },
        };
      },
      doc(id) {
        const docRef = fsDoc(firestoreDb, name, id);
        return {
          set(data) { return fsSetDoc(docRef, data); },
          update(data) { return fsUpdateDoc(docRef, data); },
          delete() { return fsDeleteDoc(docRef); },
        };
      },
    };
  }

  const dbApi = { collection: makeCollectionRef };

  // Mirrors: assets.upload(file) -> { id }
  // "id" is a Firebase Storage PATH (e.g. "uploads/172...-photo.jpg"), NOT a download
  // URL. getDownloadURL() tokens bypass Storage Security Rules entirely (this is
  // documented, intentional Firebase behavior — the token alone grants access forever,
  // regardless of what the rules say), which would silently defeat the point of
  // requiring login for this hospital case data. Keeping a path instead means every
  // read has to go through getBlobUrl() below, which uses an authenticated SDK call
  // that Security Rules genuinely enforce.
  const assetsApi = {
    async upload(file) {
      const safeName = (file && file.name ? file.name : 'file').replace(/[^a-zA-Z0-9_.-]/g, '_');
      const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file);
      return { id: path };
    },
    // Downloads the file as a Blob (an authenticated request that Security Rules do
    // apply to) and hands back a temporary local object URL for use as an <img src>.
    // Caller is responsible for URL.revokeObjectURL(...) once done (SecureImg in
    // app-src.jsx does this automatically).
    async getBlobUrl(path) {
      const fileRef = storageRef(storage, path);
      const blob = await getBlob(fileRef);
      return URL.createObjectURL(blob);
    },
  };

  // New: email/password auth, since the app now requires a login.
  const authApi = {
    signIn(email, password) { return signInWithEmailAndPassword(auth, email, password); },
    signOut() { return fbSignOut(auth); },
    onChange(cb) { return onAuthStateChanged(auth, cb); },
  };

  return { db: dbApi, assets: assetsApi, auth: authApi };
}

try {
  window.__fb = buildBridge();
} catch (err) {
  console.error('[firebase-bootstrap] Failed to initialize Firebase. Did you paste in your real firebaseConfig?', err);
  window.__fb = null;
} finally {
  window.dispatchEvent(new Event('fb-ready'));
}
