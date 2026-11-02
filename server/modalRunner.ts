import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EditingPlan, MAX_SLOWDOWN_FACTOR } from './metaCreatorService.js';
import {
  writeCreatorAssFile,
  escapeFfmpegFilterPath,
  AssOverlayCue,
  AssSubtitleCue
} from './assSubtitleBuilder.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
  circleopen: 'circleopen',
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
    durationSec?: number;
  }>;
  editingPlan: EditingPlan;
  masterVoiceoverPath: string;
  outputFilePath: string;
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

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      },
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
async function executeLocalFfmpegPipeline(
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
      let zoomExpr = `1.0+0.14*on/${K_prime_i}`;
      let xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
      let yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

      if (sc.effect === 'slow_zoom_out') {
        zoomExpr = `1.14-0.14*on/${K_prime_i}`;
      } else if (sc.effect === 'pan_left') {
        zoomExpr = '1.12';
        const startX = Math.min(0.68, cx + 0.10);
        xExpr = `'iw*(${startX.toFixed(3)}-0.20*on/${K_prime_i})-(iw/zoom/2)'`;
      } else if (sc.effect === 'pan_right') {
        zoomExpr = '1.12';
        const startX = Math.max(0.32, cx - 0.10);
        xExpr = `'iw*(${startX.toFixed(3)}+0.20*on/${K_prime_i})-(iw/zoom/2)'`;
      } else if (sc.effect === 'smart_subject_focus') {
        zoomExpr = `1.0+0.16*on/${K_prime_i}`;
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

      console.log(`[FFmpeg] Prepared Image Scene ${i + 1}/${N} (${K_prime_i} frames, effect=${sc.effect}, focus=(${cx.toFixed(2)},${cy.toFixed(2)}), out=${sc.transitionOut})...`);
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
 * Main Entry Point for FFmpeg Execution Runner (Modal Cloud Remote with Local Fallback & Strict Validation)
 */
export async function executeModalRendering(
  payload: ModalRenderingRequest
): Promise<ModalRenderingResult> {
  const modalWebhookUrl = process.env.MODAL_WEBHOOK_URL;
  const modalApiKey = process.env.MODAL_API_KEY || '';

  if (modalWebhookUrl && modalWebhookUrl.trim().length > 0) {
    const cloudResult = await callModalCloudApi(modalWebhookUrl, modalApiKey, payload);
    if (cloudResult && cloudResult.success) {
      return cloudResult;
    }
  }

  // Fallback to Local Server FFmpeg Execution Engine
  const isFallback = Boolean(modalWebhookUrl && modalWebhookUrl.trim().length > 0);
  return await executeLocalFfmpegPipeline(payload, isFallback);
}


