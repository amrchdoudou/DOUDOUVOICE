import firebaseConfig from "./firebase-applet-config.json" with { type: 'json' };
const url = new URL(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/test`);
console.log(url.pathname);
