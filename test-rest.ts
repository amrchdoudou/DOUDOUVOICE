import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId }, "test-rest");
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
db.settings({ preferRest: true });

async function run() {
  console.log("=== FIRESTORE REST DIAGNOSTIC START ===");
  try {
    const collections = await db.listCollections();
    console.log(`✅ Success! Found ${collections.length} collections.`);
  } catch (err: any) {
    console.log(`❌ Failed: ${err.message}`);
  }
  console.log("=== FIRESTORE REST DIAGNOSTIC END ===");
}

run();
