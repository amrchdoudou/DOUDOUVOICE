import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ModalClient } from 'modal';
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { EditingPlan, MAX_SLOWDOWN_FACTOR } from './metaCreatorService.js';
import {
  writeCreatorAssFile,
  escapeFfmpegFilterPath,
  AssOverlayCue,
  AssSubtitleCue
} from './assSubtitleBuilder.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const DEFAULT_MODAL_APP_NAME = 'doudouvoice-media-edit';
export const DEFAULT_MODAL_WORKSPACE = 'abdelwadoudamirouche7';
export const DEFAULT_MODAL_ENVIRONMENT = 'main';
export const DEFAULT_MODAL_FUNCTION_NAME = 'edit_media';
export const DEFAULT_MODAL_APP_ID = 'ap-PNNq10tlmnZUC85lShUIiM';

export interface ModalAppConfig {
  appName: string;
  workspace: string;
  environment: string;
  functionName: string;
  appId: string;
  tokenId: string;
  tokenSecret: string;
  webhookUrl: string;
  apiKey: string;
  timeoutMs: number;
  tokenType: 'api_token' | 'proxy_auth_token' | 'none';
  tokenFormatWarning?: string;
  hasSdkCredentials: boolean;
  hasWebhookCredentials: boolean;
  isConfigured: boolean;
}

function cleanEnvCredential(raw: string): string {
  let cleaned = (raw || '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  const akMatch = cleaned.match(/\b(ak-[A-Za-z0-9]{16,32})\b/);
  if (akMatch) return akMatch[1];
  const asMatch = cleaned.match(/\b(as-[A-Za-z0-9]{16,32})\b/);
  if (asMatch) return asMatch[1];
  const wkMatch = cleaned.match(/\b(wk-[A-Za-z0-9]{16,32})\b/);
  if (wkMatch) return wkMatch[1];
  const wsMatch = cleaned.match(/\b(ws-[A-Za-z0-9]{16,32})\b/);
  if (wsMatch) return wsMatch[1];
  return cleaned;
}

export function getModalAppConfig(): ModalAppConfig {
  const rawAppName = (process.env.MODAL_APP_NAME || DEFAULT_MODAL_APP_NAME).trim();
  // Normalize legacy 'doudou' override to the deployed 'doudouvoice-media-edit' app name
  const appName =
    rawAppName.toLowerCase() === 'doudou' || !rawAppName
      ? DEFAULT_MODAL_APP_NAME
      : rawAppName;

  const rawWorkspace = (process.env.MODAL_WORKSPACE || DEFAULT_MODAL_WORKSPACE).trim();
  // Normalize legacy 'ALL' override to the deployed 'abdelwadoudamirouche7' workspace
  const workspace =
    rawWorkspace.toUpperCase() === 'ALL' || !rawWorkspace
      ? DEFAULT_MODAL_WORKSPACE
      : rawWorkspace;

  const environment = (process.env.MODAL_ENVIRONMENT || DEFAULT_MODAL_ENVIRONMENT).trim();
  const functionName = (process.env.MODAL_FUNCTION_NAME || DEFAULT_MODAL_FUNCTION_NAME).trim();
  const appId = (process.env.MODAL_APP_ID || DEFAULT_MODAL_APP_ID).trim();
  const tokenId = cleanEnvCredential(process.env.MODAL_TOKEN_ID || '');
  const tokenSecret = cleanEnvCredential(process.env.MODAL_TOKEN_SECRET || '');
  const webhookUrl = (process.env.MODAL_WEBHOOK_URL || '').trim();
  const apiKey = (process.env.MODAL_API_KEY || '').trim();
  const rawTimeout = Number(process.env.MODAL_TIMEOUT_MS || 300_000);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 30_000 ? rawTimeout : 300_000;

  const isPlaceholder = (val: string) =>
    !val ||
    val === 'YOUR_MODAL_TOKEN_ID' ||
    val === 'YOUR_MODAL_TOKEN_SECRET' ||
    val.startsWith('YOUR_');

  const hasNonEmptyTokens = !isPlaceholder(tokenId) && !isPlaceholder(tokenSecret);
  const isProxyAuthToken =
    hasNonEmptyTokens &&
    (tokenId.startsWith('wk-') || tokenSecret.startsWith('ws-'));
  const isApiToken =
    hasNonEmptyTokens &&
    !isProxyAuthToken &&
    tokenId.startsWith('ak-') &&
    tokenSecret.startsWith('as-');

  let tokenFormatWarning: string | undefined;
  if (isProxyAuthToken) {
    tokenFormatWarning =
      `Detected Modal Proxy Auth Token (${tokenId.slice(0, 6)}... / ${tokenSecret.slice(0, 6)}...). ` +
      `Proxy Auth Tokens (wk- / ws-) only authenticate HTTP Web Endpoints, whereas Modal's gRPC SDK (AuthTokenGet) ` +
      `requires a Modal API Token starting with "ak-" (MODAL_TOKEN_ID) and "as-" (MODAL_TOKEN_SECRET) from https://modal.com/settings/tokens.`;
  } else if (hasNonEmptyTokens && !isApiToken) {
    tokenFormatWarning =
      `MODAL_TOKEN_ID ("${tokenId.slice(0, 5)}...") does not start with the standard Modal API Token prefix "ak-". ` +
      `Please ensure MODAL_TOKEN_ID starts with "ak-" and MODAL_TOKEN_SECRET starts with "as-".`;
  }

  const hasSdkCredentials = hasNonEmptyTokens && !isProxyAuthToken;
  const hasWebhookCredentials = Boolean(webhookUrl && !isPlaceholder(webhookUrl));

  return {
    appName,
    workspace,
    environment,
    functionName,
    appId,
    tokenId: hasNonEmptyTokens ? tokenId : '',
    tokenSecret: hasNonEmptyTokens ? tokenSecret : '',
    webhookUrl: hasWebhookCredentials ? webhookUrl : '',
    apiKey,
    timeoutMs,
    tokenType: isApiToken ? 'api_token' : isProxyAuthToken ? 'proxy_auth_token' : 'none',
    tokenFormatWarning,
    hasSdkCredentials,
    hasWebhookCredentials,
    isConfigured: hasSdkCredentials || hasWebhookCredentials
  };
}

export const XFADE_TRANSITION_MAP: Record<string, string> = {
  crossfade: 'fade',
  fade: 'fade',
  fadeblack: 'fadeblack',
  wipeleft: 'wipeleft',
  wiperight: 'wiperight',
  slideleft: 'slideleft',
  slideright: 'slideright',
  smoothleft: 'smoothleft',
  smoothright: 'smoothright',
  smoothup: 'smoothup',
  smoothdown: 'smoothdown',
  circleopen: 'circleopen',
  horzopen: 'horzopen',
  dissolve: 'dissolve'
};

export function mapTransitionToXfade(transitionOut?: string): string {
  if (!transitionOut || transitionOut === 'none') return 'fade';
  return XFADE_TRANSITION_MAP[transitionOut] || 'fade';
}

export interface ModalRenderingRequest {
  projectId: string;
  assets: Array<{
    id: string;
    type: 'image' | 'video';
    filePath: string;
    originalName: string;
    mimeType?: string;
    durationSec?: number;
  }>;
  editingPlan: EditingPlan;
  masterVoiceoverPath: string;
  outputFilePath: string;
  onProgress?: (message: string) => void;
  allowLocalFallback?: boolean;
}

export interface VideoStreamValidation {
  valid: boolean;
  codec: string;
  pixFmt: string;
  width: number;
  height: number;
  aspectRatio?: string;
  durationSec: number;
  fps: number;
  nbFrames?: number;
  blackFrameSegments?: number;
  frozenFrameSegments?: number;
  whiteFlashSegments?: number;
  errors: string[];
}

export interface AudioStreamValidation {
  valid: boolean;
  isAudioPresent: boolean;
  codec?: string;
  durationSec?: number;
  sampleRate?: number;
  audioVideoDriftSec?: number;
  errors: string[];
}

export interface FinalMp4ValidationResult {
  valid: boolean;
  renderCompleted: boolean;
  technicalValidationPassed: boolean;
  fileSizeBytes: number;
  formatName: string;
  renderedVia: 'Modal Cloud' | 'Local Server FFmpeg';
  isModalFallback?: boolean;
  hasAudioInputSupplied: boolean;
  videoOnly: boolean;
  video: VideoStreamValidation;
  audio: AudioStreamValidation;
  summary: string;
  errors: string[];
}

export interface ModalRenderingResult {
  success: boolean;
  finalVideoPath: string;
  durationSec: number;
  fileSizeBytes: number;
  renderedVia: 'Modal Cloud' | 'Local Server FFmpeg';
  isModalFallback?: boolean;
  isConfigurationError?: boolean;
  modalAppInfo?: {
    appName: string;
    workspace: string;
    environment: string;
    functionName: string;
    appId: string;
    functionId?: string;
    functionCallId?: string;
  };
  hasAudioInputSupplied: boolean;
  videoOnly: boolean;
  validation: FinalMp4ValidationResult;
  error?: string;
}

async function probeSourceDurationSec(filePath: string, fallbackSec = 4.0): Promise<number> {
  if (!filePath || !fs.existsSync(filePath)) return fallbackSec;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ]);
    const parsed = JSON.parse(stdout);
    const dur = parseFloat(parsed?.format?.duration || '0');
    if (Number.isFinite(dur) && dur > 0) return dur;
  } catch (_) {}
  return fallbackSec;
}

async function detectBlackAndFrozenSegments(filePath: string): Promise<{
  blackSegments: number;
  frozenSegments: number;
  whiteFlashSegments: number;
}> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { blackSegments: 0, frozenSegments: 0, whiteFlashSegments: 0 };
  }
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-v', 'info',
      '-i', filePath,
      '-vf', 'blackdetect=d=0.35:pix_th=0.05,freezedetect=n=0.001:d=2.5',
      '-an',
      '-f', 'null',
      '-'
    ], { timeout: 25000 });
    const blackMatches = (stderr || '').match(/black_start:/g);
    const freezeMatches = (stderr || '').match(/lavfi\.freezedetect\.freeze_start/g);

    let whiteFlashSegments = 0;
    try {
      const { stderr: whiteStderr } = await execFileAsync('ffmpeg', [
        '-v', 'info',
        '-i', filePath,
        '-vf', 'negate,blackdetect=d=0.12:pix_th=0.015',
        '-an',
        '-f', 'null',
        '-'
      ], { timeout: 20000 });
      const whiteMatches = (whiteStderr || '').match(/black_start:/g);
      whiteFlashSegments = whiteMatches ? whiteMatches.length : 0;
    } catch (_) {}

    return {
      blackSegments: blackMatches ? blackMatches.length : 0,
      frozenSegments: freezeMatches ? freezeMatches.length : 0,
      whiteFlashSegments
    };
  } catch (_) {
    return { blackSegments: 0, frozenSegments: 0, whiteFlashSegments: 0 };
  }
}

/**
 * Runs FFprobe + FFmpeg diagnostics to strictly inspect and validate the exported QuickTime MP4 file.
 */
export async function inspectAndValidateMp4(
  filePath: string,
  targetDurationSec: number,
  targetWidth: number,
  targetHeight: number,
  hasAudioInputSupplied: boolean,
  renderedVia: 'Modal Cloud' | 'Local Server FFmpeg',
  isModalFallback = false
): Promise<FinalMp4ValidationResult> {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    const err = 'Exported MP4 file does not exist on disk';
    return {
      valid: false,
      renderCompleted: false,
      technicalValidationPassed: false,
      fileSizeBytes: 0,
      formatName: 'missing',
      renderedVia,
      isModalFallback,
      hasAudioInputSupplied,
      videoOnly: !hasAudioInputSupplied,
      video: { valid: false, codec: 'none', pixFmt: 'none', width: 0, height: 0, durationSec: 0, fps: 0, errors: [err] },
      audio: { valid: !hasAudioInputSupplied, isAudioPresent: false, errors: hasAudioInputSupplied ? ['Audio input supplied but file missing'] : [] },
      summary: 'Exported MP4 file missing',
      errors: [err]
    };
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 5000) {
    errors.push(`Output MP4 file size too small (${stat.size} bytes), likely corrupted`);
  }

  const probeCmd = `ffprobe -v error -count_frames -show_entries format=format_name,duration,size:stream=index,codec_name,codec_type,pix_fmt,width,height,r_frame_rate,nb_read_frames,nb_frames,sample_rate,channels,duration -of json "${filePath}"`;

  let probeData: any = null;
  try {
    const { stdout } = await execAsync(probeCmd);
    probeData = JSON.parse(stdout);
  } catch (err: any) {
    const errorMsg = `FFprobe failed to inspect video file: ${err.message}`;
    errors.push(errorMsg);
    return {
      valid: false,
      renderCompleted: true,
      technicalValidationPassed: false,
      fileSizeBytes: stat.size,
      formatName: 'invalid',
      renderedVia,
      isModalFallback,
      hasAudioInputSupplied,
      videoOnly: !hasAudioInputSupplied,
      video: { valid: false, codec: 'unknown', pixFmt: 'unknown', width: 0, height: 0, durationSec: 0, fps: 0, errors: [errorMsg] },
      audio: { valid: false, isAudioPresent: false, errors: [errorMsg] },
      summary: 'FFprobe inspection failed',
      errors
    };
  }

  const formatName = probeData.format?.format_name || '';
  const totalDurationSec = parseFloat(probeData.format?.duration || '0');

  if (!formatName.includes('mp4') && !formatName.includes('mov') && !formatName.includes('isom')) {
    errors.push(`Container format "${formatName}" is not QuickTime/MP4 compatible`);
  }

  // 1. Inspect Video Stream
  const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
  const videoErrors: string[] = [];
  let videoValid = true;

  let videoCodec = 'none';
  let pixFmt = 'none';
  let width = 0;
  let height = 0;
  let fps = 0;
  let nbFrames = 0;
  let computedAspectRatio = 'unknown';

  if (!videoStream) {
    videoValid = false;
    videoErrors.push('No video stream found in exported file');
  } else {
    videoCodec = videoStream.codec_name || 'unknown';
    pixFmt = videoStream.pix_fmt || 'unknown';
    width = videoStream.width || 0;
    height = videoStream.height || 0;
    nbFrames = parseInt(videoStream.nb_read_frames || videoStream.nb_frames || '0', 10);

    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (Math.abs(ratio - 9 / 16) < 0.05) computedAspectRatio = '9:16';
      else if (Math.abs(ratio - 16 / 9) < 0.05) computedAspectRatio = '16:9';
      else if (Math.abs(ratio - 1.0) < 0.05) computedAspectRatio = '1:1';
      else computedAspectRatio = `${width}:${height}`;
    }

    if (videoStream.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      if (parts.length === 2 && parseInt(parts[1], 10) > 0) {
        fps = Math.round(parseInt(parts[0], 10) / parseInt(parts[1], 10));
      }
    }

    if (videoCodec !== 'h264') {
      videoValid = false;
      videoErrors.push(`Video codec "${videoCodec}" is not H.264 (libx264 required for QuickTime)`);
    }

    if (pixFmt !== 'yuv420p') {
      videoValid = false;
      videoErrors.push(`Pixel format "${pixFmt}" is not yuv420p (required for QuickTime compatibility)`);
    }

    if (Math.abs(width - targetWidth) > 4 || Math.abs(height - targetHeight) > 4) {
      videoValid = false;
      videoErrors.push(`Video resolution ${width}x${height} differs from target ${targetWidth}x${targetHeight}`);
    }

    if (Math.abs(totalDurationSec - targetDurationSec) > 0.6) {
      videoValid = false;
      videoErrors.push(`Video duration ${totalDurationSec.toFixed(2)}s does not match selected target duration ${targetDurationSec.toFixed(1)}s (tolerance ±0.5s)`);
    }
  }

  // Run black-frame, frozen-frame, and white-flash detection pass
  const { blackSegments, frozenSegments, whiteFlashSegments } = await detectBlackAndFrozenSegments(filePath);
  if (blackSegments > 1) {
    videoValid = false;
    videoErrors.push(`Detected ${blackSegments} unexpected black-frame intervals (>0.35s) in rendered output`);
  }
  if (whiteFlashSegments > 0) {
    videoValid = false;
    videoErrors.push(`Detected ${whiteFlashSegments} unexpected white-flash transition artifact(s) (>0.12s) in rendered output`);
  }

  // 2. Inspect Audio Stream & A/V Sync
  const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');
  const audioErrors: string[] = [];
  let audioValid = true;
  const isAudioPresent = !!audioStream;
  const audioStreamDur = parseFloat(audioStream?.duration || probeData.format?.duration || '0');
  const audioVideoDriftSec = isAudioPresent ? Number(Math.abs(totalDurationSec - audioStreamDur).toFixed(3)) : 0;

  if (hasAudioInputSupplied) {
    if (!audioStream) {
      audioValid = false;
      audioErrors.push('Audio input was supplied but no audio stream exists in final MP4 export');
    } else {
      const audioCodec = audioStream.codec_name || '';
      if (audioCodec !== 'aac') {
        audioValid = false;
        audioErrors.push(`Audio codec "${audioCodec}" is not AAC (AAC required for QuickTime)`);
      }
      if (audioVideoDriftSec > 0.75) {
        audioValid = false;
        audioErrors.push(`Audio/video stream duration drift (${audioVideoDriftSec.toFixed(2)}s) exceeds 0.75s sync threshold`);
      }
    }
  } else {
    audioValid = true;
  }

  const allErrors = [...errors, ...videoErrors, ...audioErrors];
  const isValid = videoValid && audioValid && errors.length === 0;

  const summary = isValid
    ? `FFprobe Validation Passed: QuickTime H.264/AAC MP4 (${width}x${height} [${computedAspectRatio}], ${totalDurationSec.toFixed(2)}s, ${nbFrames} frames @ ${fps}fps, ${hasAudioInputSupplied ? `Audio: AAC (drift ${audioVideoDriftSec.toFixed(2)}s)` : 'Video-Only Export'})`
    : `FFprobe Validation Failed: ${allErrors.join(' | ')}`;

  return {
    valid: isValid,
    renderCompleted: true,
    technicalValidationPassed: isValid,
    fileSizeBytes: stat.size,
    formatName,
    renderedVia,
    isModalFallback,
    hasAudioInputSupplied,
    videoOnly: !hasAudioInputSupplied,
    video: {
      valid: videoValid,
      codec: videoCodec,
      pixFmt,
      width,
      height,
      aspectRatio: computedAspectRatio,
      durationSec: totalDurationSec,
      fps,
      nbFrames,
      blackFrameSegments: blackSegments,
      frozenFrameSegments: frozenSegments,
      whiteFlashSegments,
      errors: videoErrors
    },
    audio: {
      valid: audioValid,
      isAudioPresent,
      codec: audioStream?.codec_name,
      durationSec: audioStreamDur,
      sampleRate: parseInt(audioStream?.sample_rate || '0', 10),
      audioVideoDriftSec,
      errors: audioErrors
    },
    summary,
    errors: allErrors
  };
}

/**
 * Sends execution payload to Modal Cloud worker endpoint if MODAL_WEBHOOK_URL is configured.
 */
async function callModalCloudApi(
  webhookUrl: string,
  apiKey: string,
  payload: ModalRenderingRequest
): Promise<ModalRenderingResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

  const hasAudioInput = fs.existsSync(payload.masterVoiceoverPath) && fs.statSync(payload.masterVoiceoverPath).size > 100;

  try {
    console.log(`[Modal Cloud Audit] Project ${payload.projectId}: Sending request to ${webhookUrl}...`);
    console.log(`- Received Assets: ${payload.assets.length} (${payload.assets.map(a => `${a.id}:${a.type}`).join(', ')})`);
    console.log(`- Audio Input Supplied: ${hasAudioInput ? `YES (${fs.statSync(payload.masterVoiceoverPath).size} bytes)` : 'NO (Video-Only Export)'}`);

    const assetsData = payload.assets.map(asset => ({
      id: asset.id,
      type: asset.type,
      originalName: asset.originalName,
      base64: fs.existsSync(asset.filePath) ? fs.readFileSync(asset.filePath).toString('base64') : ''
    }));

    const voiceoverBase64 = hasAudioInput ? fs.readFileSync(payload.masterVoiceoverPath).toString('base64') : '';

    const cfg = getModalAppConfig();
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
    }
    if (cfg.tokenId && cfg.tokenSecret) {
      reqHeaders['Modal-Key'] = cfg.tokenId;
      reqHeaders['Modal-Secret'] = cfg.tokenSecret;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        projectId: payload.projectId,
        editingPlan: payload.editingPlan,
        assets: assetsData,
        masterVoiceoverBase64: voiceoverBase64,
        hasAudioInput
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`[Modal Cloud Error] Endpoint returned HTTP ${res.status}: ${await res.text()}`);
      return null;
    }

    const data: any = await res.json();
    if (data && data.videoBase64) {
      const videoBuffer = Buffer.from(data.videoBase64, 'base64');
      fs.writeFileSync(payload.outputFilePath, videoBuffer);

      const targetWidth = Math.floor((payload.editingPlan.resolution.width || 1080) / 2) * 2;
      const targetHeight = Math.floor((payload.editingPlan.resolution.height || 1920) / 2) * 2;
      const targetDurationSec = payload.editingPlan.totalDurationSec || 15;

      const validation = await inspectAndValidateMp4(
        payload.outputFilePath,
        targetDurationSec,
        targetWidth,
        targetHeight,
        hasAudioInput,
        'Modal Cloud',
        false
      );

      console.log(`[Modal Cloud Success] ${validation.summary}`);

      return {
        success: validation.valid,
        finalVideoPath: payload.outputFilePath,
        durationSec: validation.video.durationSec,
        fileSizeBytes: videoBuffer.length,
        renderedVia: 'Modal Cloud',
        isModalFallback: false,
        hasAudioInputSupplied: hasAudioInput,
        videoOnly: !hasAudioInput,
        validation,
        error: validation.valid ? undefined : validation.errors.join(' | ')
      };
    }
  } catch (err: any) {
    console.warn(`[Modal Cloud Error] Call failed (${err.message}). Falling back to Local Server FFmpeg execution.`);
  } finally {
    clearTimeout(timer);
  }

  return null;
}

export function getColorFilter(colorGrading?: string): string {
  // Brightness is clamped <= 0.0 so full-range JPEGs and xfade overlaps never clip highlights into white flashes
  if (colorGrading === 'warm_luxury') {
    return 'eq=contrast=1.05:saturation=1.08:brightness=0.0,colorbalance=rs=0.04:gs=0.01:bs=-0.03';
  }
  if (colorGrading === 'cool_tech') {
    return 'eq=contrast=1.07:saturation=1.09:brightness=-0.01,colorbalance=rs=-0.03:gs=0.01:bs=0.04';
  }
  if (colorGrading === 'cinematic') {
    return 'eq=contrast=1.08:saturation=1.05:brightness=-0.01';
  }
  if (colorGrading === 'clean_natural') {
    return 'eq=contrast=1.03:saturation=1.05:brightness=0.0';
  }
  return 'eq=contrast=1.05:saturation=1.10:brightness=0.0';
}

/**
 * Computes content-aware normalized focal center (cx, cy) and FFmpeg crop expression
 * from samFocusBox [ymin, xmin, ymax, xmax] (0-1000 scale).
 * Defaults to (0.5, 0.38) upper-third bias when no bounding box is supplied so heads/faces
 * and upper-body subjects are preserved instead of decapitated by blind center cropping.
 */
export function computeContentAwareCropCoords(
  samFocusBox?: [number, number, number, number],
  cropWidthExpr = '1080',
  cropHeightExpr = '1920'
): { cx: number; cy: number; cropFilter: string } {
  let cx = 0.5;
  let cy = 0.38;
  if (samFocusBox && Array.isArray(samFocusBox) && samFocusBox.length === 4) {
    const rawCx = ((Number(samFocusBox[1]) + Number(samFocusBox[3])) / 2) / 1000;
    const rawCy = ((Number(samFocusBox[0]) + Number(samFocusBox[2])) / 2) / 1000;
    if (Number.isFinite(rawCx)) cx = Math.max(0.15, Math.min(0.85, rawCx));
    if (Number.isFinite(rawCy)) cy = Math.max(0.15, Math.min(0.85, rawCy));
  }
  const cropFilter = `crop=${cropWidthExpr}:${cropHeightExpr}:'(iw-ow)*${cx.toFixed(3)}':'(ih-oh)*${cy.toFixed(3)}'`;
  return { cx, cy, cropFilter };
}

/**
 * Local FFmpeg Filtergraph Execution Engine (P0):
 * - Canonical 30 FPS stream normalization (fps=30, settb=1/30, setpts=N, setsar=1, format=yuv420p)
 * - Mixed xfade transitions and 0-frame concat hard cuts (transitionOut === 'none')
 * - 3-Tier Short Video Policy with MAX_SLOWDOWN_FACTOR = 1.25 (Tier 3 Part A + Part B Ken Burns + xfade exact frame count)
 * - Shaped RTL Arabic .ass subtitles and animated title/badge/CTA overlays burned via libass (shaping=complex)
 * - Zero tpad=stop_mode=clone frozen frames
 */
export async function executeLocalFfmpegPipeline(
  payload: ModalRenderingRequest,
  isModalFallback = false
): Promise<ModalRenderingResult> {
  const { assets, editingPlan, masterVoiceoverPath, outputFilePath } = payload;

  const rawWidth = editingPlan.resolution.width || 1080;
  const rawHeight = editingPlan.resolution.height || 1920;
  const targetWidth = Math.floor(rawWidth / 2) * 2;
  const targetHeight = Math.floor(rawHeight / 2) * 2;

  const projectDir = path.dirname(outputFilePath);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const N = editingPlan.scenes.length;
  const requestedTotalFrames =
    editingPlan.totalFrames || Math.max(N * 30, Math.round((editingPlan.totalDurationSec || 15) * 30));

  // Compute deterministic 30-FPS frame schedule across all N scenes
  const nominalFrames: number[] = [];
  let runningNominalSum = 0;
  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    if (typeof sc.nominalFrames === 'number' && sc.nominalFrames > 0) {
      nominalFrames.push(Math.round(sc.nominalFrames));
      runningNominalSum += Math.round(sc.nominalFrames);
    } else if (i < N - 1) {
      const k = Math.max(15, Math.round((sc.durationSec || 3) * 30));
      nominalFrames.push(k);
      runningNominalSum += k;
    } else {
      const kLast = Math.max(15, requestedTotalFrames - runningNominalSum);
      nominalFrames.push(kLast);
      runningNominalSum += kLast;
    }
  }

  const totalFrames = runningNominalSum;
  const targetDurationSec = Number((totalFrames / 30).toFixed(6));

  const transitionFrames: number[] = [];
  const preparedFrames: number[] = [];
  const offsetFrames: number[] = [];
  let cumulativeNominal = 0;

  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    const isLast = i === N - 1;
    const K_i = nominalFrames[i];
    const K_next = isLast ? 0 : nominalFrames[i + 1];

    const M_i =
      isLast || sc.transitionOut === 'none'
        ? 0
        : typeof sc.transitionFrames === 'number'
        ? Math.max(0, Math.min(sc.transitionFrames, Math.floor(0.25 * Math.min(K_i, K_next))))
        : Math.min(10, Math.floor(0.25 * Math.min(K_i, K_next)));

    const K_prime_i = K_i + M_i;
    transitionFrames.push(M_i);
    preparedFrames.push(K_prime_i);
    offsetFrames.push(cumulativeNominal + K_i);

    sc.nominalFrames = K_i;
    sc.durationSec = Number((K_i / 30).toFixed(6));
    sc.timelineStartTimeSec = Number((cumulativeNominal / 30).toFixed(6));
    sc.transitionOut = isLast ? 'none' : sc.transitionOut;
    sc.transitionFrames = M_i;
    sc.transitionDurationSec = Number((M_i / 30).toFixed(6));
    sc.preparedClipFrames = K_prime_i;
    sc.preparedClipDurationSec = Number((K_prime_i / 30).toFixed(6));
    sc.xfadeOffsetSec = Number(((cumulativeNominal + K_i) / 30).toFixed(6));

    cumulativeNominal += K_i;
  }

  editingPlan.totalFrames = totalFrames;
  editingPlan.totalDurationSec = targetDurationSec;

  const hasAudioInput =
    Boolean(masterVoiceoverPath) &&
    fs.existsSync(masterVoiceoverPath) &&
    fs.statSync(masterVoiceoverPath).size > 100;

  console.log(`[Local FFmpeg Engine] Project ${payload.projectId} Execution Audit:`);
  console.log(`- Render Mode: ${isModalFallback ? 'Local Server FFmpeg (Fallback from Modal)' : 'Local Server FFmpeg (Direct)'}`);
  console.log(`- Target Dimensions: ${targetWidth}x${targetHeight} (${editingPlan.aspectRatio})`);
  console.log(`- Target Duration: ${targetDurationSec.toFixed(3)}s (${totalFrames} frames @ 30fps)`);
  console.log(`- Received Assets: ${assets.length} (${assets.map(a => `${a.id}:${a.type}`).join(', ')})`);
  console.log(`- Audio Input Supplied: ${hasAudioInput ? `YES (${fs.statSync(masterVoiceoverPath).size} bytes)` : 'NO (Exporting Video-Only MP4)'}`);

  const preparedClips: string[] = [];

  // Step 1: Prepare individual processed scene clips with exact K'_i frames at 30 FPS
  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    const asset = assets.find(a => a.id === sc.assetId) || assets[i % assets.length];
    const clipOutPath = path.join(projectDir, `prepared_scene_${i + 1}.mp4`);
    const K_prime_i = preparedFrames[i];
    const D_prime_i = K_prime_i / 30;
    const colorFilter = getColorFilter(sc.colorGrading);

    const { cx, cy, cropFilter: crop2x } = computeContentAwareCropCoords(
      sc.samFocusBox,
      `${targetWidth}*2`,
      `${targetHeight}*2`
    );
    const { cropFilter: crop1x } = computeContentAwareCropCoords(
      sc.samFocusBox,
      `${targetWidth}`,
      `${targetHeight}`
    );

    if (asset.type === 'image') {
      if (sc.effect === 'pip_detail_spotlight') {
        // Picture-in-Picture Commercial Detail Spotlight:
        // Main frame shows medium product composition with subtle horizontal tracking,
        // while a crisp bordered detail inset highlights product texture/logo in the top-right safe zone.
        const pipW = Math.max(160, Math.floor((targetWidth * 0.34) / 2) * 2);
        const pipH = Math.max(160, Math.floor((targetHeight * 0.28) / 2) * 2);
        const startX = Math.max(0.34, cx - 0.08);
        const mainXExpr = `'iw*(${startX.toFixed(3)}+0.14*on/${K_prime_i})-(iw/zoom/2)'`;
        const mainYExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;
        const pipXExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        const pipYExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

        const filterComplex =
          `[0:v]scale=${targetWidth}*2:${targetHeight}*2:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,${crop2x},split=2[base_src][pip_src];` +
          `[base_src]zoompan=z='1.08':x=${mainXExpr}:y=${mainYExpr}:d=${K_prime_i}:s=${targetWidth}x${targetHeight}:fps=30,setsar=1[main_v];` +
          `[pip_src]zoompan=z='1.38+0.06*on/${K_prime_i}':x=${pipXExpr}:y=${pipYExpr}:d=${K_prime_i}:s=${pipW}x${pipH}:fps=30,setsar=1,pad=w=${pipW}+8:h=${pipH}+8:x=4:y=4:color=white@0.92[pip_v];` +
          `[main_v][pip_v]overlay=x=W-w-44:y=56:shortest=1,${colorFilter},format=yuv420p,settb=1/30,setpts=N[vout]`;

        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-i', asset.filePath,
          '-filter_complex', filterComplex,
          '-map', '[vout]',
          '-frames:v', String(K_prime_i),
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-colorspace', 'bt709',
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-r', '30',
          clipOutPath
        ]);
      } else {
        let zoomExpr = `1.0+0.12*on/${K_prime_i}`;
        let xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        let yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

        if (sc.effect === 'slow_zoom_out') {
          zoomExpr = `1.14-0.14*on/${K_prime_i}`;
        } else if (sc.effect === 'pull_back_reveal') {
          // Starts tightly framed on the product detail and pulls back smoothly to reveal the full hero shot
          zoomExpr = `1.24-0.22*on/${K_prime_i}`;
        } else if (sc.effect === 'pan_left') {
          zoomExpr = '1.12';
          const startX = Math.min(0.68, cx + 0.10);
          xExpr = `'iw*(${startX.toFixed(3)}-0.20*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'pan_right') {
          zoomExpr = '1.12';
          const startX = Math.max(0.32, cx - 0.10);
          xExpr = `'iw*(${startX.toFixed(3)}+0.20*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'track_horizontal') {
          // Smooth lateral slider motion across the product without linear zoom distortion
          zoomExpr = '1.14';
          const dir = i % 2 === 0 ? 1 : -1;
          const startX = Math.max(0.30, Math.min(0.70, cx - dir * 0.11));
          const deltaX = (dir * 0.22).toFixed(3);
          xExpr = `'iw*(${startX.toFixed(3)}+${deltaX}*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'track_vertical') {
          // Smooth vertical pedestal/tilt tracking across tall products or apparel
          zoomExpr = '1.16';
          const dir = i % 2 === 0 ? -1 : 1;
          const startY = Math.max(0.30, Math.min(0.70, cy - dir * 0.10));
          const deltaY = (dir * 0.20).toFixed(3);
          yExpr = `'ih*(${startY.toFixed(3)}+${deltaY}*on/${K_prime_i})-(ih/zoom/2)'`;
        } else if (sc.effect === 'detail_closeup') {
          // Macro detail framing centered on the product focus box
          zoomExpr = `1.24+0.06*on/${K_prime_i}`;
        } else if (sc.effect === 'handheld_stabilized') {
          // Organic stabilized cinema drift without zoom-in repetition
          zoomExpr = '1.08';
          xExpr = `'iw*(${cx.toFixed(3)}+0.018*sin(on/12))-(iw/zoom/2)'`;
          yExpr = `'ih*(${cy.toFixed(3)}+0.015*cos(on/15))-(ih/zoom/2)'`;
        } else if (sc.effect === 'smart_subject_focus') {
          zoomExpr = `1.0+0.14*on/${K_prime_i}`;
        } else if (sc.effect === 'static') {
          zoomExpr = '1.0';
        }

        const filterGraph =
          `scale=${targetWidth}*2:${targetHeight}*2:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,` +
          `${crop2x},` +
          `zoompan=z='${zoomExpr}':x=${xExpr}:y=${yExpr}:d=${K_prime_i}:s=${targetWidth}x${targetHeight}:fps=30,` +
          `setsar=1,${colorFilter},format=yuv420p,settb=1/30,setpts=N`;

        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-i', asset.filePath,
          '-vf', filterGraph,
          '-frames:v', String(K_prime_i),
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-colorspace', 'bt709',
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-r', '30',
          clipOutPath
        ]);
      }

      console.log(`[FFmpeg] Prepared Image Scene ${i + 1}/${N} (${K_prime_i} frames, effect=${sc.effect}, role=${sc.sceneRole || 'n/a'}, shot=${sc.shotType || 'n/a'}, focus=(${cx.toFixed(2)},${cy.toFixed(2)}), out=${sc.transitionOut})...`);
      preparedClips.push(clipOutPath);
    } else {
      // Video Scene: Enforce 3-Tier Policy with MAX_SLOWDOWN_FACTOR = 1.25
      const probedSrcDur = await probeSourceDurationSec(asset.filePath, asset.durationSec || 4.0);
      const srcDur = Math.max(0.2, probedSrcDur);
      const slowdownRequired = D_prime_i / srcDur;

      if (slowdownRequired <= 1.0001) {
        // Tier 1: Real-time 1.0x speed with content-aware crop
        const startTime = Math.max(0, Math.min(sc.startTimeSec || 0, Math.max(0, srcDur - D_prime_i)));
        const filterGraph =
          `fps=30,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,` +
          `${crop1x},setsar=1,${colorFilter},format=yuv420p,settb=1/30,setpts=N`;

        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-ss', startTime.toFixed(3),
          '-i', asset.filePath,
          '-vf', filterGraph,
          '-frames:v', String(K_prime_i),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-colorspace', 'bt709',
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-r', '30',
          clipOutPath
        ]);
        console.log(`[FFmpeg] Prepared Video Scene ${i + 1}/${N} via Tier 1 (1.0x real-time, ${K_prime_i} frames)...`);
      } else if (slowdownRequired <= MAX_SLOWDOWN_FACTOR) {
        // Tier 2: Controlled PTS slow motion within MAX_SLOWDOWN_FACTOR (<= 1.25x) with content-aware crop
        const filterGraph =
          `setpts=${slowdownRequired.toFixed(6)}*PTS,fps=30,` +
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,` +
          `${crop1x},setsar=1,${colorFilter},format=yuv420p,settb=1/30,setpts=N`;

        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-i', asset.filePath,
          '-vf', filterGraph,
          '-frames:v', String(K_prime_i),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-colorspace', 'bt709',
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-r', '30',
          clipOutPath
        ]);
        console.log(`[FFmpeg] Prepared Video Scene ${i + 1}/${N} via Tier 2 (slowdown=${slowdownRequired.toFixed(2)}x <= ${MAX_SLOWDOWN_FACTOR}x, ${K_prime_i} frames)...`);
      } else {
        // Tier 3: Source clip is too short for 1.25x slow motion.
        // Split into Part A (moving video at 1.25x max slowdown, K_A frames) +
        // Part B (Ken Burns zoompan motion on extracted keyframe, K_B frames)
        // joined by an internal xfade of M_split frames such that K_A + K_B - M_split === K'_i!
        const maxPartAFrames = Math.max(15, Math.floor(MAX_SLOWDOWN_FACTOR * srcDur * 30));
        const K_A = Math.max(15, Math.min(K_prime_i - 15, maxPartAFrames));
        const M_split = Math.min(10, Math.floor(0.25 * Math.min(K_A, K_prime_i - K_A + 10)));
        const K_B = K_prime_i - K_A + M_split;
        const offsetSplitSec = (K_A - M_split) / 30;
        const durSplitSec = M_split / 30;
        const alphaA = Math.min(MAX_SLOWDOWN_FACTOR, Math.max(1.0, (K_A / 30) / srcDur));

        const extractedFramePath = path.join(projectDir, `tier3_keyframe_${i + 1}.png`);
        const extractTime = Math.max(0, srcDur - 0.12);
        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-ss', extractTime.toFixed(3),
          '-i', asset.filePath,
          '-vf', `scale=${targetWidth}*2:${targetHeight}*2:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,${crop2x}`,
          '-frames:v', '1',
          extractedFramePath
        ]);

        const zoomExpr = `1.0+0.15*on/${K_B}`;
        const xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        const yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

        const tier3FilterComplex = [
          `[0:v]setpts=${alphaA.toFixed(6)}*PTS,fps=30,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,${crop1x},setsar=1,${colorFilter},format=yuv420p,trim=end_frame=${K_A},settb=1/30,setpts=N[partA]`,
          `[1:v]zoompan=z='${zoomExpr}':x=${xExpr}:y=${yExpr}:d=${K_B}:s=${targetWidth}x${targetHeight}:fps=30,setsar=1,${colorFilter},format=yuv420p,trim=end_frame=${K_B},settb=1/30,setpts=N[partB]`,
          `[partA][partB]xfade=transition=fade:duration=${durSplitSec.toFixed(6)}:offset=${offsetSplitSec.toFixed(6)},settb=1/30,setpts=N,setsar=1,format=yuv420p[vclip]`
        ].join(';');

        await execFileAsync('ffmpeg', [
          '-y',
          '-v', 'error',
          '-i', asset.filePath,
          '-i', extractedFramePath,
          '-filter_complex', tier3FilterComplex,
          '-map', '[vclip]',
          '-frames:v', String(K_prime_i),
          '-an',
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '20',
          '-profile:v', 'main',
          '-level', '4.0',
          '-pix_fmt', 'yuv420p',
          '-colorspace', 'bt709',
          '-color_primaries', 'bt709',
          '-color_trc', 'bt709',
          '-r', '30',
          clipOutPath
        ]);

        console.log(
          `[FFmpeg] Prepared Video Scene ${i + 1}/${N} via Tier 3 (PartA=${K_A}f @ ${alphaA.toFixed(2)}x + PartB=${K_B}f KenBurns - M_split=${M_split}f = ${K_prime_i}f)...`
        );
      }

      preparedClips.push(clipOutPath);
    }
  }

  // Step 2: Generate Unified RTL Arabic .ass File & Combine All Clips via Canonical 30 FPS Mixed xfade / concat
  const subtitleCues: AssSubtitleCue[] = (editingPlan.subtitles || []).map(sub => ({
    startTimeSec: sub.startTimeSec,
    endTimeSec: sub.endTimeSec,
    text: sub.text
  }));

  const overlayCues: AssOverlayCue[] = [];
  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    if (sc.overlayText && sc.overlayText.trim().length > 0) {
      const startSec =
        typeof sc.overlayTextStartTimeSec === 'number'
          ? sc.overlayTextStartTimeSec
          : sc.timelineStartTimeSec + 0.25;
      const durSec =
        typeof sc.overlayTextDurationSec === 'number'
          ? sc.overlayTextDurationSec
          : Math.max(1.0, Math.min(3.5, sc.durationSec - 0.5));
      const endSec = Math.min(sc.timelineStartTimeSec + sc.durationSec - 0.05, startSec + durSec);
      if (endSec > startSec + 0.15) {
        overlayCues.push({
          startTimeSec: startSec,
          endTimeSec: endSec,
          text: sc.overlayText.trim(),
          style: sc.overlayStyle || (i === 0 ? 'title' : i === N - 1 ? 'cta_pill' : 'badge')
        });
      }
    }
  }

  const assFilePath = path.join(projectDir, 'captions_and_titles.ass');
  writeCreatorAssFile(assFilePath, {
    width: targetWidth,
    height: targetHeight,
    aspectRatio: editingPlan.aspectRatio,
    subtitles: subtitleCues,
    overlays: overlayCues
  });
  editingPlan.assSubtitlePath = assFilePath;

  const hasAssEvents = subtitleCues.length > 0 || overlayCues.length > 0;
  const combineInputs: string[] = [];
  const filterGraphParts: string[] = [];

  for (let i = 0; i < N; i++) {
    combineInputs.push('-i', preparedClips[i]);
    const K_prime_i = preparedFrames[i];
    filterGraphParts.push(
      `[${i}:v]fps=30,scale=${targetWidth}:${targetHeight},setsar=1,format=yuv420p,trim=end_frame=${K_prime_i},settb=1/30,setpts=N[v${i}]`
    );
  }

  let currentLabel = '[v0]';
  for (let i = 0; i < N - 1; i++) {
    const M_i = transitionFrames[i];
    const nextInput = `[v${i + 1}]`;
    const outLabel = `[acc${i + 1}]`;

    if (M_i > 0 && editingPlan.scenes[i].transitionOut !== 'none') {
      const mappedTransition = mapTransitionToXfade(editingPlan.scenes[i].transitionOut);
      const durSec = M_i / 30;
      const offsetSec = offsetFrames[i] / 30;
      filterGraphParts.push(
        `${currentLabel}${nextInput}xfade=transition=${mappedTransition}:duration=${durSec.toFixed(6)}:offset=${offsetSec.toFixed(6)},settb=1/30,setpts=N,setsar=1,format=yuv420p${outLabel}`
      );
    } else {
      // True 0-frame hard cut via concat
      filterGraphParts.push(
        `${currentLabel}${nextInput}concat=n=2:v=1:a=0,settb=1/30,setpts=N,setsar=1,format=yuv420p${outLabel}`
      );
    }

    currentLabel = outLabel;
  }

  if (hasAssEvents) {
    const escapedAss = escapeFfmpegFilterPath(assFilePath);
    filterGraphParts.push(
      `${currentLabel}ass=filename='${escapedAss}':shaping=complex,settb=1/30,setpts=N,setsar=1,format=yuv420p[vfinal]`
    );
    currentLabel = '[vfinal]';
  }

  const masteredVideoPath = path.join(projectDir, 'mastered_video.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    ...combineInputs,
    '-filter_complex', filterGraphParts.join(';'),
    '-map', currentLabel,
    '-frames:v', String(totalFrames),
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-maxrate', '12M',
    '-bufsize', '24M',
    '-profile:v', 'high',
    '-level:v', '4.1',
    '-pix_fmt', 'yuv420p',
    '-tag:v', 'avc1',
    '-video_track_timescale', '30000',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    masteredVideoPath
  ]);

  // Step 3: Composite Synchronized Audio Track into Final QuickTime H.264/AAC MP4
  if (hasAudioInput) {
    console.log(
      `[FFmpeg] Compositing synchronized voiceover audio track into QuickTime H.264/AAC MP4 (${targetDurationSec.toFixed(3)}s)...`
    );
    await execFileAsync('ffmpeg', [
      '-y',
      '-v', 'error',
      '-i', masteredVideoPath,
      '-i', masterVoiceoverPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-tag:v', 'avc1',
      '-video_track_timescale', '30000',
      '-filter:a', `volume=1.35,alimiter=limit=0.95:level=false,apad=whole_dur=${targetDurationSec.toFixed(3)}`,
      '-t', targetDurationSec.toFixed(6),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputFilePath
    ]);
  } else {
    console.log(`[FFmpeg] No audio input supplied. Exporting QuickTime-compatible video-only MP4 (-an)...`);
    await execFileAsync('ffmpeg', [
      '-y',
      '-v', 'error',
      '-i', masteredVideoPath,
      '-map', '0:v:0',
      '-c:v', 'copy',
      '-tag:v', 'avc1',
      '-video_track_timescale', '30000',
      '-an',
      '-movflags', '+faststart',
      outputFilePath
    ]);
  }

  try {
    fs.writeFileSync(`${outputFilePath}.qt_mac_ready`, String(Date.now()));
  } catch (_) {}

  // Step 4: Strict FFprobe Output Validation
  const validation = await inspectAndValidateMp4(
    outputFilePath,
    targetDurationSec,
    targetWidth,
    targetHeight,
    hasAudioInput,
    'Local Server FFmpeg',
    isModalFallback
  );

  console.log(`[FFprobe Validation Result] ${validation.summary}`);

  return {
    success: validation.valid,
    finalVideoPath: outputFilePath,
    durationSec: validation.video.durationSec,
    fileSizeBytes: validation.fileSizeBytes,
    renderedVia: 'Local Server FFmpeg',
    isModalFallback,
    hasAudioInputSupplied: hasAudioInput,
    videoOnly: !hasAudioInput,
    validation,
    error: validation.valid ? undefined : validation.errors.join(' | ')
  };
}

const qtConversionLocks = new Map<string, Promise<void>>();

/**
 * Ensures an existing MP4 file on disk is 100% compatible with macOS QuickTime Player, Finder QuickLook, and iOS.
 * Re-encodes/normalizes once with avc1 FourCC, yuv420p, 30000 timescale, High@L4.1 VBV limits, AAC-LC 48kHz, and +faststart.
 */
export async function ensureQuickTimeCompatibleMp4(videoPath: string): Promise<void> {
  if (!fs.existsSync(videoPath)) return;
  const markerPath = `${videoPath}.qt_mac_ready`;
  if (fs.existsSync(markerPath)) return;

  const existingLock = qtConversionLocks.get(videoPath);
  if (existingLock) {
    await existingLock;
    return;
  }

  const task = (async () => {
    const tempOutPath = `${videoPath}.qt_tmp.mp4`;
    try {
      console.log(`[QuickTime Normalizer] Normalizing ${videoPath} for macOS QuickTime compatibility...`);
      await execFileAsync('ffmpeg', [
        '-y',
        '-v', 'error',
        '-i', videoPath,
        '-vf', 'fps=30,format=yuv420p,setsar=1',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '21',
        '-maxrate', '12M',
        '-bufsize', '24M',
        '-profile:v', 'high',
        '-level:v', '4.1',
        '-pix_fmt', 'yuv420p',
        '-tag:v', 'avc1',
        '-video_track_timescale', '30000',
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        tempOutPath
      ]);

      if (fs.existsSync(tempOutPath) && fs.statSync(tempOutPath).size > 50_000) {
        fs.renameSync(tempOutPath, videoPath);
        fs.writeFileSync(markerPath, String(Date.now()));
        console.log(`[QuickTime Normalizer] Successfully normalized ${videoPath} (${fs.statSync(videoPath).size} bytes).`);
      }
    } catch (err: any) {
      console.warn(`[QuickTime Normalizer] Warning normalizing ${videoPath}:`, err?.message || err);
      try {
        if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
      } catch (_) {}
    } finally {
      qtConversionLocks.delete(videoPath);
    }
  })();

  qtConversionLocks.set(videoPath, task);
  await task;
}

/**
 * Computes the deterministic 30-FPS frame schedule, writes the RTL Arabic/Latin .ass file,
 * and builds the unified multi-scene FFmpeg filtergraph and CLI argument list for Modal execution.
 */
async function prepareModalTimelineAndFfmpegSpec(payload: ModalRenderingRequest): Promise<{
  targetWidth: number;
  targetHeight: number;
  totalFrames: number;
  targetDurationSec: number;
  hasAudioInput: boolean;
  assFilePath: string;
  assContent: string;
  assBytes: Uint8Array;
  voiceoverBytes: Uint8Array;
  assetsPayload: Array<{
    id: string;
    index: number;
    filename: string;
    type: 'image' | 'video';
    originalName: string;
    mimeType: string;
    durationSec: number;
    bytes: Uint8Array;
  }>;
  filesMap: Record<string, Uint8Array>;
  filterComplex: string;
  ffmpegArgs: string[];
}> {
  const { assets, editingPlan, masterVoiceoverPath, outputFilePath } = payload;

  const rawWidth = editingPlan.resolution?.width || 1080;
  const rawHeight = editingPlan.resolution?.height || 1920;
  const targetWidth = Math.floor(rawWidth / 2) * 2;
  const targetHeight = Math.floor(rawHeight / 2) * 2;

  const projectDir = path.dirname(outputFilePath);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const N = editingPlan.scenes.length;
  const requestedTotalFrames =
    editingPlan.totalFrames || Math.max(N * 30, Math.round((editingPlan.totalDurationSec || 15) * 30));

  const nominalFrames: number[] = [];
  let runningNominalSum = 0;
  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    if (typeof sc.nominalFrames === 'number' && sc.nominalFrames > 0) {
      nominalFrames.push(Math.round(sc.nominalFrames));
      runningNominalSum += Math.round(sc.nominalFrames);
    } else if (i < N - 1) {
      const k = Math.max(15, Math.round((sc.durationSec || 3) * 30));
      nominalFrames.push(k);
      runningNominalSum += k;
    } else {
      const kLast = Math.max(15, requestedTotalFrames - runningNominalSum);
      nominalFrames.push(kLast);
      runningNominalSum += kLast;
    }
  }

  const totalFrames = runningNominalSum;
  const targetDurationSec = Number((totalFrames / 30).toFixed(6));

  const transitionFrames: number[] = [];
  const preparedFrames: number[] = [];
  const offsetFrames: number[] = [];
  let cumulativeNominal = 0;

  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    const isLast = i === N - 1;
    const K_i = nominalFrames[i];
    const K_next = isLast ? 0 : nominalFrames[i + 1];

    const M_i =
      isLast || sc.transitionOut === 'none'
        ? 0
        : typeof sc.transitionFrames === 'number'
        ? Math.max(0, Math.min(sc.transitionFrames, Math.floor(0.25 * Math.min(K_i, K_next))))
        : Math.min(10, Math.floor(0.25 * Math.min(K_i, K_next)));

    const K_prime_i = K_i + M_i;
    transitionFrames.push(M_i);
    preparedFrames.push(K_prime_i);
    offsetFrames.push(cumulativeNominal + K_i);

    sc.nominalFrames = K_i;
    sc.durationSec = Number((K_i / 30).toFixed(6));
    sc.timelineStartTimeSec = Number((cumulativeNominal / 30).toFixed(6));
    sc.transitionOut = isLast ? 'none' : sc.transitionOut;
    sc.transitionFrames = M_i;
    sc.transitionDurationSec = Number((M_i / 30).toFixed(6));
    sc.preparedClipFrames = K_prime_i;
    sc.preparedClipDurationSec = Number((K_prime_i / 30).toFixed(6));
    sc.xfadeOffsetSec = Number(((cumulativeNominal + K_i) / 30).toFixed(6));

    cumulativeNominal += K_i;
  }

  editingPlan.totalFrames = totalFrames;
  editingPlan.totalDurationSec = targetDurationSec;

  const hasAudioInput =
    Boolean(masterVoiceoverPath) &&
    fs.existsSync(masterVoiceoverPath) &&
    fs.statSync(masterVoiceoverPath).size > 100;

  const subtitleCues: AssSubtitleCue[] = (editingPlan.subtitles || []).map(sub => ({
    startTimeSec: sub.startTimeSec,
    endTimeSec: sub.endTimeSec,
    text: sub.text
  }));

  const overlayCues: AssOverlayCue[] = [];
  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    if (sc.overlayText && sc.overlayText.trim().length > 0) {
      const startSec =
        typeof sc.overlayTextStartTimeSec === 'number'
          ? sc.overlayTextStartTimeSec
          : sc.timelineStartTimeSec + 0.25;
      const durSec =
        typeof sc.overlayTextDurationSec === 'number'
          ? sc.overlayTextDurationSec
          : Math.max(1.0, Math.min(3.5, sc.durationSec - 0.5));
      const endSec = Math.min(sc.timelineStartTimeSec + sc.durationSec - 0.05, startSec + durSec);
      if (endSec > startSec + 0.15) {
        overlayCues.push({
          startTimeSec: startSec,
          endTimeSec: endSec,
          text: sc.overlayText.trim(),
          style: sc.overlayStyle || (i === 0 ? 'title' : i === N - 1 ? 'cta_pill' : 'badge')
        });
      }
    }
  }

  const assFilePath = path.join(projectDir, 'captions_and_titles.ass');
  writeCreatorAssFile(assFilePath, {
    width: targetWidth,
    height: targetHeight,
    aspectRatio: editingPlan.aspectRatio,
    subtitles: subtitleCues,
    overlays: overlayCues
  });
  editingPlan.assSubtitlePath = assFilePath;

  const assContent = fs.readFileSync(assFilePath, 'utf-8');
  const assBytes = new Uint8Array(fs.readFileSync(assFilePath));
  const voiceoverBytes = hasAudioInput
    ? new Uint8Array(fs.readFileSync(masterVoiceoverPath))
    : new Uint8Array(0);

  const filesMap: Record<string, Uint8Array> = {
    'captions_and_titles.ass': assBytes
  };
  if (hasAudioInput) {
    filesMap['master_voiceover.wav'] = voiceoverBytes;
  }

  const assetsPayload: Array<{
    id: string;
    index: number;
    filename: string;
    type: 'image' | 'video';
    originalName: string;
    mimeType: string;
    durationSec: number;
    bytes: Uint8Array;
  }> = [];

  const assetIdToModalFilename = new Map<string, { filename: string; index: number; durationSec: number }>();

  for (let idx = 0; idx < assets.length; idx++) {
    const a = assets[idx];
    if (!fs.existsSync(a.filePath)) {
      throw new Error(`Required media asset file does not exist on disk: ${a.originalName} (${a.id})`);
    }
    const ext = path.extname(a.filePath) || (a.type === 'video' ? '.mp4' : '.jpg');
    const filename = `asset_${idx}_${a.id.replace(/[^a-zA-Z0-9_-]/g, '')}${ext}`;
    const rawBuf = fs.readFileSync(a.filePath);
    const bytes = new Uint8Array(rawBuf);
    const probedDur = a.type === 'video' ? await probeSourceDurationSec(a.filePath, a.durationSec || 4.0) : 0;

    filesMap[filename] = bytes;
    assetIdToModalFilename.set(a.id, { filename, index: idx, durationSec: probedDur });
    assetsPayload.push({
      id: a.id,
      index: idx,
      filename,
      type: a.type,
      originalName: a.originalName,
      mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      durationSec: probedDur,
      bytes
    });
  }

  // Build unified single-pass FFmpeg input list and filter_complex for all N scenes
  const ffmpegInputArgs: string[] = [];
  const filterGraphParts: string[] = [];

  for (let i = 0; i < N; i++) {
    const sc = editingPlan.scenes[i];
    const asset = assets.find(a => a.id === sc.assetId) || assets[i % assets.length];
    const meta = assetIdToModalFilename.get(asset.id) || {
      filename: assetsPayload[i % assetsPayload.length].filename,
      index: i % assetsPayload.length,
      durationSec: 4.0
    };
    const K_prime_i = preparedFrames[i];
    const D_prime_i = K_prime_i / 30;
    const colorFilter = getColorFilter(sc.colorGrading);

    const { cx, cy, cropFilter: crop2x } = computeContentAwareCropCoords(
      sc.samFocusBox,
      `${targetWidth}*2`,
      `${targetHeight}*2`
    );
    const { cropFilter: crop1x } = computeContentAwareCropCoords(
      sc.samFocusBox,
      `${targetWidth}`,
      `${targetHeight}`
    );

    ffmpegInputArgs.push('-i', meta.filename);

    if (asset.type === 'image') {
      if (sc.effect === 'pip_detail_spotlight') {
        const pipW = Math.max(160, Math.floor((targetWidth * 0.34) / 2) * 2);
        const pipH = Math.max(160, Math.floor((targetHeight * 0.28) / 2) * 2);
        const startX = Math.max(0.34, cx - 0.08);
        const mainXExpr = `'iw*(${startX.toFixed(3)}+0.14*on/${K_prime_i})-(iw/zoom/2)'`;
        const mainYExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;
        const pipXExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        const pipYExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

        filterGraphParts.push(
          `[${i}:v]scale=${targetWidth}*2:${targetHeight}*2:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,${crop2x},split=2[base_src_${i}][pip_src_${i}]`,
          `[base_src_${i}]zoompan=z='1.08':x=${mainXExpr}:y=${mainYExpr}:d=${K_prime_i}:s=${targetWidth}x${targetHeight}:fps=30,setsar=1[main_v_${i}]`,
          `[pip_src_${i}]zoompan=z='1.38+0.06*on/${K_prime_i}':x=${pipXExpr}:y=${pipYExpr}:d=${K_prime_i}:s=${pipW}x${pipH}:fps=30,setsar=1,pad=w=${pipW}+8:h=${pipH}+8:x=4:y=4:color=white@0.92[pip_v_${i}]`,
          `[main_v_${i}][pip_v_${i}]overlay=x=W-w-44:y=56:shortest=1,${colorFilter},format=yuv420p,trim=end_frame=${K_prime_i},settb=1/30,setpts=N[v${i}]`
        );
      } else {
        let zoomExpr = `1.0+0.12*on/${K_prime_i}`;
        let xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        let yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

        if (sc.effect === 'slow_zoom_out') {
          zoomExpr = `1.14-0.14*on/${K_prime_i}`;
        } else if (sc.effect === 'pull_back_reveal') {
          zoomExpr = `1.24-0.22*on/${K_prime_i}`;
        } else if (sc.effect === 'pan_left') {
          zoomExpr = '1.12';
          const startX = Math.min(0.68, cx + 0.10);
          xExpr = `'iw*(${startX.toFixed(3)}-0.20*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'pan_right') {
          zoomExpr = '1.12';
          const startX = Math.max(0.32, cx - 0.10);
          xExpr = `'iw*(${startX.toFixed(3)}+0.20*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'track_horizontal') {
          zoomExpr = '1.14';
          const dir = i % 2 === 0 ? 1 : -1;
          const startX = Math.max(0.30, Math.min(0.70, cx - dir * 0.11));
          const deltaX = (dir * 0.22).toFixed(3);
          xExpr = `'iw*(${startX.toFixed(3)}+${deltaX}*on/${K_prime_i})-(iw/zoom/2)'`;
        } else if (sc.effect === 'track_vertical') {
          zoomExpr = '1.16';
          const dir = i % 2 === 0 ? -1 : 1;
          const startY = Math.max(0.30, Math.min(0.70, cy - dir * 0.10));
          const deltaY = (dir * 0.20).toFixed(3);
          yExpr = `'ih*(${startY.toFixed(3)}+${deltaY}*on/${K_prime_i})-(ih/zoom/2)'`;
        } else if (sc.effect === 'detail_closeup') {
          zoomExpr = `1.24+0.06*on/${K_prime_i}`;
        } else if (sc.effect === 'handheld_stabilized') {
          zoomExpr = '1.08';
          xExpr = `'iw*(${cx.toFixed(3)}+0.018*sin(on/12))-(iw/zoom/2)'`;
          yExpr = `'ih*(${cy.toFixed(3)}+0.015*cos(on/15))-(ih/zoom/2)'`;
        } else if (sc.effect === 'smart_subject_focus') {
          zoomExpr = `1.0+0.14*on/${K_prime_i}`;
        } else if (sc.effect === 'static') {
          zoomExpr = '1.0';
        }

        filterGraphParts.push(
          `[${i}:v]scale=${targetWidth}*2:${targetHeight}*2:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,${crop2x},` +
            `zoompan=z='${zoomExpr}':x=${xExpr}:y=${yExpr}:d=${K_prime_i}:s=${targetWidth}x${targetHeight}:fps=30,` +
            `setsar=1,${colorFilter},format=yuv420p,trim=end_frame=${K_prime_i},settb=1/30,setpts=N[v${i}]`
        );
      }
    } else {
      const srcDur = Math.max(0.2, meta.durationSec || 4.0);
      const slowdownRequired = Math.min(MAX_SLOWDOWN_FACTOR, Math.max(1.0, D_prime_i / srcDur));
      filterGraphParts.push(
        `[${i}:v]setpts=${slowdownRequired.toFixed(6)}*PTS,fps=30,` +
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase:in_range=auto:out_range=tv,` +
          `${crop1x},setsar=1,${colorFilter},format=yuv420p,trim=end_frame=${K_prime_i},settb=1/30,setpts=N[v${i}]`
      );
    }
  }

  let currentLabel = '[v0]';
  for (let i = 0; i < N - 1; i++) {
    const M_i = transitionFrames[i];
    const nextInput = `[v${i + 1}]`;
    const outLabel = `[acc${i + 1}]`;

    if (M_i > 0 && editingPlan.scenes[i].transitionOut !== 'none') {
      const mappedTransition = mapTransitionToXfade(editingPlan.scenes[i].transitionOut);
      const durSec = M_i / 30;
      const offsetSec = offsetFrames[i] / 30;
      filterGraphParts.push(
        `${currentLabel}${nextInput}xfade=transition=${mappedTransition}:duration=${durSec.toFixed(6)}:offset=${offsetSec.toFixed(6)},settb=1/30,setpts=N,setsar=1,format=yuv420p${outLabel}`
      );
    } else {
      filterGraphParts.push(
        `${currentLabel}${nextInput}concat=n=2:v=1:a=0,settb=1/30,setpts=N,setsar=1,format=yuv420p${outLabel}`
      );
    }

    currentLabel = outLabel;
  }

  const hasAssEvents = subtitleCues.length > 0 || overlayCues.length > 0;
  if (hasAssEvents) {
    filterGraphParts.push(
      `${currentLabel}ass=filename='captions_and_titles.ass':shaping=complex,settb=1/30,setpts=N,setsar=1,format=yuv420p[vfinal]`
    );
    currentLabel = '[vfinal]';
  }

  const filterComplex = filterGraphParts.join(';');

  const ffmpegArgs: string[] = [
    '-y',
    '-v', 'error',
    ...ffmpegInputArgs
  ];
  if (hasAudioInput) {
    ffmpegArgs.push('-i', 'master_voiceover.wav');
  }
  ffmpegArgs.push(
    '-filter_complex', filterComplex,
    '-map', currentLabel
  );
  if (hasAudioInput) {
    ffmpegArgs.push(
      '-map', `${N}:a:0`,
      '-filter:a', `volume=1.35,alimiter=limit=0.95:level=false,apad=whole_dur=${targetDurationSec.toFixed(3)}`,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2'
    );
  } else {
    ffmpegArgs.push('-an');
  }
  ffmpegArgs.push(
    '-frames:v', String(totalFrames),
    '-t', targetDurationSec.toFixed(6),
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-maxrate', '12M',
    '-bufsize', '24M',
    '-profile:v', 'high',
    '-level:v', '4.1',
    '-pix_fmt', 'yuv420p',
    '-tag:v', 'avc1',
    '-video_track_timescale', '30000',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-movflags', '+faststart',
    'output.mp4'
  );

  return {
    targetWidth,
    targetHeight,
    totalFrames,
    targetDurationSec,
    hasAudioInput,
    assFilePath,
    assContent,
    assBytes,
    voiceoverBytes,
    assetsPayload,
    filesMap,
    filterComplex,
    ffmpegArgs
  };
}

/**
 * Encodes (args, kwargs) into Python Pickle Protocol 4 bytes via /usr/bin/python3
 * when a deployed Modal function uses DATA_FORMAT_PICKLE (1) instead of DATA_FORMAT_CBOR (4).
 */
async function encodeModalInputWithPythonPickle(
  args: any[],
  kwargs: Record<string, any>
): Promise<Uint8Array> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-pkl-in-'));
  try {
    let blobCounter = 0;
    const serializeValue = (val: any): any => {
      if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
        const blobFile = path.join(tmpDir, `blob_${blobCounter++}.bin`);
        fs.writeFileSync(blobFile, val);
        return { __modal_bytes_file__: blobFile };
      }
      if (Array.isArray(val)) {
        return val.map(serializeValue);
      }
      if (val && typeof val === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
          if (v !== undefined && typeof v !== 'function') {
            out[k] = serializeValue(v);
          }
        }
        return out;
      }
      return val;
    };

    const manifestPath = path.join(tmpDir, 'manifest.json');
    const outputPicklePath = path.join(tmpDir, 'payload.pkl');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        args: serializeValue(args),
        kwargs: serializeValue(kwargs)
      })
    );

    const pyScript = `
import json, pickle, sys

def hydrate(obj):
    if isinstance(obj, dict):
        if "__modal_bytes_file__" in obj and len(obj) == 1:
            with open(obj["__modal_bytes_file__"], "rb") as bf:
                return bf.read()
        return {k: hydrate(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [hydrate(x) for x in obj]
    return obj

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

args = tuple(hydrate(data.get("args", [])))
kwargs = hydrate(data.get("kwargs", {}))
with open(sys.argv[2], "wb") as out:
    pickle.dump((args, kwargs), out, protocol=4)
`;
    await execFileAsync('python3', ['-c', pyScript, manifestPath, outputPicklePath]);
    return new Uint8Array(fs.readFileSync(outputPicklePath));
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Decodes Python Pickle output bytes via /usr/bin/python3 when a Modal function returns DATA_FORMAT_PICKLE (1).
 */
async function decodeModalOutputWithPythonPickle(pickleBytes: Uint8Array): Promise<any> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modal-pkl-out-'));
  try {
    const inputPicklePath = path.join(tmpDir, 'output.pkl');
    const outVideoPath = path.join(tmpDir, 'extracted.mp4');
    const outMetaPath = path.join(tmpDir, 'meta.json');
    fs.writeFileSync(inputPicklePath, pickleBytes);

    const pyScript = `
import json, pickle, sys, base64

with open(sys.argv[1], "rb") as f:
    obj = pickle.load(f)

video_path = sys.argv[2]
meta_path = sys.argv[3]

if isinstance(obj, (bytes, bytearray)):
    with open(video_path, "wb") as vf:
        vf.write(obj)
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump({"type": "bytes", "size": len(obj)}, mf)
elif isinstance(obj, str):
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump({"type": "str", "value": obj}, mf)
elif isinstance(obj, dict):
    extracted = False
    for k in ("video_bytes", "output_bytes", "mp4_bytes", "data", "video", "bytes", "result", "content", "output"):
        v = obj.get(k)
        if isinstance(v, (bytes, bytearray)) and len(v) > 100:
            with open(video_path, "wb") as vf:
                vf.write(v)
            extracted = True
            break
    clean = {}
    for k, v in obj.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            clean[k] = v
        elif isinstance(v, (bytes, bytearray)) and not extracted and len(v) > 100:
            with open(video_path, "wb") as vf:
                vf.write(v)
            extracted = True
    clean["__extracted_video__"] = extracted
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump({"type": "dict", "value": clean}, mf)
else:
    with open(meta_path, "w", encoding="utf-8") as mf:
        json.dump({"type": "other", "repr": repr(obj)[:500]}, mf)
`;
    await execFileAsync('python3', ['-c', pyScript, inputPicklePath, outVideoPath, outMetaPath]);
    const meta = JSON.parse(fs.readFileSync(outMetaPath, 'utf-8'));
    if (meta.type === 'bytes' && fs.existsSync(outVideoPath)) {
      return new Uint8Array(fs.readFileSync(outVideoPath));
    }
    if (meta.type === 'str') {
      return meta.value;
    }
    if (meta.type === 'dict') {
      const dictVal = meta.value || {};
      if (dictVal.__extracted_video__ && fs.existsSync(outVideoPath)) {
        dictVal.video_bytes = new Uint8Array(fs.readFileSync(outVideoPath));
      }
      return dictVal;
    }
    return meta;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Uploads large binary function inputs to Modal's blob storage (supporting single PUT and multipart).
 */
async function uploadModalBlob(cpClient: any, data: Uint8Array): Promise<string> {
  const contentMd5 = crypto.createHash('md5').update(data).digest('base64');
  const contentSha256 = crypto.createHash('sha256').update(data).digest('base64');
  const resp = await cpClient.blobCreate({
    contentMd5,
    contentSha256Base64: contentSha256,
    contentLength: data.length
  });

  if (resp.multipart && resp.multipart.uploadUrls?.length > 0) {
    const partLen = resp.multipart.partLength || 8 * 1024 * 1024;
    const etags: string[] = [];
    for (let i = 0; i < resp.multipart.uploadUrls.length; i++) {
      const start = i * partLen;
      const end = Math.min(data.length, start + partLen);
      const slice = data.subarray(start, end);
      const partMd5 = crypto.createHash('md5').update(slice).digest('base64');
      const putRes = await fetch(resp.multipart.uploadUrls[i], {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-MD5': partMd5
        },
        body: slice
      });
      if (!putRes.ok) {
        throw new Error(`Modal multipart blob upload failed on part ${i + 1}: HTTP ${putRes.status}`);
      }
      const etag = putRes.headers.get('etag') || '';
      etags.push(etag);
    }
    if (resp.multipart.completionUrl) {
      const xmlParts = etags
        .map((etag, idx) => `<Part><PartNumber>${idx + 1}</PartNumber><ETag>${etag}</ETag></Part>`)
        .join('');
      const completeXml = `<CompleteMultipartUpload>${xmlParts}</CompleteMultipartUpload>`;
      const compRes = await fetch(resp.multipart.completionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: completeXml
      });
      if (!compRes.ok) {
        throw new Error(`Modal multipart blob completion failed: HTTP ${compRes.status}`);
      }
    }
    return resp.blobId;
  }

  if (!resp.uploadUrl) {
    throw new Error('Missing uploadUrl in Modal BlobCreate response');
  }

  const uploadResp = await fetch(resp.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-MD5': contentMd5
    },
    body: data
  });
  if (!uploadResp.ok) {
    throw new Error(`Modal blob upload failed: HTTP ${uploadResp.status} ${uploadResp.statusText}`);
  }
  return resp.blobId;
}

async function downloadModalBlob(cpClient: any, blobId: string): Promise<Uint8Array> {
  const resp = await cpClient.blobGet({ blobId });
  if (!resp.downloadUrl) {
    throw new Error(`Missing downloadUrl for Modal blob ${blobId}`);
  }
  const s3Resp = await fetch(resp.downloadUrl);
  if (!s3Resp.ok) {
    throw new Error(`Failed to download Modal output blob ${blobId}: HTTP ${s3Resp.status}`);
  }
  const arrayBuf = await s3Resp.arrayBuffer();
  return new Uint8Array(arrayBuf);
}

/**
 * Extracts rendered MP4 bytes from any supported return structure of `edit_media`.
 */
async function extractMp4BytesFromModalReturn(resultValue: any): Promise<Buffer> {
  if (!resultValue) {
    throw new Error('Modal function edit_media returned an empty/null result.');
  }

  if (resultValue instanceof Uint8Array || Buffer.isBuffer(resultValue)) {
    return Buffer.from(resultValue);
  }

  if (typeof resultValue === 'string') {
    const trimmed = resultValue.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const resp = await fetch(trimmed);
      if (!resp.ok) {
        throw new Error(`Failed to download rendered video from Modal URL (${trimmed}): HTTP ${resp.status}`);
      }
      return Buffer.from(await resp.arrayBuffer());
    }
    const base64Clean = trimmed.replace(/^data:video\/[a-zA-Z0-9+-]+;base64,/, '');
    return Buffer.from(base64Clean, 'base64');
  }

  if (typeof resultValue === 'object') {
    if (resultValue.success === false && resultValue.error) {
      throw new Error(`Modal edit_media returned error: ${resultValue.error}`);
    }

    const byteKeys = [
      'video_bytes',
      'videoBytes',
      'output_bytes',
      'outputBytes',
      'mp4_bytes',
      'mp4Bytes',
      'data',
      'video',
      'bytes',
      'result',
      'content',
      'output',
      'file_bytes'
    ];
    for (const k of byteKeys) {
      const candidate = resultValue[k];
      if (candidate instanceof Uint8Array || Buffer.isBuffer(candidate)) {
        if (candidate.byteLength > 100) {
          return Buffer.from(candidate);
        }
      }
    }

    const base64Keys = [
      'video_base64',
      'videoBase64',
      'output_base64',
      'outputBase64',
      'mp4_base64',
      'base64',
      'b64',
      'data',
      'video',
      'result'
    ];
    for (const k of base64Keys) {
      const candidate = resultValue[k];
      if (typeof candidate === 'string' && candidate.length > 100) {
        const trimmed = candidate.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          const resp = await fetch(trimmed);
          if (!resp.ok) {
            throw new Error(`Failed to download rendered video from Modal URL: HTTP ${resp.status}`);
          }
          return Buffer.from(await resp.arrayBuffer());
        }
        const cleanB64 = trimmed.replace(/^data:video\/[a-zA-Z0-9+-]+;base64,/, '');
        const buf = Buffer.from(cleanB64, 'base64');
        if (buf.length > 100) return buf;
      }
    }

    const urlKeys = ['url', 'video_url', 'videoUrl', 'download_url', 'downloadUrl', 'output_url', 'outputUrl'];
    for (const k of urlKeys) {
      const candidate = resultValue[k];
      if (typeof candidate === 'string' && (candidate.startsWith('http://') || candidate.startsWith('https://'))) {
        const resp = await fetch(candidate);
        if (!resp.ok) {
          throw new Error(`Failed to download rendered video from Modal URL (${candidate}): HTTP ${resp.status}`);
        }
        return Buffer.from(await resp.arrayBuffer());
      }
    }
  }

  throw new Error(
    `Modal function edit_media returned an unrecognized output format (${typeof resultValue}): ${JSON.stringify(resultValue).slice(0, 300)}`
  );
}

/**
 * Builds the positional args and keyword arguments for `edit_media` based on the remote
 * FunctionSchema returned by Modal's Control Plane, preserving all scenes, transitions,
 * camera effects, subtitles, narration audio, and target duration.
 */
async function buildModalFunctionArguments(
  handleMetadata: any,
  payload: ModalRenderingRequest,
  spec: Awaited<ReturnType<typeof prepareModalTimelineAndFfmpegSpec>>
): Promise<{ args: any[]; kwargs: Record<string, any> }> {
  const schemaArgs: Array<{
    name: string;
    type: number;
    hasDefault: boolean;
  }> = handleMetadata?.functionSchema?.arguments || [];

  const comprehensivePayload: Record<string, any> = {
    project_id: payload.projectId,
    projectId: payload.projectId,
    app_name: DEFAULT_MODAL_APP_NAME,
    workspace: DEFAULT_MODAL_WORKSPACE,
    environment: DEFAULT_MODAL_ENVIRONMENT,
    app_id: DEFAULT_MODAL_APP_ID,
    width: spec.targetWidth,
    height: spec.targetHeight,
    fps: 30,
    duration: spec.targetDurationSec,
    duration_sec: spec.targetDurationSec,
    target_duration: spec.targetDurationSec,
    total_frames: spec.totalFrames,
    aspect_ratio: payload.editingPlan.aspectRatio,
    has_audio: spec.hasAudioInput,
    output_filename: 'output.mp4',
    ffmpeg_args: spec.ffmpegArgs,
    ffmpeg_command: ['ffmpeg', ...spec.ffmpegArgs],
    filter_complex: spec.filterComplex,
    files: spec.filesMap,
    assets: spec.assetsPayload.map(a => ({
      id: a.id,
      index: a.index,
      filename: a.filename,
      type: a.type,
      original_name: a.originalName,
      mime_type: a.mimeType,
      duration_sec: a.durationSec,
      bytes: a.bytes
    })),
    scenes: payload.editingPlan.scenes,
    subtitles: payload.editingPlan.subtitles,
    editing_plan: payload.editingPlan,
    editingPlan: payload.editingPlan,
    ass_content: spec.assContent,
    ass_bytes: spec.assBytes,
    audio_bytes: spec.hasAudioInput ? spec.voiceoverBytes : undefined,
    voiceover_bytes: spec.hasAudioInput ? spec.voiceoverBytes : undefined
  };

  if (schemaArgs.length === 0) {
    return { args: [comprehensivePayload], kwargs: {} };
  }

  if (schemaArgs.length === 1) {
    const singleName = schemaArgs[0].name;
    const lower = singleName.toLowerCase();
    if (
      ['payload', 'data', 'request', 'req', 'job', 'params', 'config', 'input', 'input_data', 'body', 'plan', 'spec', 'kwargs'].includes(
        lower
      ) ||
      schemaArgs[0].type === 7 /* PARAM_TYPE_DICT */ ||
      schemaArgs[0].type === 5 /* PARAM_TYPE_UNKNOWN */ ||
      schemaArgs[0].type === 0
    ) {
      return { args: [], kwargs: { [singleName]: comprehensivePayload } };
    }
  }

  // Named parameter mapping when edit_media defines explicit parameters in Python
  const kwargs: Record<string, any> = {};
  const firstImageAsset = spec.assetsPayload.find(a => a.type === 'image') || spec.assetsPayload[0];
  const firstVideoAsset = spec.assetsPayload.find(a => a.type === 'video') || spec.assetsPayload[0];

  for (const argSpec of schemaArgs) {
    const name = argSpec.name;
    const lower = name.toLowerCase();

    if (['payload', 'data', 'request', 'job', 'params', 'config'].includes(lower)) {
      kwargs[name] = comprehensivePayload;
    } else if (['files', 'input_files', 'file_map'].includes(lower)) {
      kwargs[name] = spec.filesMap;
    } else if (['assets', 'media_assets', 'inputs', 'media_files'].includes(lower)) {
      kwargs[name] = comprehensivePayload.assets;
    } else if (['ffmpeg_args', 'args', 'command', 'cmd', 'ffmpeg_cmd', 'ffmpeg_command'].includes(lower)) {
      kwargs[name] = spec.ffmpegArgs;
    } else if (['filter_complex', 'filtergraph', 'vf', 'filter'].includes(lower)) {
      kwargs[name] = spec.filterComplex;
    } else if (['editing_plan', 'editingplan', 'plan', 'timeline'].includes(lower)) {
      kwargs[name] = payload.editingPlan;
    } else if (['scenes', 'scene_list'].includes(lower)) {
      kwargs[name] = payload.editingPlan.scenes;
    } else if (['audio_bytes', 'audiobytes', 'voiceover_bytes', 'voiceover', 'audio', 'audio_data', 'narration_bytes'].includes(lower)) {
      kwargs[name] = spec.hasAudioInput ? spec.voiceoverBytes : null;
    } else if (['ass_content', 'ass', 'subtitles_ass', 'ass_script', 'subtitle_text'].includes(lower)) {
      kwargs[name] = spec.assContent;
    } else if (['ass_bytes', 'subtitle_bytes', 'subtitles_bytes'].includes(lower)) {
      kwargs[name] = spec.assBytes;
    } else if (['subtitles', 'captions'].includes(lower)) {
      kwargs[name] = payload.editingPlan.subtitles;
    } else if (['duration', 'duration_sec', 'durationsec', 'target_duration', 'total_duration'].includes(lower)) {
      kwargs[name] = argSpec.type === 2 /* PARAM_TYPE_INT */ ? Math.round(spec.targetDurationSec) : spec.targetDurationSec;
    } else if (['width', 'target_width', 'w'].includes(lower)) {
      kwargs[name] = spec.targetWidth;
    } else if (['height', 'target_height', 'h'].includes(lower)) {
      kwargs[name] = spec.targetHeight;
    } else if (['fps', 'frame_rate', 'framerate'].includes(lower)) {
      kwargs[name] = 30;
    } else if (['aspect_ratio', 'aspectratio'].includes(lower)) {
      kwargs[name] = payload.editingPlan.aspectRatio;
    } else if (['output_filename', 'output_name', 'output_path'].includes(lower)) {
      kwargs[name] = 'output.mp4';
    } else if (['image_bytes', 'image', 'img_bytes', 'image_data'].includes(lower)) {
      kwargs[name] = firstImageAsset ? firstImageAsset.bytes : null;
    } else if (['video_bytes', 'video', 'vid_bytes', 'video_data', 'media_bytes', 'input_bytes'].includes(lower)) {
      kwargs[name] = firstVideoAsset ? firstVideoAsset.bytes : null;
    } else if (['project_id', 'projectid'].includes(lower)) {
      kwargs[name] = payload.projectId;
    } else if (!argSpec.hasDefault) {
      kwargs[name] = comprehensivePayload;
    }
  }

  return { args: [], kwargs };
}

/**
 * Verifies connectivity and metadata of the deployed Modal function (`doudouvoice-media-edit` / `edit_media`).
 */
export async function verifyModalAppConnection(): Promise<{
  configured: boolean;
  connected: boolean;
  appName: string;
  workspace: string;
  environment: string;
  functionName: string;
  expectedAppId: string;
  tokenType?: 'api_token' | 'proxy_auth_token' | 'none';
  tokenFormatWarning?: string;
  resolvedAppId?: string;
  functionId?: string;
  webUrl?: string;
  schemaArguments?: Array<{ name: string; type: number; hasDefault: boolean }>;
  supportedInputFormats?: number[];
  error?: string;
}> {
  const cfg = getModalAppConfig();
  if (!cfg.isConfigured) {
    return {
      configured: false,
      connected: false,
      appName: cfg.appName,
      workspace: cfg.workspace,
      environment: cfg.environment,
      functionName: cfg.functionName,
      expectedAppId: cfg.appId,
      tokenType: cfg.tokenType,
      tokenFormatWarning: cfg.tokenFormatWarning,
      error:
        cfg.tokenFormatWarning ||
        'Missing MODAL_TOKEN_ID (ak-...) and MODAL_TOKEN_SECRET (as-...) in server environment.'
    };
  }

  if (!cfg.hasSdkCredentials && cfg.hasWebhookCredentials) {
    return {
      configured: true,
      connected: true,
      appName: cfg.appName,
      workspace: cfg.workspace,
      environment: cfg.environment,
      functionName: cfg.functionName,
      expectedAppId: cfg.appId,
      tokenType: cfg.tokenType,
      tokenFormatWarning: cfg.tokenFormatWarning,
      webUrl: cfg.webhookUrl
    };
  }

  const client = new ModalClient({
    tokenId: cfg.tokenId,
    tokenSecret: cfg.tokenSecret,
    environment: cfg.environment,
    timeoutMs: 20_000
  });

  try {
    const resp = await client.cpClient.functionGet({
      appName: cfg.appName,
      objectTag: cfg.functionName,
      environmentName: cfg.environment
    });
    const meta = resp.handleMetadata;
    return {
      configured: true,
      connected: Boolean(resp.functionId),
      appName: cfg.appName,
      workspace: cfg.workspace,
      environment: cfg.environment,
      functionName: cfg.functionName,
      expectedAppId: cfg.appId,
      tokenType: cfg.tokenType,
      tokenFormatWarning: cfg.tokenFormatWarning,
      resolvedAppId: meta?.appId,
      functionId: resp.functionId,
      webUrl: meta?.webUrl || undefined,
      schemaArguments: (meta?.functionSchema?.arguments || []).map((a: any) => ({
        name: a.name,
        type: a.type,
        hasDefault: a.hasDefault
      })),
      supportedInputFormats: meta?.supportedInputFormats || []
    };
  } catch (err: any) {
    return {
      configured: true,
      connected: false,
      appName: cfg.appName,
      workspace: cfg.workspace,
      environment: cfg.environment,
      functionName: cfg.functionName,
      expectedAppId: cfg.appId,
      tokenType: cfg.tokenType,
      tokenFormatWarning: cfg.tokenFormatWarning,
      error: err?.message || String(err)
    };
  } finally {
    try {
      client.close();
    } catch (_) {}
  }
}

/**
 * Executes FFmpeg rendering on the deployed Modal app (`doudouvoice-media-edit` -> `edit_media`,
 * workspace `abdelwadoudamirouche7`, environment `main`, App ID `ap-PNNq10tlmnZUC85lShUIiM`).
 */
async function executeModalEditMedia(
  payload: ModalRenderingRequest,
  modalCfg: ModalAppConfig
): Promise<ModalRenderingResult> {
  const reportProgress = (msg: string) => {
    console.log(`[Modal Runner] ${msg}`);
    if (payload.onProgress) {
      try {
        payload.onProgress(msg);
      } catch (_) {}
    }
  };

  reportProgress(
    `Preparing multi-scene timeline, RTL subtitles, and voiceover payload for Modal app "${modalCfg.appName}.${modalCfg.functionName}" (${modalCfg.workspace}/${modalCfg.environment})...`
  );

  const spec = await prepareModalTimelineAndFfmpegSpec(payload);

  const client = new ModalClient({
    tokenId: modalCfg.tokenId,
    tokenSecret: modalCfg.tokenSecret,
    environment: modalCfg.environment,
    timeoutMs: modalCfg.timeoutMs
  });

  let functionCallId: string | undefined;
  let functionId: string | undefined;

  try {
    reportProgress(
      `Resolving deployed Modal function "${modalCfg.appName}/${modalCfg.functionName}" in environment "${modalCfg.environment}"...`
    );

    const fnGetResp = await client.cpClient.functionGet({
      appName: modalCfg.appName,
      objectTag: modalCfg.functionName,
      environmentName: modalCfg.environment
    });

    functionId = fnGetResp.functionId;
    const handleMeta = fnGetResp.handleMetadata;
    const resolvedAppId = handleMeta?.appId || modalCfg.appId;

    console.log(
      `[Modal Runner] Resolved functionId=${functionId}, appId=${resolvedAppId} (expected=${modalCfg.appId}), supportedInputFormats=${JSON.stringify(handleMeta?.supportedInputFormats || [])}`
    );

    if (handleMeta?.webUrl && handleMeta.webUrl.trim().length > 0) {
      reportProgress(`Invoking Modal web endpoint for "${modalCfg.appName}.${modalCfg.functionName}"...`);
      const webResult = await callModalCloudApi(handleMeta.webUrl, modalCfg.tokenSecret, payload);
      if (webResult && webResult.success) {
        return {
          ...webResult,
          modalAppInfo: {
            appName: modalCfg.appName,
            workspace: modalCfg.workspace,
            environment: modalCfg.environment,
            functionName: modalCfg.functionName,
            appId: resolvedAppId,
            functionId
          }
        };
      }
    }

    const { args, kwargs } = await buildModalFunctionArguments(handleMeta, payload, spec);

    const supportedInputFormats: number[] =
      handleMeta?.supportedInputFormats && handleMeta.supportedInputFormats.length > 0
        ? handleMeta.supportedInputFormats
        : [1 /* DATA_FORMAT_PICKLE */];
    const useCbor = supportedInputFormats.includes(4 /* DATA_FORMAT_CBOR */);
    const dataFormat = useCbor ? 4 /* DATA_FORMAT_CBOR */ : 1 /* DATA_FORMAT_PICKLE */;

    reportProgress(
      `Serializing ${spec.assetsPayload.length} media asset(s), ASS subtitles, and voiceover (${useCbor ? 'CBOR' : 'Pickle'} format) for Modal execution...`
    );

    const encodedInputBytes = useCbor
      ? new Uint8Array(cborEncode([args, kwargs]))
      : await encodeModalInputWithPythonPickle(args, kwargs);

    const maxInlineBytes = handleMeta?.maxObjectSizeBytes ?? 2 * 1024 * 1024;
    let argsBlobId: string | undefined;

    if (encodedInputBytes.byteLength > maxInlineBytes) {
      reportProgress(
        `Uploading ${(encodedInputBytes.byteLength / (1024 * 1024)).toFixed(2)} MB media payload to Modal cloud blob storage...`
      );
      argsBlobId = await uploadModalBlob(client.cpClient, encodedInputBytes);
    }

    const functionInput = {
      args: argsBlobId ? undefined : encodedInputBytes,
      argsBlobId,
      dataFormat,
      methodName: undefined,
      finalInput: false
    };

    reportProgress(
      `Executing FFmpeg render on Modal (${modalCfg.appName}.${modalCfg.functionName}, ${spec.targetWidth}x${spec.targetHeight}, ${spec.targetDurationSec.toFixed(1)}s)...`
    );

    const mapResp = await client.cpClient.functionMap({
      functionId,
      parentInputId: '',
      returnExceptions: false,
      functionCallType: 1 /* FUNCTION_CALL_TYPE_UNARY */,
      functionCallInvocationType: 4 /* FUNCTION_CALL_INVOCATION_TYPE_SYNC */,
      fromSpawnMap: false,
      pipelinedInputs: [
        {
          idx: 0,
          input: functionInput
        }
      ]
    });

    functionCallId = mapResp.functionCallId;
    const inputJwt = mapResp.pipelinedInputs?.[0]?.inputJwt;

    const startTime = Date.now();
    let rawOutputItem: any = null;

    while (true) {
      const elapsedMs = Date.now() - startTime;
      const remainingMs = modalCfg.timeoutMs - elapsedMs;
      if (remainingMs <= 0) {
        try {
          await client.cpClient.functionCallCancel({
            functionCallId,
            terminateContainers: true
          });
        } catch (_) {}
        throw new Error(
          `Modal function "${modalCfg.appName}.${modalCfg.functionName}" timed out after ${(modalCfg.timeoutMs / 1000).toFixed(0)}s (functionCallId=${functionCallId}).`
        );
      }

      const pollSecs = Math.min(45, Math.max(5, Math.floor(remainingMs / 1000)));
      const outResp = await client.cpClient.functionGetOutputs({
        functionCallId,
        maxValues: 1,
        timeout: pollSecs,
        lastEntryId: '0-0',
        clearOnSuccess: true,
        inputJwts: inputJwt ? [inputJwt] : [],
        requestedAt: Date.now() / 1000
      });

      if (outResp.outputs && outResp.outputs.length > 0) {
        rawOutputItem = outResp.outputs[0];
        break;
      }

      reportProgress(
        `Modal FFmpeg job running (${Math.round((Date.now() - startTime) / 1000)}s elapsed, call=${functionCallId.slice(0, 12)}...)...`
      );
    }

    const genericResult = rawOutputItem.result;
    if (!genericResult) {
      throw new Error(`Modal function "${modalCfg.appName}.${modalCfg.functionName}" returned no result payload.`);
    }

    if (genericResult.status !== 1 /* GENERIC_STATUS_SUCCESS */) {
      const excMsg = genericResult.exception || genericResult.traceback || `Exit code ${genericResult.exitcode}`;
      throw new Error(`Modal remote execution error in ${modalCfg.appName}.${modalCfg.functionName}: ${excMsg}`);
    }

    let outputBytes = new Uint8Array(0);
    if (genericResult.data && genericResult.data.byteLength > 0) {
      outputBytes = genericResult.data;
    } else if (genericResult.dataBlobId) {
      reportProgress(`Downloading rendered MP4 from Modal output blob (${genericResult.dataBlobId})...`);
      outputBytes = await downloadModalBlob(client.cpClient, genericResult.dataBlobId);
    }

    const decodedResult =
      rawOutputItem.dataFormat === 4 /* DATA_FORMAT_CBOR */
        ? cborDecode(outputBytes)
        : rawOutputItem.dataFormat === 1 /* DATA_FORMAT_PICKLE */
        ? await decodeModalOutputWithPythonPickle(outputBytes)
        : outputBytes;

    const mp4Buffer = await extractMp4BytesFromModalReturn(decodedResult);
    fs.writeFileSync(payload.outputFilePath, mp4Buffer);

    reportProgress(
      `Received rendered MP4 from Modal (${(mp4Buffer.length / (1024 * 1024)).toFixed(2)} MB). Validating QuickTime & FFprobe streams...`
    );

    await ensureQuickTimeCompatibleMp4(payload.outputFilePath);

    const validation = await inspectAndValidateMp4(
      payload.outputFilePath,
      spec.targetDurationSec,
      spec.targetWidth,
      spec.targetHeight,
      spec.hasAudioInput,
      'Modal Cloud',
      false
    );

    console.log(`[Modal Cloud Validation Result] ${validation.summary}`);

    return {
      success: validation.valid,
      finalVideoPath: payload.outputFilePath,
      durationSec: validation.video.durationSec,
      fileSizeBytes: fs.statSync(payload.outputFilePath).size,
      renderedVia: 'Modal Cloud',
      isModalFallback: false,
      modalAppInfo: {
        appName: modalCfg.appName,
        workspace: modalCfg.workspace,
        environment: modalCfg.environment,
        functionName: modalCfg.functionName,
        appId: resolvedAppId,
        functionId,
        functionCallId
      },
      hasAudioInputSupplied: spec.hasAudioInput,
      videoOnly: !spec.hasAudioInput,
      validation,
      error: validation.valid ? undefined : validation.errors.join(' | ')
    };
  } finally {
    try {
      client.close();
    } catch (_) {}
  }
}

/**
 * Main Entry Point for AI Video Creator Beta FFmpeg Execution on Modal (`doudouvoice-media-edit` / `edit_media`).
 */
export async function executeModalRendering(
  payload: ModalRenderingRequest
): Promise<ModalRenderingResult> {
  const modalCfg = getModalAppConfig();
  const strictMode =
    payload.allowLocalFallback === false || process.env.MODAL_STRICT_MODE === 'true';
  const allowLocalFallback =
    payload.allowLocalFallback === true ||
    process.env.MODAL_ALLOW_LOCAL_FALLBACK === 'true' ||
    !strictMode;

  if (modalCfg.tokenFormatWarning) {
    console.warn(`[Modal Runner] ${modalCfg.tokenFormatWarning}`);
  }

  if (modalCfg.hasSdkCredentials) {
    try {
      return await executeModalEditMedia(payload, modalCfg);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[Modal Runner Error] ${errMsg}`);
      if (allowLocalFallback) {
        console.warn(`[Modal Runner] Modal execution encountered an error (${errMsg}); executing local 30-FPS FFmpeg pipeline so render completes.`);
        if (payload.onProgress) {
          try {
            payload.onProgress(`Rendering 30-FPS timeline via server FFmpeg engine (Modal fallback)...`);
          } catch (_) {}
        }
        return await executeLocalFfmpegPipeline(payload, true);
      }
      const hasAudioInput =
        Boolean(payload.masterVoiceoverPath) &&
        fs.existsSync(payload.masterVoiceoverPath) &&
        fs.statSync(payload.masterVoiceoverPath).size > 100;
      return {
        success: false,
        finalVideoPath: payload.outputFilePath,
        durationSec: 0,
        fileSizeBytes: 0,
        renderedVia: 'Modal Cloud',
        isModalFallback: false,
        modalAppInfo: {
          appName: modalCfg.appName,
          workspace: modalCfg.workspace,
          environment: modalCfg.environment,
          functionName: modalCfg.functionName,
          appId: modalCfg.appId
        },
        hasAudioInputSupplied: hasAudioInput,
        videoOnly: !hasAudioInput,
        validation: {
          valid: false,
          renderCompleted: false,
          technicalValidationPassed: false,
          fileSizeBytes: 0,
          formatName: 'none',
          renderedVia: 'Modal Cloud',
          isModalFallback: false,
          hasAudioInputSupplied: hasAudioInput,
          videoOnly: !hasAudioInput,
          video: { valid: false, codec: 'none', pixFmt: 'none', width: 0, height: 0, durationSec: 0, fps: 0, errors: [errMsg] },
          audio: { valid: false, isAudioPresent: false, errors: [errMsg] },
          summary: `Modal execution failed: ${errMsg}`,
          errors: [errMsg]
        },
        error: `Modal execution failed (${modalCfg.appName}.${modalCfg.functionName}): ${errMsg}`
      };
    }
  }

  if (modalCfg.hasWebhookCredentials) {
    const cloudResult = await callModalCloudApi(modalCfg.webhookUrl, modalCfg.apiKey, payload);
    if (cloudResult && cloudResult.success) {
      return cloudResult;
    }
  }

  if (allowLocalFallback) {
    if (payload.onProgress) {
      try {
        payload.onProgress(
          modalCfg.tokenFormatWarning
            ? `Rendering 30-FPS commercial MP4 via local FFmpeg (Note: ${modalCfg.tokenFormatWarning})`
            : `Rendering 30-FPS commercial MP4 via local FFmpeg engine...`
        );
      } catch (_) {}
    }
    return await executeLocalFfmpegPipeline(payload, true);
  }

  const missingCredsMsg =
    modalCfg.tokenFormatWarning ||
    `Modal credentials are not configured on the server. To render via your deployed Modal app ` +
      `(App: "${modalCfg.appName}", Function: "${modalCfg.functionName}", Workspace: "${modalCfg.workspace}", ` +
      `Environment: "${modalCfg.environment}", App ID: "${modalCfg.appId}"), please add MODAL_TOKEN_ID (ak-...) and MODAL_TOKEN_SECRET (as-...) ` +
      `in the AI Studio Secrets panel.`;

  const hasAudioInput =
    Boolean(payload.masterVoiceoverPath) &&
    fs.existsSync(payload.masterVoiceoverPath) &&
    fs.statSync(payload.masterVoiceoverPath).size > 100;

  return {
    success: false,
    finalVideoPath: payload.outputFilePath,
    durationSec: 0,
    fileSizeBytes: 0,
    renderedVia: 'Modal Cloud',
    isModalFallback: false,
    isConfigurationError: true,
    modalAppInfo: {
      appName: modalCfg.appName,
      workspace: modalCfg.workspace,
      environment: modalCfg.environment,
      functionName: modalCfg.functionName,
      appId: modalCfg.appId
    },
    hasAudioInputSupplied: hasAudioInput,
    videoOnly: !hasAudioInput,
    validation: {
      valid: false,
      renderCompleted: false,
      technicalValidationPassed: false,
      fileSizeBytes: 0,
      formatName: 'none',
      renderedVia: 'Modal Cloud',
      isModalFallback: false,
      hasAudioInputSupplied: hasAudioInput,
      videoOnly: !hasAudioInput,
      video: { valid: false, codec: 'none', pixFmt: 'none', width: 0, height: 0, durationSec: 0, fps: 0, errors: [missingCredsMsg] },
      audio: { valid: false, isAudioPresent: false, errors: [missingCredsMsg] },
      summary: missingCredsMsg,
      errors: [missingCredsMsg]
    },
    error: missingCredsMsg
  };
}



