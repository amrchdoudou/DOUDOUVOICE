import firebaseConfig from "../../firebase-applet-config.json";

function parseFirestoreREST(doc: any) {
  if (!doc || !doc.fields) return {};
  const result: any = {};
  for (const [key, value] of Object.entries(doc.fields)) {
    const val: any = value;
    if ('stringValue' in val) result[key] = val.stringValue;
    if ('integerValue' in val) result[key] = parseInt(val.integerValue, 10);
    if ('doubleValue' in val) result[key] = parseFloat(val.doubleValue);
    if ('booleanValue' in val) result[key] = val.booleanValue;
  }
  return result;
}

export async function getFirestoreDocREST(collection: string, docId: string, idToken: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`REST GET Error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return parseFirestoreREST(data);
}

export async function updateFirestoreDocREST(collection: string, docId: string, fields: any, idToken: string) {
  const restFields: any = {
    serverSecret: { stringValue: "doudouvoice-backend-secret-xyz" }
  };
  const updateMask = ["serverSecret"];
  
  for (const [key, value] of Object.entries(fields)) {
    updateMask.push(key);
    if (typeof value === 'string') restFields[key] = { stringValue: value };
    else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            restFields[key] = { integerValue: value.toString() }; 
        } else {
            restFields[key] = { doubleValue: value }; 
        }
    }
    else if (typeof value === 'boolean') restFields[key] = { booleanValue: value };
  }

  const url = new URL(`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${collection}/${docId}`);
  updateMask.forEach(mask => url.searchParams.append("updateMask.fieldPaths", mask));

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: url.pathname.replace(/^\/v1\//, ''), fields: restFields })
  });

  if (!res.ok) {
    throw new Error(`REST PATCH Error (${res.status}): ${await res.text()}`);
  }
}
