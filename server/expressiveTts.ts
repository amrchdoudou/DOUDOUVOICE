/**
 * Experimental Expressive TTS and Timing Engine
 * Isolated testing module using gemini-3.1-flash-tts-preview
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

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // 16-bit mono
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE; // 48000 bytes/sec

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

let globalKeyRotator = 0;

export async function generateSingleSegmentAudio(
  segment: SpeechSegment | SoundSegment,
  options: {
    dialect: string;
    voice: string;
    style?: string;
    apiKey?: string;
    apiKeys?: { name: string; value: string }[];
    cacheDir: string;
  }
): Promise<{ rawPcm: Buffer; durationSec: number; audioUrl: string }> {
  const { dialect, voice, style, apiKey, apiKeys, cacheDir } = options;
  const isEnglish = dialect === 'American English (US)' || dialect === 'British English (UK)' || dialect.toLowerCase().includes('english');

  const presentationInstruction = style === 'Presentation'
    ? 'Delivery Style: Presentation. Speak with confidence, clarity, and natural authority. Sound like a skilled presenter explaining a product or feature to an audience or judging panel, with an engaging opening, natural rhythm, comfortable pauses between important ideas, clear articulation of technical terms, and professional enthusiasm without excessive advertising.'
    : '';

  const keys: { name: string; value: string }[] = [];
  if (apiKeys && apiKeys.length > 0) {
    keys.push(...apiKeys);
  } else if (apiKey) {
    keys.push({ name: 'provided_key', value: apiKey });
  }

  if (keys.length === 0) {
    throw new Error('No Gemini API key available for speech generation.');
  }

  let prompt = '';
  if (segment.type === 'speech') {
    if (isEnglish) {
      const accent = dialect === 'British English (UK)'
        ? 'British English (UK / RP / Modern British) accent with clear diction and natural cadence'
        : 'crisp, engaging American English (US) accent with natural commercial cadence';

      let paceInstruction = '';
      if (segment.pace === 'fast') {
        paceInstruction = 'Delivery: Speak at a moderately brisk, energetic, upbeat commercial pace — slightly faster than normal with clean, crisp, articulate pronunciation. Do not rush or slur words.';
      } else if (segment.pace === 'slow') {
        paceInstruction = 'Delivery: Speak at a calm, relaxed, slightly unhurried commercial voice-over pace — just a touch slower than normal for clarity and emphasis. Keep pronunciation completely natural without stretching syllables or dragging out words.';
      } else {
        paceInstruction = 'Delivery: Speak at a natural, standard conversational voice-over pace.';
      }

      prompt = `You are a professional voice-over artist and native speaker of English.
Speak with a natural, ${accent}.
${presentationInstruction}
${paceInstruction}

<<<TEXT_TO_SPEAK_START>>>
${segment.text}
<<<TEXT_TO_SPEAK_END>>>`;
    } else {
      let paceInstruction = '';
      if (segment.pace === 'fast') {
        paceInstruction = 'Delivery: Speak at a moderately brisk, energetic, commercial pace — slightly faster than normal with clear, articulate pronunciation. Do not rush or slur words.';
      } else if (segment.pace === 'slow') {
        paceInstruction = 'Delivery: Speak at a calm, relaxed, slightly unhurried pace — just a touch slower than normal for clear delivery. Keep pronunciation completely natural without stretching syllables or dragging out words.';
      } else {
        paceInstruction = 'Delivery: Speak at a natural, standard conversational pace.';
      }

      prompt = `You are a native ${dialect} speaker.
Please speak the following text in natural ${dialect}.
${presentationInstruction}
${paceInstruction}

<<<TEXT_TO_SPEAK_START>>>
${segment.text}
<<<TEXT_TO_SPEAK_END>>>`;
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

      prompt = `You are an expressive native English speaker and voice artist.
${expressionInstruction}

<<<TEXT_TO_SPEAK_START>>>
${segment.text}
<<<TEXT_TO_SPEAK_END>>>`;
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

      prompt = `You are an expressive native ${dialect} speaker.
${expressionInstruction}

<<<TEXT_TO_SPEAK_START>>>
${segment.text}
<<<TEXT_TO_SPEAK_END>>>`;
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
      const ai = new GoogleGenAI({ apiKey: keyObj.value });

      try {
        response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: ["audio" as any],
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
        if (
          msg.includes("quota") ||
          msg.includes("limit") ||
          msg.includes("exhausted") ||
          msg.includes("429") ||
          err.status === 429
        ) {
          console.warn(`[Expressive TTS] Key ${keyObj.name} hit quota/limit on segment ${segment.id}, trying next key...`);
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

  const rawPcm = Buffer.from(base64Audio, 'base64');
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
