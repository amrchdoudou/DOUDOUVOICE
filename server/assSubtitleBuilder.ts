import fs from 'node:fs';
import path from 'node:path';

export interface AssSubtitleCue {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

export interface AssOverlayCue {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
  style: 'title' | 'badge' | 'cta_pill';
}

export interface AssBuilderOptions {
  width: number;
  height: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  subtitles: AssSubtitleCue[];
  overlays?: AssOverlayCue[];
}

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Formats seconds into Advanced SubStation Alpha (ASS) timestamp: H:MM:SS.cc
 */
export function formatAssTimestamp(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalCentiseconds = Math.round(clamped * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hrs = Math.floor(totalMinutes / 60);

  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Escapes a filesystem path for safe embedding inside an FFmpeg filter argument
 * e.g. ass=filename='...':shaping=complex
 */
export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Wraps and formats a single line with Unicode Right-to-Left Embedding (\u202B...\u202C)
 * and keeps contiguous Latin+number phrases (e.g. "DoudouVoice 2026") in a single
 * Noto Sans font run so libass + HarfBuzz-ng never splits "Brand 2026" across two fonts.
 */
function applyRtlBidiMarks(line: string, baseFont = 'Noto Sans Arabic'): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (ARABIC_CHAR_REGEX.test(trimmed)) {
    const withLatinFontRuns = trimmed.replace(
      /[A-Za-z]+(?:\s+[A-Za-z0-9._-]+)*/g,
      match => `{\\fnNoto Sans}${match}{\\fn${baseFont}}`
    );
    return `\u202B${withLatinFontRuns}\u202C`;
  }
  return trimmed;
}

/**
 * Sanitizes raw text for ASS Dialogue events, splits long phrases into balanced
 * multi-line captions, and enforces RTL BiDi embedding on Arabic lines.
 */
export function formatBidiAssText(
  rawText: string,
  maxCharsPerLine = 42,
  baseFont = 'Noto Sans Arabic'
): string {
  if (!rawText) return '';

  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();

  if (!cleaned) return '';

  // Respect explicit line breaks first
  const rawParagraphs = cleaned.split('\n').map(p => p.trim()).filter(Boolean);
  const finalLines: string[] = [];

  for (const para of rawParagraphs) {
    if (para.length <= maxCharsPerLine) {
      finalLines.push(applyRtlBidiMarks(para, baseFont));
      continue;
    }

    const words = para.split(/\s+/);
    if (words.length <= 1) {
      finalLines.push(applyRtlBidiMarks(para, baseFont));
      continue;
    }

    // Balance into 2 lines if total length <= 2 * maxCharsPerLine
    if (para.length <= maxCharsPerLine * 2) {
      const targetMid = para.length / 2;
      let bestSplitIdx = 1;
      let bestDist = Infinity;
      let runningLen = 0;

      for (let i = 0; i < words.length - 1; i++) {
        runningLen += (i > 0 ? 1 : 0) + words[i].length;
        const dist = Math.abs(runningLen - targetMid);
        if (dist < bestDist) {
          bestDist = dist;
          bestSplitIdx = i + 1;
        }
      }

      const line1 = words.slice(0, bestSplitIdx).join(' ');
      const line2 = words.slice(bestSplitIdx).join(' ');
      finalLines.push(applyRtlBidiMarks(line1, baseFont));
      finalLines.push(applyRtlBidiMarks(line2, baseFont));
    } else {
      let currentLine = '';
      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (candidate.length > maxCharsPerLine && currentLine) {
          finalLines.push(applyRtlBidiMarks(currentLine, baseFont));
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }
      if (currentLine) {
        finalLines.push(applyRtlBidiMarks(currentLine, baseFont));
      }
    }
  }

  return finalLines.join('\\N');
}

/**
 * Generates complete .ass (Advanced SubStation Alpha v4.00+) file contents
 * supporting HarfBuzz complex Arabic shaping, bottom-third synchronized subtitles,
 * and animated commercial title/badge/CTA overlays.
 */
export function buildCreatorAssContent(options: AssBuilderOptions): string {
  const width = Math.max(320, Math.floor((options.width || 1080) / 2) * 2);
  const height = Math.max(180, Math.floor((options.height || 1920) / 2) * 2);
  const isVertical = height > width;
  const isSquare = width === height;

  // Typography scaling relative to canvas resolution
  const subtitleFontSize = isVertical ? 46 : isSquare ? 42 : 40;
  const titleFontSize = isVertical ? 54 : isSquare ? 48 : 46;
  const badgeFontSize = isVertical ? 40 : isSquare ? 36 : 36;
  const ctaFontSize = isVertical ? 48 : isSquare ? 44 : 42;

  // Safe-zone margins so captions never collide with TikTok/Reels/Shorts UI chrome or frame edges
  const subMarginV = isVertical ? 230 : isSquare ? 115 : 85;
  const subMarginH = isVertical ? 80 : 96;

  // ASS colors use &HAABBGGRR hex format (00 = opaque, FF = transparent)
  // High-contrast semi-opaque backdrop boxes (&H32000000 = ~80% opaque dark backing) prevent unreadable low-contrast text over bright scenes
  const styleBlock = [
    '[Script Info]',
    '; Generated by DoudouVoice Autonomous Editing Engine',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Layer 0: Bottom-third synchronized voiceover subtitles (Crisp white text on high-contrast 80% opaque dark box)
    `Style: Subtitle,Noto Sans Arabic,${subtitleFontSize},&H00FFFFFF,&H0000FFFF,&H300A0A0A,&H300A0A0A,-1,0,0,0,100,100,0,0,3,16,2,2,${subMarginH},${subMarginH},${subMarginV},1`,
    // Layer 1: Opening / Hero Title (Warm Gold-White text on deep 82% opaque charcoal box, top safe zone)
    `Style: OverlayTitle,Noto Kufi Arabic,${titleFontSize},&H00D8FAFF,&H0000FFFF,&H2E14100C,&H2E14100C,-1,0,0,0,100,100,0,0,3,18,2,8,${subMarginH},${subMarginH},185,1`,
    // Layer 1: Feature Callout Badge (Crisp White text on deep slate translucent pill)
    `Style: OverlayBadge,Noto Kufi Arabic,${badgeFontSize},&H00FFFFFF,&H0000FFFF,&H32221610,&H32221610,-1,0,0,0,100,100,0,0,3,15,2,8,${subMarginH},${subMarginH},155,1`,
    // Layer 1: Call-To-Action Pill (High-contrast commercial CTA badge on final scene)
    `Style: OverlayCta,Noto Kufi Arabic,${ctaFontSize},&H00FFFFFF,&H0000FFFF,&H24104A85,&H24104A85,-1,0,0,0,100,100,0,0,3,20,3,8,${subMarginH},${subMarginH},245,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  const eventLines: string[] = [];

  // 1. Add Synchronized Bottom-Third Subtitles (Layer 0)
  for (const cue of options.subtitles || []) {
    if (!cue.text || !cue.text.trim()) continue;
    if (cue.endTimeSec <= cue.startTimeSec + 0.04) continue;

    const startStr = formatAssTimestamp(cue.startTimeSec);
    const endStr = formatAssTimestamp(cue.endTimeSec);
    const formattedText = formatBidiAssText(cue.text, isVertical ? 38 : 48);
    if (!formattedText) continue;

    eventLines.push(
      `Dialogue: 0,${startStr},${endStr},Subtitle,,0,0,0,,{\\fad(120,120)}${formattedText}`
    );
  }

  // 2. Add Animated Upper-Third Title / Badge / CTA Overlays (Layer 1)
  const cx = Math.round(width / 2);
  for (const ov of options.overlays || []) {
    if (!ov.text || !ov.text.trim()) continue;
    if (ov.endTimeSec <= ov.startTimeSec + 0.1) continue;

    const startStr = formatAssTimestamp(ov.startTimeSec);
    const endStr = formatAssTimestamp(ov.endTimeSec);
    const formattedText = formatBidiAssText(ov.text, isVertical ? 32 : 42, 'Noto Kufi Arabic');
    if (!formattedText) continue;

    let styleName = 'OverlayBadge';
    let yStart = isVertical ? 130 : 75;
    let yEnd = isVertical ? 175 : 105;
    let fadeInMs = 200;
    let fadeOutMs = 200;
    let moveEndMs = 300;

    if (ov.style === 'title') {
      styleName = 'OverlayTitle';
      yStart = isVertical ? 170 : 90;
      yEnd = isVertical ? 225 : 130;
      fadeInMs = 250;
      fadeOutMs = 250;
      moveEndMs = 350;
    } else if (ov.style === 'cta_pill') {
      styleName = 'OverlayCta';
      yStart = isVertical ? 280 : 140;
      yEnd = isVertical ? 240 : 115;
      fadeInMs = 220;
      fadeOutMs = 250;
      moveEndMs = 320;
    }

    eventLines.push(
      `Dialogue: 1,${startStr},${endStr},${styleName},,0,0,0,,{\\an8\\fad(${fadeInMs},${fadeOutMs})\\move(${cx},${yStart},${cx},${yEnd},0,${moveEndMs})}${formattedText}`
    );
  }

  return [...styleBlock, ...eventLines, ''].join('\n');
}

/**
 * Writes the .ass script file to disk in UTF-8 and returns its absolute path.
 */
export function writeCreatorAssFile(outputFilePath: string, options: AssBuilderOptions): string {
  const dir = path.dirname(outputFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = buildCreatorAssContent(options);
  fs.writeFileSync(outputFilePath, content, 'utf-8');
  return outputFilePath;
}
