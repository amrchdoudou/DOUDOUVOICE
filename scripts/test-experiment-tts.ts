/**
 * Standalone experiment test runner
 * Tests gemini-3.1-flash-tts-preview for:
 * 1. Pacing differences (fast vs slow)
 * 2. Expressive vocal reactions (excited, surprised, laugh)
 * 3. Digital silence composition
 */

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';

function getApiKey(): string {
  for (const k of Object.keys(process.env)) {
    const val = process.env[k];
    if (val && !val.includes('MY_GEMINI_API_KEY')) {
      if (k === 'GEMINI_API_KEY' || k.toLowerCase().startsWith('gemini_api_key')) {
        return val;
      }
    }
  }
  throw new Error('No Gemini API key found in environment.');
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

async function generateSegment(ai: GoogleGenAI, prompt: string, voice = 'Puck'): Promise<{ pcm: Buffer; durationSec: number }> {
  const res = await ai.models.generateContent({
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

  const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64) throw new Error('No audio returned from Gemini');
  const pcm = Buffer.from(base64, 'base64');
  const durationSec = (pcm.length / 2) / 24000;
  return { pcm, durationSec };
}

async function run() {
  console.log('Testing gemini-3.1-flash-tts-preview for Experimental TTS & Timing...\n');
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const testSentence = 'مع MagnaDrive، جوالك يكون قدامك وانت تسوق.';

  // Test 1: Pacing Comparison
  console.log('1. Testing Pacing: FAST vs SLOW for identical sentence...');
  const fastPrompt = `Adopt a natural Saudi Arabic accent.
Pacing: Speak noticeably faster, with rapid, quick cadence.
<<<TEXT_TO_SPEAK_START>>>
${testSentence}
<<<TEXT_TO_SPEAK_END>>>`;

  const slowPrompt = `Adopt a natural Saudi Arabic accent.
Pacing: Speak noticeably slowly and deliberately, with elongated vowels and calm, unhurried tempo.
<<<TEXT_TO_SPEAK_START>>>
${testSentence}
<<<TEXT_TO_SPEAK_END>>>`;

  const fastRes = await generateSegment(ai, fastPrompt);
  console.log(`   ✓ Fast pace duration: ${fastRes.durationSec.toFixed(2)}s (${fastRes.pcm.length} PCM bytes)`);

  const slowRes = await generateSegment(ai, slowPrompt);
  console.log(`   ✓ Slow pace duration: ${slowRes.durationSec.toFixed(2)}s (${slowRes.pcm.length} PCM bytes)`);
  console.log(`   ✓ Speed difference ratio: ${(slowRes.durationSec / fastRes.durationSec).toFixed(2)}x slower\n`);

  // Test 2: Digital Silence
  console.log('2. Testing Digital Silence (3.0 seconds)...');
  const pauseDurationSec = 3.0;
  const numSamples = Math.round(pauseDurationSec * 24000);
  const silencePcm = Buffer.alloc(numSamples * 2, 0);
  const measuredSilenceSec = (silencePcm.length / 2) / 24000;
  console.log(`   ✓ Requested: ${pauseDurationSec}s, Generated: ${measuredSilenceSec}s (${silencePcm.length} bytes of zero samples)\n`);

  // Test 3: Expressive Sounds (excited, surprised, laugh)
  console.log('3. Testing Expressive Vocal Sounds...');
  const excitedPrompt = `Adopt a lively Saudi Arabic accent.
Emotion & Tone: Exclaim with intense, thrilled excitement and pure enthusiasm!
<<<TEXT_TO_SPEAK_START>>>
واااو!
<<<TEXT_TO_SPEAK_END>>>`;
  const excitedRes = await generateSegment(ai, excitedPrompt);
  console.log(`   ✓ [sound: excited] duration: ${excitedRes.durationSec.toFixed(2)}s`);

  const surprisedPrompt = `Adopt a lively Saudi Arabic accent.
Emotion & Tone: Express sudden shock and genuine astonishment!
<<<TEXT_TO_SPEAK_START>>>
أوووه!
<<<TEXT_TO_SPEAK_END>>>`;
  const surprisedRes = await generateSegment(ai, surprisedPrompt);
  console.log(`   ✓ [sound: surprised] duration: ${surprisedRes.durationSec.toFixed(2)}s`);

  const laughPrompt = `Adopt a friendly conversational tone.
Emotion & Tone: Genuinely laugh out loud with audible human laughter, chuckle, and amusement (not just repeating words, but real laughing vocalization).
<<<TEXT_TO_SPEAK_START>>>
هاهاها!
<<<TEXT_TO_SPEAK_END>>>`;
  const laughRes = await generateSegment(ai, laughPrompt);
  console.log(`   ✓ [sound: laugh] duration: ${laughRes.durationSec.toFixed(2)}s`);

  // Test 4: Audio Composition
  console.log('\n4. Testing Audio Composition (Concatenation of all PCM + Silence)...');
  const composedPcm = Buffer.concat([
    fastRes.pcm,
    silencePcm,
    slowRes.pcm,
    Buffer.alloc(Math.round(1.0 * 24000) * 2, 0),
    excitedRes.pcm,
    Buffer.alloc(Math.round(1.0 * 24000) * 2, 0),
    surprisedRes.pcm,
    Buffer.alloc(Math.round(1.0 * 24000) * 2, 0),
    laughRes.pcm
  ]);

  const finalWav = addWavHeader(composedPcm, 24000, 1, 16);
  const totalDuration = (composedPcm.length / 2) / 24000;
  console.log(`   ✓ Total Composed PCM length: ${composedPcm.length} bytes`);
  console.log(`   ✓ Total Composed WAV file size: ${finalWav.length} bytes`);
  console.log(`   ✓ Total Duration: ${totalDuration.toFixed(2)}s`);

  const testOutputDir = path.join(process.cwd(), 'audio_cache');
  if (!fs.existsSync(testOutputDir)) fs.mkdirSync(testOutputDir, { recursive: true });
  fs.writeFileSync(path.join(testOutputDir, 'test_composed.wav'), finalWav);
  console.log(`   ✓ Saved composed test file to audio_cache/test_composed.wav\n`);

  console.log('============================================================');
  console.log('ALL EXPERIMENTAL TTS & TIMING TESTS COMPLETED');
  console.log('============================================================');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
