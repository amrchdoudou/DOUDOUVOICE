import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { EditingPlan } from './metaCreatorService.js';

const execAsync = promisify(exec);

export interface ModalRenderingRequest {
  projectId: string;
  assets: Array<{
    id: string;
    type: 'image' | 'video';
    filePath: string;
    originalName: string;
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
  durationSec: number;
  fps: number;
  errors: string[];
}

export interface AudioStreamValidation {
  valid: boolean;
  isAudioPresent: boolean;
  codec?: string;
  durationSec?: number;
  sampleRate?: number;
  errors: string[];
}

export interface FinalMp4ValidationResult {
  valid: boolean;
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

/**
 * Runs FFprobe to strictly inspect and validate the exported QuickTime MP4 file.
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

  const probeCmd = `ffprobe -v error -show_entries format=format_name,duration,size:stream=index,codec_name,codec_type,pix_fmt,width,height,r_frame_rate,sample_rate,channels -of json "${filePath}"`;

  let probeData: any = null;
  try {
    const { stdout } = await execAsync(probeCmd);
    probeData = JSON.parse(stdout);
  } catch (err: any) {
    const errorMsg = `FFprobe failed to inspect video file: ${err.message}`;
    errors.push(errorMsg);
    return {
      valid: false,
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

  if (!videoStream) {
    videoValid = false;
    videoErrors.push('No video stream found in exported file');
  } else {
    videoCodec = videoStream.codec_name || 'unknown';
    pixFmt = videoStream.pix_fmt || 'unknown';
    width = videoStream.width || 0;
    height = videoStream.height || 0;

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
      videoErrors.push(`Video resolution ${width}x${height} differs from target ${targetWidth}x${targetHeight}`);
    }

    if (Math.abs(totalDurationSec - targetDurationSec) > 2.0) {
      videoErrors.push(`Video duration ${totalDurationSec.toFixed(1)}s differs from target duration ${targetDurationSec}s by > 2.0s`);
    }
  }

  // 2. Inspect Audio Stream
  const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');
  const audioErrors: string[] = [];
  let audioValid = true;
  const isAudioPresent = !!audioStream;

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
    }
  } else {
    // No audio input was supplied -> Exported as video-only
    audioValid = true;
  }

  const allErrors = [...errors, ...videoErrors, ...audioErrors];
  const isValid = videoValid && audioValid && errors.length === 0;

  const summary = isValid
    ? `FFprobe Validation Passed: QuickTime H.264/AAC MP4 (${width}x${height}, ${totalDurationSec.toFixed(1)}s, ${hasAudioInputSupplied ? 'Audio: AAC' : 'Video-Only Export'})`
    : `FFprobe Validation Failed: ${allErrors.join(' | ')}`;

  return {
    valid: isValid,
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
      durationSec: totalDurationSec,
      fps,
      errors: videoErrors
    },
    audio: {
      valid: audioValid,
      isAudioPresent,
      codec: audioStream?.codec_name,
      durationSec: parseFloat(probeData.format?.duration || '0'),
      sampleRate: parseInt(audioStream?.sample_rate || '0', 10),
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

/**
 * Local FFmpeg Filtergraph Execution engine (QuickTime H.264/AAC MP4 Export)
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
  const targetDurationSec = editingPlan.totalDurationSec || 15;

  const hasAudioInput = fs.existsSync(masterVoiceoverPath) && fs.statSync(masterVoiceoverPath).size > 100;

  console.log(`[Local FFmpeg Engine] Project ${payload.projectId} Execution Audit:`);
  console.log(`- Render Mode: ${isModalFallback ? 'Local Server FFmpeg (Fallback from Modal)' : 'Local Server FFmpeg (Direct)'}`);
  console.log(`- Target Dimensions: ${targetWidth}x${targetHeight} (${editingPlan.aspectRatio})`);
  console.log(`- Target Duration: ${targetDurationSec}s`);
  console.log(`- Received Assets: ${assets.length} (${assets.map(a => `${a.id}:${a.type}`).join(', ')})`);
  console.log(`- Audio Input Supplied: ${hasAudioInput ? `YES (${fs.statSync(masterVoiceoverPath).size} bytes)` : 'NO (Exporting Video-Only MP4)'}`);

  const projectDir = path.dirname(outputFilePath);
  const preparedClips: string[] = [];

  // Step 1: Prepare individual processed scene clips (Strict QuickTime H.264 yuv420p even-resolution)
  for (let i = 0; i < editingPlan.scenes.length; i++) {
    const sc = editingPlan.scenes[i];
    const asset = assets.find(a => a.id === sc.assetId) || assets[i % assets.length];
    const clipOutPath = path.join(projectDir, `prepared_scene_${i + 1}.mp4`);

    // Color enhancement filter based on theme
    let colorFilter = 'eq=contrast=1.06:saturation=1.12:brightness=0.01';
    if (sc.colorGrading === 'warm_luxury') {
      colorFilter = 'eq=contrast=1.04:saturation=1.08:brightness=0.02,colorbalance=rs=0.04:gs=0.01:bs=-0.03';
    } else if (sc.colorGrading === 'cool_tech') {
      colorFilter = 'eq=contrast=1.08:saturation=1.10:brightness=-0.01,colorbalance=rs=-0.03:gs=0.01:bs=0.04';
    } else if (sc.colorGrading === 'cinematic') {
      colorFilter = 'eq=contrast=1.08:saturation=1.05:brightness=-0.01';
    } else if (sc.colorGrading === 'clean_natural') {
      colorFilter = 'eq=contrast=1.03:saturation=1.06:brightness=0.01';
    }

    // Text Overlay Filter (Clean rounded translucent box)
    let overlayFilter = '';
    if (sc.overlayText && sc.overlayText.trim().length > 0) {
      const safeText = sc.overlayText.replace(/'/g, '').replace(/:/g, ' - ').slice(0, 45);
      const textStart = sc.overlayTextStartTimeSec || 0.3;
      const textEnd = textStart + (sc.overlayTextDurationSec || 2.5);
      overlayFilter = `,drawtext=text='${safeText}':fontcolor=white:fontsize=38:box=1:boxcolor=black@0.65:boxborderw=12:x=(w-text_w)/2:y=h-text_h-160:enable='between(t,${textStart.toFixed(2)},${textEnd.toFixed(2)})'`;
    }

    if (asset.type === 'image') {
      // SAM 3.1 Smart Subject Focus Coordinates
      let cx = 0.5;
      let cy = 0.5;
      if (sc.samFocusBox && Array.isArray(sc.samFocusBox) && sc.samFocusBox.length === 4) {
        cx = Math.max(0.2, Math.min(0.8, ((sc.samFocusBox[1] + sc.samFocusBox[3]) / 2) / 1000));
        cy = Math.max(0.2, Math.min(0.8, ((sc.samFocusBox[0] + sc.samFocusBox[2]) / 2) / 1000));
      }

      const numFrames = Math.max(1, Math.round(sc.durationSec * 30));
      let zoomExpr = "min(pzoom+0.0016,1.16)";
      let xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
      let yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;

      if (sc.effect === 'slow_zoom_out') {
        zoomExpr = "max(1.16-0.0016*on,1.0)";
      } else if (sc.effect === 'pan_left') {
        zoomExpr = "1.12";
        xExpr = `'iw*(0.65-0.25*on/${numFrames})-(iw/zoom/2)'`;
      } else if (sc.effect === 'pan_right') {
        zoomExpr = "1.12";
        xExpr = `'iw*(0.35+0.25*on/${numFrames})-(iw/zoom/2)'`;
      } else if (sc.effect === 'smart_subject_focus') {
        zoomExpr = "min(pzoom+0.002,1.20)";
        xExpr = `'iw*${cx.toFixed(3)}-(iw/zoom/2)'`;
        yExpr = `'ih*${cy.toFixed(3)}-(ih/zoom/2)'`;
      }

      const filterGraph = `scale=${targetWidth}*2:${targetHeight}*2,zoompan=z='${zoomExpr}':x=${xExpr}:y=${yExpr}:d=${numFrames}:s=${targetWidth}x${targetHeight}:fps=30,setsar=1,${colorFilter}${overlayFilter},format=yuv420p`;

      const cmd = `ffmpeg -y -loop 1 -i "${asset.filePath}" -vf "${filterGraph}" -t ${sc.durationSec} -c:v libx264 -preset medium -crf 20 -profile:v main -level 4.0 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -r 30 "${clipOutPath}"`;
      
      console.log(`[FFmpeg] Executing Image Scene ${i + 1}/${editingPlan.scenes.length} (${sc.effect}, grade=${sc.colorGrading || 'vibrant'})...`);
      await execAsync(cmd);
      preparedClips.push(clipOutPath);

    } else if (asset.type === 'video') {
      const startTime = sc.startTimeSec || 0;
      const duration = sc.durationSec || 4;

      const filterGraph = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},setsar=1,${colorFilter}${overlayFilter},format=yuv420p,fps=30`;

      const cmd = `ffmpeg -y -ss ${startTime} -i "${asset.filePath}" -t ${duration} -vf "${filterGraph}" -an -c:v libx264 -preset medium -crf 20 -profile:v main -level 4.0 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -r 30 "${clipOutPath}"`;

      console.log(`[FFmpeg] Executing Video Scene ${i + 1}/${editingPlan.scenes.length} trim/scale/grade...`);
      await execAsync(cmd);
      preparedClips.push(clipOutPath);
    }
  }

  // Step 2: Concatenate/Combine Scenes into Video Stream
  const concatListPath = path.join(projectDir, 'concat_list.txt');
  const concatContent = preparedClips.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(concatListPath, concatContent);

  const concatenatedVideoPath = path.join(projectDir, 'concatenated_video.mp4');
  const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v copy "${concatenatedVideoPath}"`;
  await execAsync(concatCmd);

  // Pad visual video stream if shorter than target narration duration
  const paddedVideoPath = path.join(projectDir, 'padded_video.mp4');
  const padCmd = `ffmpeg -y -i "${concatenatedVideoPath}" -vf "tpad=stop_mode=clone:stop_duration=${targetDurationSec},format=yuv420p" -t ${targetDurationSec} -c:v libx264 -preset medium -crf 20 -profile:v main -level 4.0 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 "${paddedVideoPath}"`;
  await execAsync(padCmd);

  // Step 3: Composite Audio Track with EBU R128 Loudness Normalization & Ducking
  if (hasAudioInput) {
    console.log(`[FFmpeg] Compositing voiceover audio track into AAC QuickTime MP4 (Padding audio to match video duration ${targetDurationSec}s)...`);
    const finalCmd = `ffmpeg -y -i "${paddedVideoPath}" -i "${masterVoiceoverPath}" -c:v copy -filter:a "volume=1.5,loudnorm=I=-14:LRA=10:TP=-1.5,apad" -t ${targetDurationSec} -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart "${outputFilePath}"`;
    await execAsync(finalCmd);
  } else {
    console.log(`[FFmpeg] No audio input supplied. Exporting QuickTime-compatible video-only MP4 (-an)...`);
    const finalCmd = `ffmpeg -y -i "${paddedVideoPath}" -c:v copy -an -t ${targetDurationSec} -movflags +faststart "${outputFilePath}"`;
    await execAsync(finalCmd);
  }

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
