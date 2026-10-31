/**
 * Experimental Expressive TTS and Audio Composition Engine
 * Isolated service for testing:
 * - Segment-level speech pacing (slow / normal / fast)
 * - Sample-accurate digital silence insertion (pauses)
 * - Expressive vocal sound generation (excited, surprised, laugh)
 * - Non-destructive raw PCM composition into a single master WAV
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface GenerateSegmentRequest {
  type: 'speech' | 'sound';
  text: string;
  pace?: 'slow' | 'normal' | 'fast';
  soundType?: 'excited' | 'surprised' | 'laugh';
  dialect?: string;
  voice?: string;
}

export interface SegmentGenerationResult {
  segmentId: string;
  durationSec: number;
  sampleRate: number;
  pcmBytes: number;
  audioUrl: string;
}

export interface ComposeTimelineItem {
  type: 'speech' | 'sound' | 'pause';
  segmentId?: string;
  durationSec?: number;
}

export interface ComposeResult {
  composedId: string;
  audioUrl: string;
  totalDurationSec: number;
  totalSamples: number;
  pcmBytes: number;
  timelineSummary: Array<{
    type: string;
    durationSec: number;
  }>;
}

const EXPERIMENT_CACHE_DIR = path.join(process.cwd(), 'audio_cache', 'experiment');
if (!fs.existsSync(EXPERIMENT_CACHE_DIR)) {
  fs.mkdirSync(EXPERIMENT_CACHE_DIR, { recursive: true });
}

function addWavHeader(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
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

export class ExperimentTtsService {
  private getApiKeys: () => { name: string; value: string }[];
  private currentKeyIndex = 0;

  constructor(getApiKeysFn: () => { name: string; value: string }[]) {
    this.getApiKeys = getApiKeysFn;
  }

  /**
   * Generates a single segment (speech or vocal reaction) with exact pacing and expression.
   */
  public async generateSegment(params: GenerateSegmentRequest): Promise<SegmentGenerationResult> {
    const apiKeys = this.getApiKeys();
    if (apiKeys.length === 0) {
      throw new Error('No Gemini API key configured in environment/secrets.');
    }

    const dialect = params.dialect || 'Saudi Arabic';
    const voice = params.voice || 'Puck';
    const text = (params.text || '').trim();

    if (!text) {
      throw new Error('Segment text is required.');
    }

    // Build specialized prompt depending on whether it is a speech segment or vocal reaction
    let prompt = '';
    if (params.type === 'sound') {
      const soundType = params.soundType || 'excited';
      let expressionDirective = '';
      if (soundType === 'excited') {
        expressionDirective = 'Vocal Reaction: Exclaim with vivid, thrilled excitement, high enthusiasm, and energetic vocal punch! Only produce the reaction.';
      } else if (soundType === 'surprised') {
        expressionDirective = 'Vocal Reaction: Express sudden, genuine shock and astonishment, with an open astonished vocal inflection! Only produce the reaction.';
      } else if (soundType === 'laugh') {
        expressionDirective = 'Vocal Reaction: Genuinely laugh out loud with audible human laughter, chuckle, and pure amusement (not just repeating words, but real laughing vocalization). Only produce the laughter.';
      }

      prompt = `Adopt an authentic native ${dialect} voice.
${expressionDirective}
Do NOT read instructions. Speak ONLY the reaction text between the tags:
<<<TEXT_TO_SPEAK_START>>>
${text}
<<<TEXT_TO_SPEAK_END>>>`;
    } else {
      // Speech segment with pace directive
      const pace = params.pace || 'normal';
      let paceDirective = '';
      if (pace === 'fast') {
        paceDirective = 'Pacing: Speak noticeably FASTER than normal, with rapid, brisk cadence and energetic quick delivery. Do not drag syllables.';
      } else if (pace === 'slow') {
        paceDirective = 'Pacing: Speak noticeably SLOWLY and deliberately, with elongated vowels and a very calm, measured, deliberate tempo. Take your time.';
      } else {
        paceDirective = 'Pacing: Speak at a natural, comfortable conversational tempo.';
      }

      prompt = `Adopt a natural native ${dialect} accent.
Style: Natural commercial delivery.
${paceDirective}
IMPORTANT: The text between the markers below is ONLY content to be spoken aloud:
<<<TEXT_TO_SPEAK_START>>>
${text}
<<<TEXT_TO_SPEAK_END>>>`;
    }

    // Try keys with rotation and retry on 429
    let rawPcmBuffer: Buffer | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < apiKeys.length * 2; attempt++) {
      const keyObj = apiKeys[this.currentKeyIndex % apiKeys.length];
      const ai = new GoogleGenAI({ apiKey: keyObj.value });

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-tts-preview',
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: ['audio' as any],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice }
              }
            }
          }
        });

        const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64) {
          throw new Error('Gemini TTS response did not contain audio data.');
        }

        rawPcmBuffer = Buffer.from(base64, 'base64');
        break;
      } catch (err: any) {
        lastError = err;
        const msg = (err.message || '').toLowerCase();
        const isQuotaOrRateLimit = msg.includes('quota') || msg.includes('429') || msg.includes('limit') || msg.includes('exhausted');

        if (isQuotaOrRateLimit) {
          console.warn(`[ExperimentTts] Key ${keyObj.name} hit rate limit / quota. Rotating key...`);
          this.currentKeyIndex = (this.currentKeyIndex + 1) % apiKeys.length;
          // Wait 2 seconds before next try
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    if (!rawPcmBuffer) {
      throw lastError || new Error('Failed to generate segment audio with Gemini TTS.');
    }

    // Measure duration accurately
    // Format is 24,000 Hz, 16-bit (2 bytes per sample), mono (1 channel) = 48,000 bytes per second
    const durationSec = Number(((rawPcmBuffer.length / 2) / 24000).toFixed(3));
    const segmentId = crypto.randomUUID();

    // Cache raw PCM for composition
    const pcmPath = path.join(EXPERIMENT_CACHE_DIR, `${segmentId}.pcm`);
    await fs.promises.writeFile(pcmPath, rawPcmBuffer);

    // Write individual WAV file for individual preview
    const wavBuffer = addWavHeader(rawPcmBuffer, 24000, 1, 16);
    const wavPath = path.join(EXPERIMENT_CACHE_DIR, `${segmentId}.wav`);
    await fs.promises.writeFile(wavPath, wavBuffer);

    return {
      segmentId,
      durationSec,
      sampleRate: 24000,
      pcmBytes: rawPcmBuffer.length,
      audioUrl: `/api/experiment/audio/${segmentId}.wav`
    };
  }

  /**
   * Composes timeline items (speech segments and digital silence) into a single master WAV.
   */
  public async composeTimeline(items: ComposeTimelineItem[]): Promise<ComposeResult> {
    if (!items || items.length === 0) {
      throw new Error('No timeline items provided for composition.');
    }

    const pcmChunks: Buffer[] = [];
    const timelineSummary: Array<{ type: string; durationSec: number }> = [];

    for (const item of items) {
      if (item.type === 'pause') {
        const sec = Math.max(0.1, Number(item.durationSec) || 1.0);
        const numSamples = Math.round(sec * 24000);
        // 16-bit mono = 2 bytes per sample filled with zeroes (pure digital silence)
        const silenceBuffer = Buffer.alloc(numSamples * 2, 0);
        pcmChunks.push(silenceBuffer);
        timelineSummary.push({ type: 'pause', durationSec: Number(sec.toFixed(3)) });
      } else {
        // Speech or Sound segment
        if (!item.segmentId) {
          throw new Error(`Missing segmentId for timeline item of type ${item.type}`);
        }
        const pcmPath = path.join(EXPERIMENT_CACHE_DIR, `${item.segmentId}.pcm`);
        if (!fs.existsSync(pcmPath)) {
          throw new Error(`Cached PCM audio for segment "${item.segmentId}" not found. Please regenerate this segment.`);
        }
        const pcmData = await fs.promises.readFile(pcmPath);
        const segmentDuration = Number(((pcmData.length / 2) / 24000).toFixed(3));
        pcmChunks.push(pcmData);
        timelineSummary.push({ type: item.type, durationSec: segmentDuration });
      }
    }

    const combinedPcm = Buffer.concat(pcmChunks);
    const totalSamples = combinedPcm.length / 2;
    const totalDurationSec = Number((totalSamples / 24000).toFixed(3));

    const finalWavBuffer = addWavHeader(combinedPcm, 24000, 1, 16);
    const composedId = `composed_${crypto.randomUUID()}`;
    const composedWavPath = path.join(EXPERIMENT_CACHE_DIR, `${composedId}.wav`);
    await fs.promises.writeFile(composedWavPath, finalWavBuffer);

    return {
      composedId,
      audioUrl: `/api/experiment/audio/${composedId}.wav`,
      totalDurationSec,
      totalSamples,
      pcmBytes: combinedPcm.length,
      timelineSummary
    };
  }
}
