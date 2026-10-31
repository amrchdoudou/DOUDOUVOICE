/**
 * Parser for Experimental Expressive TTS and Timing Script Format
 * Supports:
 * - [sentence: N]
 * - [pace: slow | normal | fast]
 * - [pause: Ns | N.Ns]
 * - [sound: excited | surprised | laugh]
 */

export type PaceType = 'slow' | 'normal' | 'fast';
export type SoundType = 'excited' | 'surprised' | 'laugh';

export interface SpeechSegment {
  id: string;
  type: 'speech';
  sentenceNumber?: number;
  pace: PaceType;
  text: string;
  durationSec?: number;
  audioUrl?: string;
  status: 'idle' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface SoundSegment {
  id: string;
  type: 'sound';
  soundType: SoundType;
  text: string;
  durationSec?: number;
  audioUrl?: string;
  status: 'idle' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface PauseSegment {
  id: string;
  type: 'pause';
  durationSec: number;
}

export type TimelineSegment = SpeechSegment | SoundSegment | PauseSegment;

export interface ParseResult {
  segments: TimelineSegment[];
  errors: string[];
}

export function parseExperimentScript(scriptText: string): ParseResult {
  const segments: TimelineSegment[] = [];
  const errors: string[] = [];

  if (!scriptText || !scriptText.trim()) {
    return { segments, errors };
  }

  // Split into paragraph blocks separated by double newlines or lines starting with '['
  const lines = scriptText.split('\n');
  let currentBlockTags: Array<{ tag: string; value: string }> = [];
  let currentTextLines: string[] = [];
  let segmentCounter = 1;

  function flushCurrentBlock() {
    if (currentBlockTags.length === 0 && currentTextLines.length === 0) return;

    // Check if this block is a pause
    const pauseTag = currentBlockTags.find(t => t.tag === 'pause');
    if (pauseTag) {
      // Parse pause duration e.g. "3s", "1.5s", "3"
      const numMatch = pauseTag.value.match(/([\d.]+)/);
      const seconds = numMatch ? parseFloat(numMatch[1]) : 1.0;
      if (isNaN(seconds) || seconds <= 0) {
        errors.push(`Invalid pause duration: "${pauseTag.value}". Defaulting to 1s.`);
      }
      segments.push({
        id: `pause_${segmentCounter++}`,
        type: 'pause',
        durationSec: isNaN(seconds) || seconds <= 0 ? 1.0 : seconds
      });
      currentBlockTags = [];
      currentTextLines = [];
      return;
    }

    // Check if this block is a sound
    const soundTag = currentBlockTags.find(t => t.tag === 'sound');
    if (soundTag) {
      let soundType: SoundType = 'excited';
      const cleanType = soundTag.value.toLowerCase().trim();
      if (cleanType === 'surprised' || cleanType.includes('surpris')) soundType = 'surprised';
      else if (cleanType === 'laugh' || cleanType.includes('laugh') || cleanType.includes('dihk')) soundType = 'laugh';
      else soundType = 'excited';

      const spokenText = currentTextLines.join(' ').trim() || (soundType === 'laugh' ? 'هاهاها!' : soundType === 'surprised' ? 'أوووه!' : 'واااو!');
      segments.push({
        id: `sound_${segmentCounter++}`,
        type: 'sound',
        soundType,
        text: spokenText,
        status: 'idle'
      });
      currentBlockTags = [];
      currentTextLines = [];
      return;
    }

    // Check if speech sentence
    const textContent = currentTextLines.join(' ').trim();
    if (textContent || currentBlockTags.length > 0) {
      const sentenceTag = currentBlockTags.find(t => t.tag === 'sentence');
      const paceTag = currentBlockTags.find(t => t.tag === 'pace');

      let sentenceNum: number | undefined;
      if (sentenceTag) {
        const parsedNum = parseInt(sentenceTag.value, 10);
        if (!isNaN(parsedNum)) sentenceNum = parsedNum;
      }

      let pace: PaceType = 'normal';
      if (paceTag) {
        const cleanPace = paceTag.value.toLowerCase().trim();
        if (cleanPace === 'slow' || cleanPace.includes('slow') || cleanPace.includes('batee')) pace = 'slow';
        else if (cleanPace === 'fast' || cleanPace.includes('fast') || cleanPace.includes('sari')) pace = 'fast';
      }

      if (textContent) {
        segments.push({
          id: `speech_${segmentCounter++}`,
          type: 'speech',
          sentenceNumber: sentenceNum,
          pace,
          text: textContent,
          status: 'idle'
        });
      }
    }

    currentBlockTags = [];
    currentTextLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // Empty line signals block boundary if we already have text or tags
      if (currentTextLines.length > 0) {
        flushCurrentBlock();
      }
      continue;
    }

    // Check if line contains one or more tags e.g. [sentence: 1] or [pace: fast]
    const tagMatch = line.match(/^\[([a-zA-Z0-9_-]+)\s*:\s*([^\]]+)\]$/);
    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase().trim();
      const value = tagMatch[2].trim();

      // If we encounter a tag while we already have text accumulated, flush first
      if (currentTextLines.length > 0) {
        flushCurrentBlock();
      }

      currentBlockTags.push({ tag, value });

      // If tag is pause, it is self-contained so we can flush immediately
      if (tag === 'pause') {
        flushCurrentBlock();
      }
    } else {
      // Text line
      currentTextLines.push(line);
    }
  }

  flushCurrentBlock();

  return { segments, errors };
}

export const SAMPLE_EXPERIMENT_SCRIPT = `[sentence: 1]
[pace: fast]
راك تسوق كل يوم وجوالك ضايع بين المرتبة والطبلون؟

[sentence: 2]
[pace: slow]
مع MagnaDrive، جوالك يكون قدامك وانت تسوق.

[pause: 3s]

[sound: excited]
واااو!

[pause: 1s]

[sound: surprised]
أوووه!

[pause: 1s]

[sound: laugh]
هاهاها!

[sentence: 3]
[pace: normal]
اطلب MagnaDrive الحين!`;
