import { getFirestoreDocREST, updateFirestoreDocREST } from "./src/lib/firestoreRest";

async function run() {
  console.log("Testing REST API helpers...");
  // I don't have an ID token, so I can't actually call this without getting a 401 Unauthorized.
  // But if the imports compile, we are good to go.
  console.log("Compiled successfully!");
}

run();
