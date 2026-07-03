import process from 'process';
function getGeminiApiKeys() {
    const keys = [];
    for (const envKey of Object.keys(process.env)) {
      const val = process.env[envKey];
      if (!val || val.trim() === "" || val.includes("MY_GEMINI_API_KEY")) {
        continue;
      }
      if (envKey === "gemini_api_key") {
        continue;
      }
      
      const lower = envKey.toLowerCase();
      if (envKey === "GEMINI_API_KEY") {
        keys.push({ name: envKey, value: val, num: 0 });
      } else if (lower.startsWith("gemini_api_key")) {
        const numMatch = envKey.match(/\d+/);
        const num = numMatch ? parseInt(numMatch[0], 10) : 999;
        keys.push({ name: envKey, value: val, num });
      }
    }
    keys.sort((a, b) => a.num - b.num);
    const uniqueKeys = [];
    const seenValues = new Set();
    for (const k of keys) {
      if (!seenValues.has(k.value)) {
        seenValues.add(k.value);
        uniqueKeys.push({ name: k.name, value: k.value });
      }
    }
    return uniqueKeys;
  }
console.log(getGeminiApiKeys().map(k => k.name));
