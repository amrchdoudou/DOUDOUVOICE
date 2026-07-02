import { getAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase-admin/app";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({ projectId: firebaseConfig.projectId }, "test-auth");
async function run() {
  try {
    const auth = getAuth(app);
    console.log("Auth initialized.");
    // We can't easily get a real token, but we can try to verify a fake one and see if it throws an IAM error or a JWT error.
    await auth.verifyIdToken("fake-token");
  } catch (err: any) {
    console.log(err.message);
  }
}
run();
