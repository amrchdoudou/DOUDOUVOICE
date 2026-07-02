import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId }, "test-app-2");
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("=== FIRESTORE DIAGNOSTIC 2 START ===");
  try {
    const collections = await db.listCollections();
    console.log(`✅ Success! Found ${collections.length} collections.`);
  } catch (err: any) {
    console.log(`❌ Failed: ${err.message}`);
  }
  console.log("=== DIAGNOSTIC 2 END ===");
}

run();
