import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId }, "test-custom-token");
async function run() {
  try {
    const auth = getAuth(app);
    const token = await auth.createCustomToken("test-uid");
    console.log("Success! Token:", token.substring(0, 20) + "...");
  } catch (err: any) {
    console.log("Failed:", err.message);
  }
}
run();
