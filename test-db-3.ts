import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId }, "test-app-3");

async function testDb(dbId: string) {
  const db = getFirestore(app, dbId);
  console.log(`Testing ${dbId}...`);
  try {
    const docRef = db.collection('test_connection').doc('test');
    await docRef.set({ test: true });
    console.log(`✅ Success writing to ${dbId}`);
  } catch (err: any) {
    console.log(`❌ Failed writing to ${dbId}: ${err.message}`);
  }
}

async function run() {
  await testDb("ai-studio-arabvoiceai-f450c105-a269-4304-a383-4129465692e2");
  await testDb("ai-studio-doudouvoice-f450c105-a269-4304-a383-4129465692e2");
  await testDb(firebaseConfig.firestoreDatabaseId);
}

run();
