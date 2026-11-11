/**
 * Experimental Expressive TTS and Timing Engine
 * Isolated testing module using gemini-3.8-flash-tts
 * Supports:
 * - Independent segment generation with pacing directives ([pace: slow], [pace: normal], [pace: fast])
 * - True digital silence pauses ([pause: 1s], [pause: 3s], [pause: 1.5s])
 * - Expressive vocalizations ([sound: excited], [sound: surprised], [sound: laugh])
 * - Exact PCM audio composition without WAV header corruption
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { parseTestScript, ParsedSegment, SpeechSegment, SoundSegment } from '../src/lib/scriptParser.js';
import { GEMINI_TTS_MODEL } from './metaConfig.js';

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // 16-bit mono
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE; // 48000 bytes/sec

/**
 * Extracts raw 24kHz 16-bit mono PCM audio bytes from a Gemini TTS audio response buffer.
 * Gemini 3.8 TTS unary generateContent returns a RIFF/WAVE container (including fmt, data, and trailing C2PA chunks),
 * whereas streaming or mock responses may return raw L16 PCM bytes directly.
 */
export function extractRawPcmFromTtsAudio(audioBuffer: Buffer): Buffer {
  if (
    audioBuffer.length >= 44 &&
    audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    let offset = 12;
    while (offset + 8 <= audioBuffer.length) {
      const chunkId = audioBuffer.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = audioBuffer.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      if (chunkId === 'data') {
        const dataEnd = Math.min(audioBuffer.length, dataStart + chunkSize);
        const pcmSlice = audioBuffer.subarray(dataStart, dataEnd);
        const evenLen = pcmSlice.length - (pcmSlice.length % 2);
        return Buffer.from(pcmSlice.subarray(0, evenLen));
      }
      offset = dataStart + chunkSize + (chunkSize % 2);
    }
    const fallbackSlice = audioBuffer.subarray(44);
    const evenLen = fallbackSlice.length - (fallbackSlice.length % 2);
    return Buffer.from(fallbackSlice.subarray(0, evenLen));
  }
  const evenLen = audioBuffer.length - (audioBuffer.length % 2);
  return evenLen === audioBuffer.length ? audioBuffer : Buffer.from(audioBuffer.subarray(0, evenLen));
}

export function addWavHeader(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
  header.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

export function createDigitalSilence(durationSec: number): Buffer {
  const sampleCount = Math.round(SAMPLE_RATE * durationSec);
  const byteCount = sampleCount * BYTES_PER_SAMPLE;
  return Buffer.alloc(byteCount, 0);
}

export interface SegmentAudioResult {
  segmentId: string;
  type: 'speech' | 'pause' | 'sound';
  pace?: string;
  soundType?: string;
  text?: string;
  sentenceId?: string;
  durationSec: number;
  sampleCount: number;
  audioUrl?: string;
  rawPcm: Buffer;
  error?: string;
}

export interface ComposedAudioResult {
  segments: Array<{
    id: string;
    type: 'speech' | 'pause' | 'sound';
    sentenceId?: string;
    pace?: string;
    soundType?: string;
    text?: string;
    durationSec: number;
    audioUrl?: string;
    error?: string;
  }>;
  masterAudioUrl: string;
  totalDurationSec: number;
  speechDurationSec: number;
  silenceDurationSec: number;
  sampleRate: number;
  totalSamples: number;
}

export function hasScriptDirectives(text: string): boolean {
  return /\[(sentence|pace|pause|sound):\s*[^\]]+\]/i.test(text);
}

export const DIALECT_HINTS: Record<string, string> = {
  'Saudi Arabic':
    'Use Najdi/Hijazi Saudi pronunciation: soft "ق" as "g" in Najdi contexts, natural elongation on emphasis words, typical Gulf intonation rising at question endings.',
  'Emirati Arabic (Dubai / UAE)':
    'Use Emirati Gulf pronunciation: "ج" often softened toward "y" sound in casual speech, Gulf vowel lengthening, relaxed conversational rhythm typical of UAE speakers.',
  'Omani Arabic':
    'Use Omani pronunciation: distinct Gulf cadence, clear articulation of "ق" as a hard sound, slower deliberate pacing typical of Omani speech.',
  'Kuwaiti Arabic':
    'Use Kuwaiti pronunciation: "ج" pronounced closer to "y", fast-paced casual Gulf rhythm, characteristic Kuwaiti vowel shortening.',
  'Qatari Arabic':
    'Use Qatari Gulf pronunciation: soft consonants similar to Bahraini/Emirati register, moderate pacing, Gulf intonation patterns.',
  'Bahraini Arabic':
    'Use Bahraini pronunciation: Gulf coastal accent, softer consonant articulation, moderate-paced natural Gulf rhythm.',
  'Egyptian Arabic':
    'Use Egyptian pronunciation: "ج" as hard "g" (like in "go"), "ث" often becomes "س" or "ت", distinctive Cairene melodic intonation, natural colloquial rhythm.',
  'Algerian Arabic':
    'Use Algerian Darija: heavy French-influenced vocabulary tone, "ق" as "g" or glottal stop depending on word, fast colloquial rhythm, Maghrebi consonant clusters.',
  'Algerian Kabyle (Taqbaylit)':
    'Use authentic Algerian Kabyle (Taqbaylit) phonology: spirantized stops (b, t, d, k, g softened between vowels), clear pharyngeals (ḥ, ɛ), and distinct natural cadence.',
  'Tunisian Arabic':
    'Use Tunisian Darija: distinct Maghrebi vowel reduction, "ق" as glottal stop, rapid natural pacing, characteristic Tunisian melodic pattern.',
  'Libyan Arabic':
    'Use Libyan pronunciation: Maghrebi-Egyptian hybrid influence, "ق" often as hard "g", distinctive Libyan vowel elongation on stressed syllables.',
  'Moroccan Arabic':
    'Use Moroccan Darija: heavy vowel reduction (short/dropped vowels), fast clipped rhythm, distinct Maghrebi consonant pronunciation very different from Fusha.',
  'Syrian Arabic':
    'Use Syrian Levantine pronunciation: "ق" as glottal stop, soft melodic Levantine intonation, natural Damascene conversational rhythm.',
  'Iraqi Arabic':
    'Use Iraqi (Baghdadi/Mesopotamian) pronunciation: distinct "چ" (ch) sound not found in most other dialects, "ق" often pronounced as "g" in rural/Bedouin-influenced speech or retained as "q" in urban Baghdadi speech, characteristic Iraqi vowel melody and rhythm very different from Gulf or Levantine accents — do not confuse it with Gulf or Syrian pronunciation.',
  'Palestinian Arabic':
    'Use Palestinian Levantine pronunciation: regional variation between urban/rural registers, "ق" as glottal stop in urban speech, natural Levantine melodic pattern.',
  'Neutral Middle Eastern Arabic':
    'Use a neutral pan-Arab colloquial register understandable across regions — avoid strongly localized slang, keep pronunciation closer to widely-understood Levantine/Gulf middle ground, but still clearly NOT Modern Standard Arabic.'
};

export const KABYLE_REGION_HINTS: Record<string, string> = {
  default:
    'Use standard Taqbaylit pronunciation with balanced spirantization of dental and velar stops, clear pharyngeals (ḥ, ɛ), and authentic conversational cadence.',
  tizi_ouzou:
    'Greater Kabylia (Tizi Ouzou) accent: characteristic melodic intonation, pronounced spirantization of non-geminated stops (b, t, d, k, g), and local rhythmic flow.',
  bejaia:
    'Lesser Kabylia (Béjaïa / Soummam) accent: distinctive eastern Kabyle melodic cadence, specific vowel transitions, and natural Soummam valley phrasing.',
  bouira:
    'South-Western Kabylia (Bouira) accent: fluent transitional intonation with authentic regional phonetic softening.',
  bba_setif:
    'Southern/eastern highland Kabyle accent: firmer stop articulations with characteristic highland melodic cadence.'
};

let globalKeyRotator = 0;

export async function generateSingleSegmentAudio(
  segment: SpeechSegment | SoundSegment,
  options: {
    dialect: string;
    voice: string;
    style?: string;
    emotion?: string;
    speed?: number;
    pitch?: number;
    kabyleRegion?: string;
    apiKey?: string;
    apiKeys?: { name: string; value: string }[];
    cacheDir: string;
  }
): Promise<{ rawPcm: Buffer; durationSec: number; audioUrl: string }> {
  const { dialect, voice, style, emotion, speed = 1, pitch = 0, kabyleRegion, apiKey, apiKeys, cacheDir } = options;
  const safeDialect = dialect || 'Algerian Arabic';
  const isEnglish = safeDialect === 'American English (US)' || safeDialect === 'British English (UK)' || safeDialect.toLowerCase().includes('english');
  const isKabyle = safeDialect === 'Algerian Kabyle (Taqbaylit)';

  const styleInstruction = style === 'Presentation'
    ? 'Delivery Style: Presentation. Speak with confidence, clarity, and natural authority. Sound like a skilled presenter explaining a product or feature to an audience or judging panel, with an engaging opening, natural rhythm, comfortable pauses between important ideas, clear articulation of technical terms, and professional enthusiasm without excessive advertising.'
    : (style ? `Speak in a ${style} style${emotion ? ` with a ${emotion} tone` : ''}.` : '');

  const pitchHint = pitch > 1
    ? 'Voice pitch: Deliver with a slightly higher, lighter vocal tone.'
    : pitch < -1
    ? 'Voice pitch: Deliver with a slightly deeper, richer vocal resonance.'
    : '';

  const segmentPace = 'pace' in segment ? (segment as any).pace : undefined;
  const effectiveSpeed = typeof speed === 'number' && speed > 0 ? speed : (segmentPace === 'fast' ? 1.15 : segmentPace === 'slow' ? 0.85 : 1.0);
  const paceInstruction = effectiveSpeed > 1.1
    ? 'Delivery: Speak at a moderately brisk, energetic, commercial pace with clean, clear articulation — do not rush or slur words.'
    : effectiveSpeed < 0.9
    ? 'Delivery: Speak at a calm, relaxed, slightly unhurried pace — just a touch slower than normal for clear delivery. Keep pronunciation completely natural without stretching syllables.'
    : 'Delivery: Speak at a natural, standard conversational pace.';

  const keys: { name: string; value: string }[] = [];
  if (apiKeys && apiKeys.length > 0) {
    keys.push(...apiKeys);
  } else if (apiKey) {
    keys.push({ name: 'provided_key', value: apiKey });
  }

  if (keys.length === 0) {
    throw new Error('No Gemini API key available for speech generation.');
  }

  let styleMetadata = '';
  if (segment.type === 'speech') {
    if (isKabyle) {
      const regionKey = (kabyleRegion && KABYLE_REGION_HINTS[kabyleRegion]) ? kabyleRegion : 'default';
      const regionHint = KABYLE_REGION_HINTS[regionKey];

      styleMetadata = [
        'Native Algerian Kabyle (Taqbaylit) speaker. Speak in natural, spoken, conversational Kabyle — never Modern Standard Arabic, Algerian Darija, or French.',
        'Pronounce all authentic Kabyle phonemes accurately: pharyngeals (ḥ, ɛ), emphatics (ṭ, ḍ, ṣ, ẓ), and ɣ; spirantize stops; articulate "ǧ" and "č" distinctly.',
        regionHint,
        styleInstruction,
        paceInstruction,
        pitchHint
      ].filter(Boolean).join(' ');
    } else if (isEnglish) {
      const accent = dialect === 'British English (UK)'
        ? 'British English (UK / RP / Modern British) accent with clear diction and natural cadence'
        : 'crisp, engaging American English (US) accent with natural commercial cadence';

      styleMetadata = [
        `Professional native English voice-over artist with a natural ${accent}.`,
        styleInstruction,
        paceInstruction,
        pitchHint
      ].filter(Boolean).join(' ');
    } else {
      const dialectHint = DIALECT_HINTS[safeDialect] || '';

      styleMetadata = [
        `Native ${safeDialect} speaker. Speak in natural ${safeDialect} with a strong, authentic regional accent — strictly NOT Modern Standard Arabic (Fusha).`,
        dialectHint,
        styleInstruction,
        paceInstruction,
        pitchHint
      ].filter(Boolean).join(' ');
    }
  } else if (segment.type === 'sound') {
    if (isEnglish) {
      let expressionInstruction = '';
      if (segment.soundType === 'excited') {
        expressionInstruction = 'Expressive exclamation: Deliver with enthusiastic, energetic, excited wonder and high energy in natural English.';
      } else if (segment.soundType === 'surprised') {
        expressionInstruction = 'Expressive exclamation: Deliver with deep, astonished surprise and sudden astonishment in natural English.';
      } else if (segment.soundType === 'laugh') {
        expressionInstruction = 'Expressive laughter: Deliver as genuine human laughter / chuckle laughing naturally aloud rather than robotic text reading.';
      } else {
        expressionInstruction = 'Expressive vocalization: Deliver with strong natural feeling in natural English.';
      }

      styleMetadata = `Expressive native English speaker and voice artist. ${expressionInstruction}`;
    } else {
      let expressionInstruction = '';
      if (segment.soundType === 'excited') {
        expressionInstruction = 'Expressive exclamation: Deliver with enthusiastic, energetic, excited wonder and high energy in authentic local style.';
      } else if (segment.soundType === 'surprised') {
        expressionInstruction = 'Expressive exclamation: Deliver with deep, astonished surprise and sudden astonishment in authentic local style.';
      } else if (segment.soundType === 'laugh') {
        expressionInstruction = 'Expressive laughter: Deliver as genuine human laughter / chuckle laughing naturally aloud rather than robotic text reading.';
      } else {
        expressionInstruction = 'Expressive vocalization: Deliver with strong natural feeling.';
      }

      styleMetadata = `Expressive native ${dialect} speaker. ${expressionInstruction}`;
    }
  }

  let response: any = null;
  let lastErr: any = null;

  // Try up to 3 full key-rotation passes with backoff delay if keys are temporarily rate-limited
  for (let pass = 0; pass < 3 && !response; pass++) {
    if (pass > 0) {
      // Pause if previous pass hit rate limits across all keys
      await new Promise(r => setTimeout(r, 1500 * pass));
    }

    const startIdx = globalKeyRotator % keys.length;
    for (let i = 0; i < keys.length; i++) {
      const tryIdx = (startIdx + i) % keys.length;
      const keyObj = keys[tryIdx];
      const ai = new GoogleGenAI({
        apiKey: keyObj.value,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      try {
        response = await ai.models.generateContent({
          model: GEMINI_TTS_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: segment.text,
                  speechMetadata: {
                    style: styleMetadata,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice || 'Puck' }
              }
            }
          }
        });

        // Rotate start key for next segment
        globalKeyRotator = (tryIdx + 1) % keys.length;
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = (err.message || "").toLowerCase();
        const isTransient503 =
          err.status === 503 ||
          msg.includes("503") ||
          msg.includes("unavailable") ||
          msg.includes("high demand") ||
          msg.includes("overloaded");
        const isKeyOrRateErr =
          msg.includes("quota") ||
          msg.includes("limit") ||
          msg.includes("exhausted") ||
          msg.includes("429") ||
          msg.includes("403") ||
          msg.includes("401") ||
          msg.includes("permission") ||
          msg.includes("forbidden") ||
          msg.includes("leaked") ||
          msg.includes("invalid") ||
          err.status === 429 ||
          err.status === 403 ||
          err.status === 401;

        if (isTransient503 || (keys.length > 1 && isKeyOrRateErr)) {
          console.warn(`[Expressive TTS] Key ${keyObj.name} failed (${err.status || 'transient/key error'}) on segment ${segment.id}, retrying...`);
          continue;
        } else {
          throw err;
        }
      }
    }
  }

  if (!response) {
    const isAr = dialect.includes('Arabic') || dialect.includes('Kabyle');
    const msg = isAr
      ? '⚠️ وصلت سيرفرات الصوت مؤقتاً للحد الأقصى للطلبات. يرجى الانتظار بضع ثوانٍ وإعادة المحاولة.'
      : '⚠️ Voice generation servers temporarily hit request rate limits. Please wait a few seconds and try again.';
    throw new Error(msg);
  }

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error(`Failed to generate audio for segment ${segment.id}`);
  }

  const rawPcm = extractRawPcmFromTtsAudio(Buffer.from(base64Audio, 'base64'));
  const durationSec = Number((rawPcm.length / BYTES_PER_SECOND).toFixed(2));
  
  // Save standalone WAV for previewing this individual segment
  const fileId = `exp-seg-${crypto.randomUUID()}`;
  const filePath = path.join(cacheDir, `${fileId}.wav`);
  const wavBuffer = addWavHeader(rawPcm, SAMPLE_RATE, 1, 16);
  await fs.promises.writeFile(filePath, wavBuffer);

  return {
    rawPcm,
    durationSec,
    audioUrl: `/api/audio/${fileId}.wav`
  };
}

export async function processAndComposeScript(
  rawScript: string,
  options: {
    dialect: string;
    voice: string;
    style?: string;
    apiKey?: string;
    apiKeys?: { name: string; value: string }[];
    cacheDir: string;
    existingSegmentAudio?: Record<string, { rawPcm: Buffer; durationSec: number; audioUrl: string }>;
  }
): Promise<ComposedAudioResult> {
  const { dialect, voice, style, apiKey, apiKeys, cacheDir, existingSegmentAudio = {} } = options;
  const parsedSegments = parseTestScript(rawScript);

  const segmentResults: SegmentAudioResult[] = [];
  let speechDurationSec = 0;
  let silenceDurationSec = 0;

  for (let sIdx = 0; sIdx < parsedSegments.length; sIdx++) {
    const seg = parsedSegments[sIdx];
    if (seg.type === 'pause') {
      const silencePcm = createDigitalSilence(seg.durationSec);
      const actualDuration = Number((silencePcm.length / BYTES_PER_SECOND).toFixed(2));
      silenceDurationSec += actualDuration;

      // Also create a playable silence WAV so the user can preview the pause segment individually
      const pauseFileId = `exp-pause-${crypto.randomUUID()}`;
      const pauseWav = addWavHeader(silencePcm, SAMPLE_RATE, 1, 16);
      await fs.promises.writeFile(path.join(cacheDir, `${pauseFileId}.wav`), pauseWav);

      segmentResults.push({
        segmentId: seg.id,
        type: 'pause',
        durationSec: actualDuration,
        sampleCount: silencePcm.length / BYTES_PER_SAMPLE,
        audioUrl: `/api/audio/${pauseFileId}.wav`,
        rawPcm: silencePcm
      });
    } else {
      // Speech or Sound segment
      if (existingSegmentAudio[seg.id]) {
        // Reuse pre-generated segment audio if available
        const cached = existingSegmentAudio[seg.id];
        speechDurationSec += cached.durationSec;
        segmentResults.push({
          segmentId: seg.id,
          type: seg.type,
          pace: (seg as SpeechSegment).pace,
          soundType: (seg as SoundSegment).soundType,
          text: seg.text,
          sentenceId: (seg as SpeechSegment).sentenceId,
          durationSec: cached.durationSec,
          sampleCount: cached.rawPcm.length / BYTES_PER_SAMPLE,
          audioUrl: cached.audioUrl,
          rawPcm: cached.rawPcm
        });
      } else {
        // Smooth out request bursts with a 350ms pause between audio segments
        if (sIdx > 0) {
          await new Promise(r => setTimeout(r, 350));
        }

        try {
          const genResult = await generateSingleSegmentAudio(seg, { dialect, voice, style, apiKey, apiKeys, cacheDir });
          speechDurationSec += genResult.durationSec;
          segmentResults.push({
            segmentId: seg.id,
            type: seg.type,
            pace: (seg as SpeechSegment).pace,
            soundType: (seg as SoundSegment).soundType,
            text: seg.text,
            sentenceId: (seg as SpeechSegment).sentenceId,
            durationSec: genResult.durationSec,
            sampleCount: genResult.rawPcm.length / BYTES_PER_SAMPLE,
            audioUrl: genResult.audioUrl,
            rawPcm: genResult.rawPcm
          });
        } catch (err: any) {
          console.warn(`Initial generation for segment ${seg.id} hit limits. Attempting single backoff retry...`);
          await new Promise(r => setTimeout(r, 2000));
          try {
            const retryResult = await generateSingleSegmentAudio(seg, { dialect, voice, style, apiKey, apiKeys, cacheDir });
            speechDurationSec += retryResult.durationSec;
            segmentResults.push({
              segmentId: seg.id,
              type: seg.type,
              pace: (seg as SpeechSegment).pace,
              soundType: (seg as SoundSegment).soundType,
              text: seg.text,
              sentenceId: (seg as SpeechSegment).sentenceId,
              durationSec: retryResult.durationSec,
              sampleCount: retryResult.rawPcm.length / BYTES_PER_SAMPLE,
              audioUrl: retryResult.audioUrl,
              rawPcm: retryResult.rawPcm
            });
          } catch (retryErr: any) {
            console.error(`Failed to generate segment ${seg.id} after retry:`, retryErr);
            throw retryErr;
          }
        }
      }
    }
  }

  // Concatenate all raw PCM chunks sequentially (speech + digital silence)
  const validPcmChunks = segmentResults.map(s => s.rawPcm);
  const masterPcm = Buffer.concat(validPcmChunks);

  if (masterPcm.length === 0) {
    const isAr = dialect.includes('Arabic') || dialect.includes('Kabyle');
    throw new Error(isAr
      ? '⚠️ تعذر توليد الصوت للمقاطع. يرجى الانتظار 15 ثانية وإعادة المحاولة.'
      : '⚠️ Failed to generate audio segments due to temporary rate limit. Please wait 15 seconds and try again.');
  }
  const totalDurationSec = Number((masterPcm.length / BYTES_PER_SECOND).toFixed(2));

  // Wrap the composed PCM in standard WAV header
  const masterWav = addWavHeader(masterPcm, SAMPLE_RATE, 1, 16);
  const masterFileId = `exp-master-${crypto.randomUUID()}`;
  await fs.promises.writeFile(path.join(cacheDir, `${masterFileId}.wav`), masterWav);

  return {
    segments: segmentResults.map(s => ({
      id: s.segmentId,
      type: s.type,
      sentenceId: s.sentenceId,
      pace: s.pace,
      soundType: s.soundType,
      text: s.text,
      durationSec: s.durationSec,
      audioUrl: s.audioUrl,
      error: s.error
    })),
    masterAudioUrl: `/api/audio/${masterFileId}.wav`,
    totalDurationSec,
    speechDurationSec: Number(speechDurationSec.toFixed(2)),
    silenceDurationSec: Number(silenceDurationSec.toFixed(2)),
    sampleRate: SAMPLE_RATE,
    totalSamples: masterPcm.length / BYTES_PER_SAMPLE
  };
}
