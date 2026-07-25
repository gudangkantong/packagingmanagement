import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDWNfn8Eee2YJeCHisM5rO1oVdxmW1_Fek",
  authDomain: "gen-lang-client-0065314458.firebaseapp.com",
  projectId: "gen-lang-client-0065314458",
  storageBucket: "gen-lang-client-0065314458.firebasestorage.app",
  messagingSenderId: "780987725360",
  appId: "1:780987725360:web:3c3da83b6a070403e09ff5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Firestore removed — using Supabase instead
// See: src/supabase.ts, src/dataLayer.ts, src/db-compat.ts

export { app, auth, firebaseConfig };
