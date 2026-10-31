/**
 * Test Script Parser for Expressive TTS & Timing Experiment
 * Parses directives:
 *   [sentence: <id>]
 *   [pace: slow | normal | fast]
 *   [pause: <Xs>]
 *   [sound: excited | surprised | laugh]
 */

export interface SpeechSegment {
  id: string;
  type: 'speech';
  sentenceId?: string;
  pace: 'slow' | 'normal' | 'fast';
  text: string;
  durationSec?: number;
  audioUrl?: string;
  error?: string;
}

export interface PauseSegment {
  id: string;
  type: 'pause';
  durationSec: number;
}

export interface SoundSegment {
  id: string;
  type: 'sound';
  soundType: 'excited' | 'surprised' | 'laugh' | string;
  text: string;
  durationSec?: number;
  audioUrl?: string;
  error?: string;
}

export type ParsedSegment = SpeechSegment | PauseSegment | SoundSegment;

export function parseTestScript(rawScript: string): ParsedSegment[] {
  const lines = rawScript.split(/\r?\n/);
  const segments: ParsedSegment[] = [];

  let currentSpeech: {
    sentenceId?: string;
    pace: 'slow' | 'normal' | 'fast';
    textLines: string[];
  } | null = null;

  let currentSound: {
    soundType: string;
    textLines: string[];
  } | null = null;

  function flushCurrent() {
    if (currentSpeech && currentSpeech.textLines.length > 0) {
      const text = currentSpeech.textLines.join(' ').trim();
      if (text) {
        segments.push({
          id: `speech-${segments.length + 1}`,
          type: 'speech',
          sentenceId: currentSpeech.sentenceId,
          pace: currentSpeech.pace,
          text
        });
      }
      currentSpeech = null;
    }

    if (currentSound && currentSound.textLines.length > 0) {
      const text = currentSound.textLines.join(' ').trim();
      if (text) {
        segments.push({
          id: `sound-${segments.length + 1}`,
          type: 'sound',
          soundType: currentSound.soundType,
          text
        });
      }
      currentSound = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      // blank line might separate blocks
      continue;
    }

    // Check [pause: Xs]
    const pauseMatch = line.match(/^\[pause:\s*([0-9.]+)\s*s?\]$/i);
    if (pauseMatch) {
      flushCurrent();
      const sec = parseFloat(pauseMatch[1]);
      if (!isNaN(sec) && sec > 0) {
        segments.push({
          id: `pause-${segments.length + 1}`,
          type: 'pause',
          durationSec: sec
        });
      }
      continue;
    }

    // Check [sentence: id]
    const sentenceMatch = line.match(/^\[sentence:\s*([a-zA-Z0-9_\-]+)\]$/i);
    if (sentenceMatch) {
      flushCurrent();
      currentSpeech = {
        sentenceId: sentenceMatch[1],
        pace: 'normal',
        textLines: []
      };
      continue;
    }

    // Check [pace: slow|normal|fast]
    const paceMatch = line.match(/^\[pace:\s*(slow|normal|fast)\]$/i);
    if (paceMatch) {
      const paceVal = paceMatch[1].toLowerCase() as 'slow' | 'normal' | 'fast';
      if (currentSpeech) {
        currentSpeech.pace = paceVal;
      } else {
        flushCurrent();
        currentSpeech = {
          pace: paceVal,
          textLines: []
        };
      }
      continue;
    }

    // Check [sound: excited|surprised|laugh]
    const soundMatch = line.match(/^\[sound:\s*([a-zA-Z0-9_\-]+)\]$/i);
    if (soundMatch) {
      flushCurrent();
      currentSound = {
        soundType: soundMatch[1].toLowerCase(),
        textLines: []
      };
      continue;
    }

    // Regular text line
    if (currentSound) {
      currentSound.textLines.push(line);
    } else if (currentSpeech) {
      currentSpeech.textLines.push(line);
    } else {
      // Default to speech segment with normal pace
      currentSpeech = {
        pace: 'normal',
        textLines: [line]
      };
    }
  }

  flushCurrent();
  return segments;
}
