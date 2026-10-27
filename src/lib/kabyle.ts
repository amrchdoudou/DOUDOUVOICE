/**
 * Kabyle (Taqbaylit) linguistic tools: script detection, text normalization,
 * and regional dialect definitions for DoudouVoice TTS.
 */

export type KabyleScript = 'latin' | 'arabic' | 'tifinagh' | 'mixed';

export interface KabyleRegionInfo {
  id: string;
  labelEn: string;
  labelAr: string;
  hint: string;
}

export const KABYLE_REGIONS: Record<string, KabyleRegionInfo> = {
  default: {
    id: 'default',
    labelEn: 'Default (Standard Taqbaylit)',
    labelAr: 'الافتراضية (تقبايليت المعيارية)',
    hint: 'Use standard Taqbaylit pronunciation with balanced spirantization of dental and velar stops, clear pharyngeals (ḥ, ɛ), and authentic conversational cadence.'
  },
  tizi_ouzou: {
    id: 'tizi_ouzou',
    labelEn: 'Tizi Ouzou (Greater Kabylia)',
    labelAr: 'تيزي وزو (القبائل الكبرى)',
    hint: 'Use Greater Kabylia (Tizi Ouzou) accent: characteristic melodic intonation, pronounced spirantization of non-geminated stops (b, t, d, k, g), and local rhythmic flow.'
  },
  bejaia: {
    id: 'bejaia',
    labelEn: 'Béjaïa (Lesser Kabylia)',
    labelAr: 'بجاية (القبائل الصغرى)',
    hint: 'Use Lesser Kabylia (Béjaïa / Soummam) accent: distinctive eastern Kabyle melodic cadence, specific vowel transitions, and natural Soummam valley phrasing.'
  },
  bouira: {
    id: 'bouira',
    labelEn: 'Bouira',
    labelAr: 'البويرة',
    hint: 'Use South-Western Kabylia (Bouira) accent: fluent transitional intonation with authentic regional phonetic softening.'
  },
  bba_setif: {
    id: 'bba_setif',
    labelEn: 'Bordj Bou Arreridj / Setif highlands',
    labelAr: 'مرتفعات برج بوعريريج / سطيف',
    hint: 'Use southern/eastern highland Kabyle accent: firmer stop articulations with characteristic highland melodic cadence.'
  }
};

export const VALID_KABYLE_REGIONS = Object.keys(KABYLE_REGIONS);

/**
 * Detects the predominant script of the given text.
 * Returns 'latin', 'arabic', 'tifinagh', or 'mixed'.
 */
export function detectScript(text: string): KabyleScript {
  if (!text || typeof text !== 'string') return 'latin';

  const latinMatches = text.match(/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g) || [];
  const arabicMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || [];
  const tifinaghMatches = text.match(/[\u2D30-\u2D7F]/g) || [];

  const counts = [
    { type: 'latin' as const, count: latinMatches.length },
    { type: 'arabic' as const, count: arabicMatches.length },
    { type: 'tifinagh' as const, count: tifinaghMatches.length }
  ].filter(c => c.count > 0);

  if (counts.length === 0) return 'latin';
  if (counts.length === 1) return counts[0].type;

  const total = counts.reduce((acc, c) => acc + c.count, 0);
  for (const c of counts) {
    if (c.count / total >= 0.85) {
      return c.type;
    }
  }

  return 'mixed';
}

// Regex to detect standalone URLs or email addresses
const URL_OR_EMAIL_REGEX = /(?:https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

// Common technical terms or units where numbers shouldn't be altered
const EXCLUDED_WORDS = new Set([
  'mp3', 'mp4', 'mpeg', '3d', '4k', 'h264', 'h265', 'ipv4', 'ipv6',
  'win32', 'win64', 'utf8', 'utf16', '2g', '3g', '4g', '5g', 'web3'
]);

/**
 * Normalizes Kabyle text without translating or altering the user's intended words:
 * 1. Trims and collapses irregular horizontal whitespace while preserving newlines.
 * 2. Normalizes Unicode to NFC.
 * 3. Unifies typographic apostrophes to standard single quote.
 * 4. Unifies Greek lookalikes (ε -> ɛ, γ -> ɣ, etc.).
 * 5. Safely converts chat alphabet numerals (3 -> ɛ, 7 -> ḥ, 9 -> q) ONLY inside
 *    words that are clearly Kabyle chat spelling, never inside numbers, URLs, or tech terms.
 */
export function normalizeKabyle(text: string): string {
  if (!text || typeof text !== 'string') return '';

  // 1. Unicode normalization to Canonical Composition (NFC)
  let normalized = text.normalize('NFC');

  // 2. Unify apostrophes to standard straight apostrophe
  normalized = normalized.replace(/[’‘ʻʼ`´]/g, "'");

  // 3. Unify Greek lookalike letters mistakenly typed for Kabyle Latin characters
  normalized = normalized
    .replace(/\u03B5/g, 'ɛ') // Greek small epsilon -> Latin small open e
    .replace(/\u0395/g, 'Ɛ') // Greek capital epsilon -> Latin capital open e
    .replace(/\u03B3/g, 'ɣ') // Greek small gamma -> Latin small gamma
    .replace(/\u0393/g, 'Ɣ'); // Greek capital gamma -> Latin capital gamma

  // 4. Protect URLs and email addresses with placeholder tokens
  const preservedUrls: string[] = [];
  normalized = normalized.replace(URL_OR_EMAIL_REGEX, (url) => {
    preservedUrls.push(url);
    return `__PRESERVED_URL_${preservedUrls.length - 1}__`;
  });

  // 5. Chat transliteration conversion for Kabyle chat conventions (3 -> ɛ, 7 -> ḥ, 9 -> q)
  // Match word-like chunks surrounded by boundaries
  normalized = normalized.replace(/\b([a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF'-]+)\b/gu, (token) => {
    if (token.startsWith('__PRESERVED_URL_')) {
      return token;
    }

    const lower = token.toLowerCase();
    if (EXCLUDED_WORDS.has(lower)) {
      return token;
    }

    // Pure number (e.g. 500, 2024, 379) or number with standard punctuation/units
    if (/^[0-9]+$/i.test(token)) {
      return token;
    }

    // Must contain at least one Latin letter AND at least one chat digit (3, 7, 9)
    const hasLatinLetter = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(token);
    const hasChatDigit = /[379]/.test(token);

    if (!hasLatinLetter || !hasChatDigit) {
      return token;
    }

    // Convert chat digits to authentic Kabyle characters
    return token
      .replace(/3/g, 'ɛ')
      .replace(/7/g, 'ḥ')
      .replace(/9/g, 'q');
  });

  // Restore preserved URLs
  normalized = normalized.replace(/__PRESERVED_URL_(\d+)__/g, (_, idx) => {
    return preservedUrls[parseInt(idx, 10)] || '';
  });

  // 6. Collapse consecutive horizontal whitespace (preserving intentional linebreaks)
  normalized = normalized
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .join('\n')
    .trim();

  return normalized;
}
