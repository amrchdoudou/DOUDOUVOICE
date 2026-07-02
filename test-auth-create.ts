import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";
import { getFirestoreDocREST, updateFirestoreDocREST } from "./src/lib/firestoreRest";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId });

async function run() {
  console.log("Creating token...");
  try {
    const customToken = await getAuth(app).createCustomToken("test-rest-uid");
    console.log("Custom token created");
  } catch (err: any) {
    console.log("Auth error:", err.message);
  }
}

run();
