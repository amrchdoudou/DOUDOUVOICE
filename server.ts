import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp({
  projectId: firebaseConfig.projectId,
});
const adminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

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
    const decodedToken = await getAuth(app).verifyIdToken(idToken);
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
      res.sendFile(filePath);
    } catch (error: any) {
      console.error("Error serving audio:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Routes
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, dialect, style, voice, speed, pitch, emotion } = req.body;
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const prompt = `Please speak the following Arabic text. DO NOT read it as Modern Standard Arabic (Fusha). You MUST adopt a strong, authentic, and natural native ${dialect} accent. Use the precise intonation, rhythm, and pronunciation characteristic of native speakers from that region. Speak in a ${style} and ${emotion} tone. Ensure the dialect's unique phonetic traits are highly prominent.
تحدث بلهجة ${dialect} أصلية وواضحة جداً، مع نبرة ${emotion} وبأسلوب ${style}. إقرأ النص بطريقة تبدو وكأنها لشخص حقيقي من تلك المنطقة، وليس باللغة العربية الفصحى.

Text: ${text}`;
      
      const response = await ai.models.generateContent({
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
      
      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!audioBase64) {
        return res.status(500).json({ error: "Failed to generate audio" });
      }
      
      const rawAudioBuffer = Buffer.from(audioBase64, 'base64');
      const audioBuffer = addWavHeader(rawAudioBuffer, 24000, 1, 16);
      const fileId = crypto.randomUUID();
      const filePath = path.join(cacheDir, `${fileId}.wav`);
      await fs.promises.writeFile(filePath, audioBuffer);

      res.json({ audio: `/api/audio/${fileId}.wav` });
    } catch (error: any) {
      console.error("Error in /api/tts:", error);
      let message = error.message || "An unexpected error occurred.";
      if (typeof message === 'string' && (message.toLowerCase().includes("quota") || message.toLowerCase().includes("limit") || message.toLowerCase().includes("exhausted") || message.toLowerCase().includes("429"))) {
        message = "You have exceeded the daily Free Tier limit of 10 speech generations for this model. To generate more voices, please configure your own Paid API Key in Settings > Secrets or try again tomorrow.";
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
      // 2. If no local settings cache, try fetching from Firestore via Admin SDK
      try {
        const docRef = adminDb.collection("settings").doc("paypal");
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data?.clientId) {
            clientId = data.clientId;
          }
          if (data?.clientSecret) {
            clientSecret = data.clientSecret;
          }
          if (data?.mode) {
            mode = data.mode;
          }
          // Write to local cache for subsequent calls
          if (data?.clientId && data?.clientSecret) {
            saveLocalPayPalSettings({
              clientId: data.clientId,
              clientSecret: data.clientSecret,
              mode: data.mode || "sandbox",
              updatedAt: new Date()
            });
          }
        }
      } catch (error) {
        // Silently fall back to env or local cache without printing scary IAM errors
      }
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
      res.json(data);
    } catch (error: any) {
      console.error("Failed to create order:", error);
      res.status(500).json({ error: error.message || "Failed to create order" });
    }
  });

  app.post("/api/orders/:orderID/capture", async (req, res) => {
    try {
      const { orderID } = req.params;
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
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
