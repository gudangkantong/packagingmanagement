import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

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

// Initialize Firestore with the specific custom database ID provisioned for this applet
const db = initializeFirestore(app, {}, "ai-studio-laporanpemakaian-f52ca6cd-9816-43c6-9473-dc3719544175");

export { app, auth, db, firebaseConfig };
