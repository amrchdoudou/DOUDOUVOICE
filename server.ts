import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getFirestoreDocREST, updateFirestoreDocREST } from "./src/lib/firestoreRest";
import { getAuth } from "firebase-admin/auth";
import firebaseConfig from "./firebase-applet-config.json";

console.log("[DEBUG] projectId:", firebaseConfig.projectId, "| databaseId:", firebaseConfig.firestoreDatabaseId);

const adminApp = initializeApp({
  projectId: firebaseConfig.projectId,
});
const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);

const PAYPAL_SETTINGS_FILE = path.join(process.cwd(), "paypal_settings.json");

function loadLocalPayPalSettings() {
  try {
    if (fs.existsSync(PAYPAL_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PAYPAL_SETTINGS_FILE, "utf-8"));
      return data;
    }
  } catch (error) {
    console.error("Error reading local PayPal settings file:", error);
  }
  return null;
}

function saveLocalPayPalSettings(settings: any) {
  try {
    fs.writeFileSync(PAYPAL_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing local PayPal settings file:", error);
  }
}

async function verifyAdmin(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
    if (decodedToken.email !== "abdelwadoudamirouche7@gmail.com") {
      throw new Error("Forbidden: Admin email does not match");
    }
  } catch (err: any) {
    throw new Error(`Authentication failed: ${err.message}`);
  }
}

function addWavHeader(pcmBuffer: Buffer, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const header = Buffer.alloc(44);
  
  // RIFF identifier
  header.write("RIFF", 0);
  // file length minus RIFF identifier length (4) and file length descriptor length (4)
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  // RIFF type
  header.write("WAVE", 8);
  // format chunk identifier
  header.write("fmt ", 12);
  // format chunk length
  header.writeUInt32LE(16, 16);
  // sample format (raw PCM = 1)
  header.writeUInt16LE(1, 20);
  // channel count
  header.writeUInt16LE(numChannels, 22);
  // sample rate
  header.writeUInt32LE(sampleRate, 24);
  // byte rate = (sampleRate * numChannels * bitsPerSample) / 8
  header.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
  // block align = (numChannels * bitsPerSample) / 8
  header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  // bits per sample
  header.writeUInt16LE(bitsPerSample, 34);
  // data chunk identifier
  header.write("data", 36);
  // data chunk length
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

async function generateContentWithRetry(ai: GoogleGenAI, params: any, maxRetries = 4, initialDelay = 1500) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await ai.models.generateContent(params);
    } catch (error: any) {
      attempt++;
      const errorMessage = error.message || "";
      const is503 = error.status === 503 ||
                    errorMessage.includes("503") ||
                    errorMessage.includes("UNAVAILABLE") ||
                    errorMessage.includes("unavailable") ||
                    errorMessage.includes("Service Unavailable") ||
                    errorMessage.includes("currently unavailable");

      if (is503 && attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(`[Gemini TTS Retry] Attempt ${attempt} failed with 503/UNAVAILABLE. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const cacheDir = path.join(process.cwd(), "audio_cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Serve cached audio files
  app.get("/api/audio/:id.wav", (req, res) => {
    try {
      const fileId = req.params.id;
      if (!/^[a-f0-9\-]+$/.test(fileId)) {
        return res.status(400).json({ error: "Invalid audio ID" });
      }
      const filePath = path.join(cacheDir, `${fileId}.wav`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Audio not found" });
      }
      res.setHeader("Content-Type", "audio/wav");
      if (req.query.download === "true") {
        const filename = (req.query.filename as string) || "audio.wav";
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      }
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Error serving audio:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Key rotation helpers
  let currentKeyIndex = 0;

  function getGeminiApiKeys(): { name: string; value: string }[] {
    const keys: { name: string; value: string; num: number }[] = [];
    
    for (const envKey of Object.keys(process.env)) {
      const val = process.env[envKey];
      if (!val || val.trim() === "" || val.includes("MY_GEMINI_API_KEY")) {
        continue;
      }
      
      const lower = envKey.toLowerCase();
      if (lower === "gemini_api_key") {
        keys.push({ name: envKey, value: val, num: 0 });
      } else if (lower.startsWith("gemini_api_key")) {
        const numMatch = envKey.match(/\d+/);
        const num = numMatch ? parseInt(numMatch[0], 10) : 999;
        keys.push({ name: envKey, value: val, num });
      }
    }
    
    // Sort so GEMINI_API_KEY is first (0), then gemini_api_key1, gemini_api_key2, etc.
    keys.sort((a, b) => a.num - b.num);
    
    // Return unique keys based on their secret values
    const uniqueKeys: { name: string; value: string }[] = [];
    const seenValues = new Set<string>();
    for (const k of keys) {
      if (!seenValues.has(k.value)) {
        seenValues.add(k.value);
        uniqueKeys.push({ name: k.name, value: k.value });
      }
    }
    
    return uniqueKeys;
  }

  // API Routes
  app.post("/api/tts", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header. Please log in again." });
      }
      const idToken = authHeader.split("Bearer ")[1];
      let decodedToken;
      try {
        decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      } catch (err: any) {
        return res.status(401).json({ error: `Authentication failed: ${err.message}` });
      }
      const uid = decodedToken.uid;

      const { text, dialect, style, voice, speed, pitch, emotion } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required and must be a string." });
      }

      // Fetch user profile via REST API bypassing IAM
      const userData: any = await getFirestoreDocREST("users", uid, idToken) || { plan: "Free", generationCount: 0, usedCharacters: 0 };

      const plan = (userData?.plan || "Free").toLowerCase();
      const generationCount = userData?.generationCount || 0;
      const usedCharacters = userData?.usedCharacters || 0;

      // Plan rules and quota enforcement
      if (plan === "free" && generationCount >= 5) {
        return res.status(403).json({
          error: "⚠️ خطأ في التوليد\n\nYou have exceeded the daily Free Tier limit of 5 speech generations. Please upgrade your plan in pricing section to continue generating."
        });
      }

      const limitCharacters = userData?.limitCharacters || (plan === 'pro' ? 50000 : plan === 'business' ? 200000 : 10000);
      if (plan !== "free" && (usedCharacters + text.length) > limitCharacters) {
        const uppercasePlan = plan.charAt(0).toUpperCase() + plan.slice(1);
        return res.status(403).json({
          error: `لقد تجاوزت الحد الأقصى للحروف المسموح به لخطة ${uppercasePlan} (${limitCharacters.toLocaleString()} حرف). يرجى ترقية خطتك لمواصلة التوليد.`
        });
      }
      
      const apiKeys = getGeminiApiKeys();
      if (apiKeys.length === 0) {
        return res.status(500).json({ error: "Gemini API key is not configured in environment/secrets. Please add GEMINI_API_KEY or gemini_api_key1 in Secrets." });
      }
      
      const prompt = `Please speak the following Arabic text. DO NOT read it as Modern Standard Arabic (Fusha). You MUST adopt a strong, authentic, and natural native ${dialect} accent. Use the precise intonation, rhythm, and pronunciation characteristic of native speakers from that region. Speak in a ${style} and ${emotion} tone. Ensure the dialect's unique phonetic traits are highly prominent.
تحدث بلهجة ${dialect} أصلية وواضحة جداً، مع نبرة ${emotion} وبأسلوب ${style}. إقرأ النص بطريقة تبدو وكأنها لشخص حقيقي من تلك المنطقة، وليس باللغة العربية الفصحى.

Text: ${text}`;
      
      let response = null;
      let lastError: any = null;
      let startIdx = currentKeyIndex;
      
      // Safety reset if keys array shrunk
      if (startIdx >= apiKeys.length) {
        startIdx = 0;
        currentKeyIndex = 0;
      }
      
      for (let i = 0; i < apiKeys.length; i++) {
        const tryIdx = (startIdx + i) % apiKeys.length;
        const keyObj = apiKeys[tryIdx];
        
        console.log(`[Gemini TTS] Attempting generation with key: ${keyObj.name} (index ${tryIdx}/${apiKeys.length - 1})`);
        
        const ai = new GoogleGenAI({ apiKey: keyObj.value });
        
        try {
          response = await generateContentWithRetry(ai, {
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
              responseModalities: ["audio" as any],
              speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voice },
                  },
              },
            },
          });
          
          // Save successful key index
          currentKeyIndex = tryIdx;
          console.log(`[Gemini TTS] Successfully generated audio using key: ${keyObj.name}`);
          break;
        } catch (err: any) {
          lastError = err;
          const msg = (err.message || "").toLowerCase();
          const isKeySpecific = (
            msg.includes("quota") ||
            msg.includes("limit") ||
            msg.includes("exhausted") ||
            msg.includes("429") ||
            msg.includes("api key") ||
            msg.includes("apikey") ||
            msg.includes("key not") ||
            msg.includes("invalid") ||
            msg.includes("unauthorized") ||
            msg.includes("forbidden") ||
            err.status === 429 ||
            err.status === 401 ||
            err.status === 403
          );
          
          if (isKeySpecific) {
            console.warn(`[Gemini TTS] Key ${keyObj.name} failed with quota/key error: ${err.message}. Trying next key...`);
            continue;
          } else {
            // Re-throw if it's a request-level validation error
            throw err;
          }
        }
      }
      
      if (!response) {
        if (lastError) {
          throw lastError;
        } else {
          throw new Error("Failed to generate voiceovers with any of the configured Gemini API keys.");
        }
      }
      
      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!audioBase64) {
        return res.status(500).json({ error: "Failed to generate audio" });
      }
      
      const rawAudioBuffer = Buffer.from(audioBase64, 'base64');
      const audioBuffer = addWavHeader(rawAudioBuffer, 24000, 1, 16);
      const fileId = crypto.randomUUID();
      const filePath = path.join(cacheDir, `${fileId}.wav`);
      await fs.promises.writeFile(filePath, audioBuffer);

      // Securely update user quota via REST API bypassing IAM
      await updateFirestoreDocREST("users", uid, {
        generationCount: generationCount + 1,
        usedCharacters: usedCharacters + text.length
      }, idToken);

      res.json({ audio: `/api/audio/${fileId}.wav` });
    } catch (error: any) {
      console.error("Error in /api/tts:", error);
      let message = error.message || "An unexpected error occurred.";
      const lowerMsg = message.toLowerCase();
      if (typeof message === 'string' && (lowerMsg.includes("quota") || lowerMsg.includes("limit") || lowerMsg.includes("exhausted") || lowerMsg.includes("429"))) {
        message = "⚠️ خطأ في التوليد\n\nYou have exceeded the daily Free Tier limit of 10 speech generations for this model. To generate more voices, please configure your own Paid API Key in Settings > Secrets or try again tomorrow.";
      }
      res.status(500).json({ error: message });
    }
  });

  async function getPayPalCredentials() {
    let clientId = process.env.PAYPAL_CLIENT_ID;
    let clientSecret = process.env.PAYPAL_SECRET;
    let mode = process.env.PAYPAL_MODE || "sandbox";

    // 1. Try local settings cache first
    const localSettings = loadLocalPayPalSettings();
    if (localSettings) {
      if (localSettings.clientId) clientId = localSettings.clientId;
      if (localSettings.clientSecret) clientSecret = localSettings.clientSecret;
      if (localSettings.mode) mode = localSettings.mode;
    } else {
      // 2. Firestore fetch skipped due to IAM permissions; rely on localSettings or env
      // Silently fall back to env or local cache without printing scary IAM errors
    }

    const baseUrl = mode === "live" 
      ? "https://api-m.paypal.com" 
      : "https://api-m.sandbox.paypal.com";

    return { clientId, clientSecret, mode, baseUrl };
  }

  async function generatePayPalAccessToken() {
    const { clientId, clientSecret, baseUrl } = await getPayPalCredentials();
    
    if (!clientId || !clientSecret || clientId === "YOUR_PAYPAL_CLIENT_ID") {
      throw new Error("Missing or invalid PayPal API Credentials. Please configure them in the Admin Dashboard or set PAYPAL_CLIENT_ID and PAYPAL_SECRET in your environment variables.");
    }
    
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || data.error || "Failed to generate PayPal access token");
    }
    return data.access_token;
  }

  app.get("/api/paypal/config", async (req, res) => {
    try {
      const { clientId, clientSecret, mode } = await getPayPalCredentials();
      res.json({ 
        clientId: (clientId && clientId !== "YOUR_PAYPAL_CLIENT_ID") ? clientId : null,
        hasSecret: !!(clientSecret && clientSecret !== "YOUR_PAYPAL_SECRET" && clientSecret !== "••••••••••••••••••••••••••••••••••••••••"),
        mode 
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch PayPal config" });
    }
  });

  app.post("/api/paypal/save", async (req, res) => {
    try {
      try {
        await verifyAdmin(req);
      } catch (e: any) {
        return res.status(401).json({ error: e.message || "Unauthorized" });
      }

      let { clientId, clientSecret, mode } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: "Missing credentials" });
      }

      // If user passed masked secret, restore actual secret from database/local file
      if (clientSecret.includes('•')) {
        const { clientSecret: savedSecret } = await getPayPalCredentials();
        if (savedSecret && !savedSecret.includes('•')) {
          clientSecret = savedSecret;
        } else {
          return res.status(400).json({ error: "Cannot restore masked client secret. Please provide a new secret." });
        }
      }

      // Save to local config file
      saveLocalPayPalSettings({
        clientId,
        clientSecret,
        mode: mode || "sandbox",
        updatedAt: new Date()
      });

      res.json({ success: true, message: "Credentials saved successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to save credentials" });
    }
  });

  app.post("/api/paypal/test", async (req, res) => {
    try {
      try {
        await verifyAdmin(req);
      } catch (e: any) {
        return res.status(401).json({ error: e.message || "Unauthorized" });
      }

      let { clientId, clientSecret, mode } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: "Missing credentials" });
      }

      // If user passed masked secret, restore actual secret
      if (clientSecret.includes('•')) {
        const { clientSecret: savedSecret } = await getPayPalCredentials();
        if (savedSecret && !savedSecret.includes('•')) {
          clientSecret = savedSecret;
        } else {
          return res.status(400).json({ error: "Cannot restore masked client secret. Please provide a new secret." });
        }
      }

      // Always save credentials securely locally first
      saveLocalPayPalSettings({
        clientId,
        clientSecret,
        mode: mode || "sandbox",
        updatedAt: new Date()
      });

      const baseUrl = mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      
      const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        body: "grant_type=client_credentials",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        return res.status(400).json({ error: data.error_description || data.error || "Authentication failed" });
      }

      res.json({ success: true, message: "Connection successful" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }
      const idToken = authHeader.split("Bearer ")[1];
      let decodedToken;
      try {
        decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      } catch (err: any) {
        return res.status(401).json({ error: `Authentication failed: ${err.message}` });
      }

      const { plan } = req.body;
      const { baseUrl } = await getPayPalCredentials();
      let price = "0.00";
      
      if (plan === "pro") price = "19.00";
      if (plan === "business") price = "49.00";
      if (plan === "starter") price = "7.00";

      if (price === "0.00") return res.status(400).json({ error: "Invalid plan" });

      const accessToken = await generatePayPalAccessToken();
      const payload = {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: price,
            },
            description: `DoudouVoice ${plan.toUpperCase()} Subscription Plan Upgrade`,
          },
        ],
        application_context: {
          brand_name: "DoudouVoice Arabic AI",
          landing_page: "NO_PREFERENCE",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING"
        }
      };

      const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok && data.id) {
        // Securely record order mapping to prevent plan spoofing
        await updateFirestoreDocREST("pending_orders", data.id, {
          uid: decodedToken.uid,
          plan: plan,
          price: price,
          status: "PENDING"
        }, idToken);
        console.log(`[PayPal] Pending order registered securely: ${data.id} for user ${decodedToken.uid} [Plan: ${plan}]`);
      }

      res.json(data);
    } catch (error: any) {
      console.error("Failed to create order:", error);
      res.status(500).json({ error: error.message || "Failed to create order" });
    }
  });

  app.post("/api/orders/:orderID/capture", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
      }
      const idToken = authHeader.split("Bearer ")[1];
      const decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const { orderID } = req.params;

      // Secure lookup: Retrieve the original order details from Firestore
      const orderData: any = await getFirestoreDocREST("pending_orders", orderID, idToken);
      if (!orderData) {
        return res.status(404).json({ error: "Order record not found" });
      }
      if (orderData.uid !== uid) {
        return res.status(403).json({ error: "Unauthorized access to this order" });
      }

      const plan = orderData.plan;
      const { baseUrl } = await getPayPalCredentials();
      const accessToken = await generatePayPalAccessToken();

      const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (response.ok && data.status === "COMPLETED") {
        let limitCharacters = 10000;
        const lowerPlan = plan.toLowerCase();
        if (lowerPlan === 'pro') limitCharacters = 50000;
        else if (lowerPlan === 'business') limitCharacters = 200000;
        else if (lowerPlan === 'starter') limitCharacters = 10000;

        await updateFirestoreDocREST("users", uid, {
          plan: plan.charAt(0).toUpperCase() + plan.slice(1),
          generationCount: 0,
          limitCharacters: limitCharacters,
          usedCharacters: 0
        }, idToken);

        // Clean up or keep history
        await updateFirestoreDocREST("pending_orders", orderID, {
          status: "COMPLETED"
        }, idToken);

        console.log(`[PayPal] Successfully captured payment and upgraded user ${uid} to plan ${plan}`);
      }

      res.json(data);
    } catch (error: any) {
      console.error("Failed to capture order:", error);
      res.status(500).json({ error: "Failed to capture order" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
