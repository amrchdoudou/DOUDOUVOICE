/**
 * Shared configuration for Meta Model API and fallback settings.
 * Single source of truth for model names, roles, and strict mode enforcement.
 */

export const DEFAULT_META_CONTRIBUTOR_MODEL = 'muse-spark-1.2-contributor';
export const DEFAULT_META_REVIEWER_MODEL = 'muse-spark-1.1';
export const DEFAULT_META_INSPECTOR_MODEL = 'muse-spark-1.1';

export const DEFAULT_META_MODEL = DEFAULT_META_CONTRIBUTOR_MODEL;
export const DEFAULT_META_IMAGE_MODEL = DEFAULT_META_CONTRIBUTOR_MODEL;
export const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash';
export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';

export function getMetaModel(): string {
  return process.env.META_MODEL || DEFAULT_META_CONTRIBUTOR_MODEL;
}

export function getMetaImageModel(): string {
  return process.env.META_IMAGE_MODEL || DEFAULT_META_CONTRIBUTOR_MODEL;
}

export function getMetaContributorModel(): string {
  return process.env.META_CONTRIBUTOR_MODEL || process.env.META_MODEL || DEFAULT_META_CONTRIBUTOR_MODEL;
}

export function getMetaReviewerModel(): string {
  return process.env.META_REVIEWER_MODEL || DEFAULT_META_REVIEWER_MODEL;
}

export function getMetaInspectorModel(): string {
  return process.env.META_INSPECTOR_MODEL || DEFAULT_META_INSPECTOR_MODEL;
}

export function isMetaStrict(): boolean {
  return String(process.env.META_STRICT || '').toLowerCase() === 'true';
}

export const META_MODEL = getMetaModel();
export const META_IMAGE_MODEL = getMetaImageModel();
export const META_CONTRIBUTOR_MODEL = getMetaContributorModel();
export const META_REVIEWER_MODEL = getMetaReviewerModel();
export const META_INSPECTOR_MODEL = getMetaInspectorModel();

