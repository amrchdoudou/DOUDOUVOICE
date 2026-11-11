/**
 * Shared TTS Key Discovery and Multi-Key Rotation / Fallback Engine
 * Discovers configured Gemini API keys and automatically rotates to the next available key
 * if a key encounters quota, billing, 403, 429, or permission issues, matching Studio behavior.
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateSingleSegmentAudio } from './expressiveTts.js';

export interface KeyObject {
  name: string;
  value: string;
  num?: number;
}

let sharedKeyIndex = 0;

/**
 * Discovers and returns all valid, unique Gemini API keys configured in environment secrets.
 * Excludes placeholders and empty values.
 */
export function getGeminiApiKeys(): KeyObject[] {
  const keys: { name: string; value: string; num: number }[] = [];

  for (const envKey of Object.keys(process.env)) {
    const val = process.env[envKey];
    if (!val || val.trim() === '' || val.includes('MY_GEMINI_API_KEY')) {
      continue;
    }

    if (envKey === 'gemini_api_key') {
      continue;
    }

    const lower = envKey.toLowerCase();
    if (envKey === 'GEMINI_API_KEY') {
      keys.push({ name: envKey, value: val, num: 0 });
    } else if (lower.startsWith('gemini_api_key')) {
      const numMatch = envKey.match(/\d+/);
      const num = numMatch ? parseInt(numMatch[0], 10) : 999;
      keys.push({ name: envKey, value: val, num });
    }
  }

  keys.sort((a, b) => a.num - b.num);

  const uniqueKeys: KeyObject[] = [];
  const seenValues = new Set<string>();
  for (const k of keys) {
    if (!seenValues.has(k.value)) {
      seenValues.add(k.value);
      uniqueKeys.push({ name: k.name, value: k.value });
    }
  }

  return uniqueKeys;
}

const disabledKeyNames = new Set<string>();

/**
 * Checks whether an error is specific to an API key / project quota / billing tier.
 */
export function isKeySpecificError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('limit') ||
    msg.includes('exhausted') ||
    msg.includes('429') ||
    msg.includes('403') ||
    msg.includes('401') ||
    msg.includes('api key') ||
    msg.includes('apikey') ||
    msg.includes('key not') ||
    msg.includes('invalid') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('billing') ||
    msg.includes('free tier') ||
    msg.includes('permission_denied') ||
    msg.includes('permission') ||
    msg.includes('leaked') ||
    msg.includes('suspended') ||
    msg.includes('disabled') ||
    msg.includes('الحد الأقصى') ||
    msg.includes('سيرفرات الصوت') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    err.status === 429 ||
    err.status === 401 ||
    err.status === 403 ||
    err.status === 503
  );
}

/**
 * Checks whether a key error is a permanent credential/permission failure (401/403/invalid/leaked)
 * or daily quota exhaustion (GenerateRequestsPerDay) rather than a transient per-minute rate limit.
 */
export function isPermanentKeyError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    err.status === 401 ||
    err.status === 403 ||
    msg.includes('403') ||
    msg.includes('401') ||
    msg.includes('permission_denied') ||
    msg.includes('forbidden') ||
    msg.includes('unauthorized') ||
    msg.includes('leaked') ||
    msg.includes('suspended') ||
    msg.includes('api_key_invalid') ||
    msg.includes('key not valid') ||
    msg.includes('per day limit exceeded') ||
    msg.includes('generaterequestsperday')
  );
}

export interface ExpressiveVoiceSegment {
  id: string;
  text: string;
  pace?: 'normal' | 'slow' | 'fast';
  emotion?: 'excited' | 'friendly' | 'persuasive' | 'reassuring' | 'curious' | 'serious' | 'playful' | 'warm';
  deliveryInstruction?: string;
  vocalBurst?: string;
  type?: 'speech' | 'sound';
  soundType?: 'excited' | 'surprised' | 'laugh';
}

/**
 * Synthesizes audio for a single segment with Studio-compatible multi-key rotation, retries, and expressive voice direction.
 * Tries the currently active key, and automatically switches to the next available key if an issue arises.
 * Permanently invalid/403 keys are skipped on subsequent segments so they do not slow down multi-segment voiceover runs.
 * If all keys fail, throws the exact error. Never fabricates fake audio or silence.
 */
export async function synthesizeSegmentWithStudioFallback(
  segment: ExpressiveVoiceSegment,
  options: {
    dialect: string;
    voice: string;
    style?: string;
    emotion?: string;
    gender?: 'male' | 'female';
    speed?: number;
    pitch?: number;
    kabyleRegion?: string;
    cacheDir?: string;
  }
): Promise<{ rawPcm: Buffer; durationSec: number; audioUrl: string; audioPath?: string }> {
  const allApiKeys = getGeminiApiKeys();
  if (allApiKeys.length === 0) {
    throw new Error('No Gemini API keys configured in environment/secrets (GEMINI_API_KEY or gemini_api_key1).');
  }

  // Filter out keys known to be permanently invalid/403, unless all keys were marked disabled
  let apiKeys = allApiKeys.filter(k => !disabledKeyNames.has(k.name));
  if (apiKeys.length === 0) {
    disabledKeyNames.clear();
    apiKeys = allApiKeys;
  }

  const { dialect, voice, style, emotion, speed, pitch, kabyleRegion } = options;
  const cacheDir = options.cacheDir || path.join(process.cwd(), 'audio_cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Segment-Level Expressive Directorial Mapping
  const emotionMap: Record<string, string> = {
    excited: 'Energetic sales with enthusiastic upbeat inflection and animated delivery',
    friendly: 'Warm, friendly commercial voice with natural conversational charm',
    persuasive: 'Confident, authoritative luxury brand voice with persuasive cadence',
    reassuring: 'Calm, reassuring, trustworthy professional presentation tone',
    curious: 'Intriguing, curious storytelling delivery that piques interest',
    serious: 'Professional business presentation with clear authoritative emphasis',
    playful: 'Playful, lively, lighthearted delivery with natural vocal variation',
    warm: 'Warm, welcoming delivery with comfortable natural micro-pauses'
  };

  const chosenEmotion = segment.emotion || emotion;
  const emotionInstruction = chosenEmotion && emotionMap[chosenEmotion]
    ? emotionMap[chosenEmotion]
    : (style || 'Premium commercial with natural expressive inflection');

  const fullStyle = segment.deliveryInstruction
    ? `${emotionInstruction}. Directorial Guidance: ${segment.deliveryInstruction}`
    : emotionInstruction;

  let lastError: any = null;
  const startIdx = sharedKeyIndex % apiKeys.length;

  for (let attempt = 0; attempt < apiKeys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % apiKeys.length;
    const keyObj = apiKeys[keyIdx];

    console.log(`[TTS Engine] Generating segment ${segment.id} (${chosenEmotion || 'standard'}) with key "${keyObj.name}" (attempt ${attempt + 1}/${apiKeys.length})...`);

    try {
      const segmentType = segment.type || 'speech';
      const result = await generateSingleSegmentAudio(
        {
          id: segment.id,
          type: segmentType,
          text: segment.text,
          pace: segment.pace || 'normal',
          soundType: segment.soundType
        } as any,
        {
          dialect,
          voice,
          style: fullStyle,
          emotion: chosenEmotion,
          speed,
          pitch,
          kabyleRegion,
          apiKey: keyObj.value,
          cacheDir
        }
      );

      // Successfully generated with this key -> advance sharedKeyIndex for subsequent calls
      sharedKeyIndex = (keyIdx + 1) % apiKeys.length;
      const audioPath = result.audioUrl.startsWith('/api/audio/')
        ? path.join(cacheDir, `${result.audioUrl.replace('/api/audio/', '')}`)
        : undefined;
      return { ...result, audioPath };
    } catch (err: any) {
      lastError = err;
      const isRecoverable = isKeySpecificError(err);
      if (isPermanentKeyError(err) && allApiKeys.length > 1) {
        disabledKeyNames.add(keyObj.name);
        console.log(`[TTS Engine] Key "${keyObj.name}" unavailable for session; rotating to next active key in pool.`);
      } else {
        console.log(`[TTS Engine] Key "${keyObj.name}" encountered transient issue for segment ${segment.id}; rotating key...`);
      }

      if (isRecoverable && attempt < apiKeys.length - 1) {
        console.log(`[TTS Engine] Switching to next available key in rotation pool...`);
        sharedKeyIndex = (keyIdx + 1) % apiKeys.length;
        await new Promise(r => setTimeout(r, 600)); // Brief pause before trying next key
        continue;
      }

      if (!isRecoverable) {
        // Fatal non-key error (e.g. invalid request structure)
        throw err;
      }
    }
  }

  // All keys failed
  throw new Error(`Speech synthesis failed across all ${apiKeys.length} configured API keys for segment "${segment.id}": ${lastError?.message || lastError}`);
}
