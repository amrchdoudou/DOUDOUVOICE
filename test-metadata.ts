import fetch from "node-fetch";

async function run() {
  console.log("=== METADATA START ===");
  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", {
      headers: { "Metadata-Flavor": "Google" }
    });
    if (res.ok) {
      console.log("Service Account:", await res.text());
    } else {
      console.log("Failed to fetch:", res.status, res.statusText);
    }
  } catch (e: any) {
    console.log("Error:", e.message);
  }
  console.log("=== METADATA END ===");
}

run();
