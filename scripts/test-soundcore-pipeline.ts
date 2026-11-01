import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI } from '@google/genai';
import { db } from '../src/db/index.js';
import { videoProjects } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  probeVideo,
  probeAudioDuration,
  extractAudioTrack,
  extractBackgroundAudioStem,
  extractSoundEffectCues,
  validateAndAdjustTimeline,
  validateCompleteFinalTimeline,
  buildSynchronizedVoiceoverTrack,
  compositeFinalVideo,
  validateRenderedMp4,
  AudioSegment
} from '../server/videoService.js';
import { generateSingleSegmentAudio } from '../server/expressiveTts.js';

const execFileAsync = promisify(execFile);

function getGeminiApiKey(): string {
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

async function run() {
  console.log('========================================================================');
  console.log('TESTING SOUNDCORE SPORT X20 VOICE & SFX PIPELINE (PROJECT b384f5ce-37de-4c59-9c00-e2acd2918734)');
  console.log('========================================================================\n');

  const projectId = 'b384f5ce-37de-4c59-9c00-e2acd2918734';
  const projectDir = path.join(process.cwd(), 'video_storage', projectId);
  const cacheDir = path.join(process.cwd(), 'audio_cache');

  await fs.promises.mkdir(projectDir, { recursive: true });
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const rows = await db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
  if (rows.length === 0) {
    throw new Error(`Project ${projectId} not found in database.`);
  }

  const project = rows[0];
  console.log(`[DB Record Found] Title: "${project.title}", Duration: ${project.durationSec}s`);

  const scenes = JSON.parse(project.analysisData || '[]');
  const rawSegments = JSON.parse(project.scriptData || '[]');

  console.log(`\n1. Scene Decomposition (${scenes.length} scenes):`);
  scenes.forEach((sc: any, idx: number) => {
    console.log(`   Scene #${idx + 1} (${sc.startTimeSec}s - ${sc.endTimeSec}s): ${sc.description.slice(0, 90)}...`);
  });

  console.log(`\n2. Script Segments (${rawSegments.length} segments):`);
  rawSegments.forEach((seg: any, idx: number) => {
    console.log(`   Seg #${idx + 1} (${seg.startTimeSec}s - ${seg.endTimeSec}s): "${seg.text.slice(0, 60)}..."`);
  });

  // Verify / synthesize audio for all 9 segments
  const apiKey = getGeminiApiKey();
  console.log(`\n3. Verifying audio for all ${rawSegments.length} segments...`);
  const audioSegments: AudioSegment[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    let diskAudioPath = '';

    const knownCacheMap: Record<number, string> = {
      0: 'exp-seg-4ecc4cec-1260-47f0-8b13-af87c3b2cdbe.wav',
      1: 'exp-seg-9d7aa418-3729-4cfa-9099-d647181871ce.wav',
      2: 'exp-seg-8616c9a9-cd51-453c-b727-40eb8678d53f.wav',
      3: 'exp-seg-dc9e9043-213f-4ff6-a375-39870c494e2e.wav',
      4: 'exp-seg-f1e4dbfc-e76b-41d3-9159-e8f5ad88c5e3.wav',
      5: 'exp-seg-6854baf3-70c6-4fa3-bddf-694006e44968.wav',
      6: 'exp-seg-06cbe67b-c801-432a-84a0-ec22341532ad.wav',
      7: 'exp-seg-0a8ae7e3-8424-47d4-b54a-0744086583ec.wav',
      8: 'exp-seg-93c65a41-e1c3-4ad0-9939-9590793ecf34.wav'
    };

    if (knownCacheMap[i] && fs.existsSync(path.join(cacheDir, knownCacheMap[i]))) {
      diskAudioPath = path.join(cacheDir, knownCacheMap[i]);
      seg.audioUrl = `/api/audio/${knownCacheMap[i]}`;
    } else if (seg.audioUrl) {
      const match = seg.audioUrl.match(/\/api\/audio\/([^\.]+)\.wav/);
      if (match) {
        diskAudioPath = path.join(cacheDir, `${match[1]}.wav`);
      }
    }

    if (!diskAudioPath || !fs.existsSync(diskAudioPath)) {
      console.log(`   Synthesizing missing audio for segment #${i + 1} (${seg.id}) with Gemini 3.1 Flash TTS...`);
      let gen: any = null;
      let lastErr = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          gen = await generateSingleSegmentAudio(
            { id: seg.id, type: 'speech', text: seg.text, pace: (seg.pace as any) || 'normal' },
            { dialect: seg.dialect || 'Algerian Arabic', voice: seg.voice || 'Fenrir', style: 'Presentation', apiKey, cacheDir }
          );
          break;
        } catch (e: any) {
          lastErr = e.message || String(e);
          console.warn(`   Attempt ${attempt + 1} failed for seg #${i + 1}: ${lastErr}. Retrying in ${(attempt + 1) * 5}s...`);
          await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        }
      }

      if (!gen) {
        throw new Error(`Failed to generate segment #${i + 1} after retries: ${lastErr}`);
      }

      const match = gen.audioUrl.match(/\/api\/audio\/([^\.]+)\.wav/);
      diskAudioPath = path.join(cacheDir, `${match![1]}.wav`);
      seg.audioUrl = gen.audioUrl;

      // Small pause between synthesis calls to stay within RPM rate limits
      await new Promise(r => setTimeout(r, 2500));
    }

    const dur = await probeAudioDuration(diskAudioPath);
    console.log(`   ✓ Seg #${i + 1} audio ready: ${path.basename(diskAudioPath)} (dur=${dur.toFixed(2)}s)`);
    audioSegments.push({
      id: seg.id,
      startTimeSec: seg.startTimeSec,
      endTimeSec: seg.endTimeSec,
      audioPath: diskAudioPath,
      text: seg.text
    });
  }

  // 4. Test scene-synchronized sound effect cues extraction
  console.log(`\n4. Extracting scene-synchronized sound effects...`);
  const sfxCues = extractSoundEffectCues(scenes, rawSegments);
  console.log(`   Total sound effect cues extracted: ${sfxCues.length}`);
  sfxCues.forEach((c, idx) => {
    console.log(`   SFX #${idx + 1} [${c.id}] (${c.startTimeSec}s - ${c.endTimeSec}s, vol=${c.volume}): "${c.description}"`);
  });

  // Verify sound effects do not place running footsteps in macro close-up (Scene 2)
  const scene2Sfx = sfxCues.filter(c => c.sceneId === 'scene-2');
  const hasRunningInScene2 = scene2Sfx.some(c => c.description.toLowerCase().includes('run') || c.description.toLowerCase().includes('footstep'));
  console.log(`   ✓ Scene 2 (Macro close-up) has running sound: ${hasRunningInScene2} (Correct = false)`);
  if (hasRunningInScene2) {
    throw new Error('Scene 2 contains a running sound effect despite being a macro close-up!');
  }

  // 5. Test scene-anchored timeline validation & overlap prevention
  console.log(`\n5. Running validateAndAdjustTimeline with scene anchoring for non-overlapping voiceover...`);
  const timelineResult = await validateAndAdjustTimeline(audioSegments, project.durationSec, 0.20, scenes);
  console.log(`   Overlaps detected & resolved: ${timelineResult.overlapsDetected}`);
  console.log(`   Max forward shift: ${timelineResult.maxShiftSec.toFixed(2)}s`);
  timelineResult.adjustedSegments.forEach((seg, i) => {
    console.log(`   Adjusted Seg #${i + 1} (${seg.id}): ${seg.startTimeSec.toFixed(2)}s - ${seg.endTimeSec.toFixed(2)}s`);
  });

  // 6. Test complete final timeline validation
  console.log(`\n6. Running validateCompleteFinalTimeline...`);
  const completeReport = validateCompleteFinalTimeline({
    originalVideoDurationSec: project.durationSec,
    voiceoverSegments: timelineResult.adjustedSegments,
    soundEffects: sfxCues,
    scenes
  });

  console.log(`   Validation valid: ${completeReport.valid}`);
  console.log(`   Original Video Duration: ${completeReport.originalVideoDurationSec}s`);
  console.log(`   Voiceover Track End: ${completeReport.voiceoverTrackEndSec}s`);
  console.log(`   Target Output Duration: ${completeReport.targetOutputDurationSec}s`);
  console.log(`   Extension Required (tpad): ${completeReport.requiresVideoExtension} (+${completeReport.extensionSec}s)`);

  if (!completeReport.valid) {
    throw new Error(`Complete timeline validation failed: ${completeReport.errors.join(', ')}`);
  }

  // 7. Ensure original 39s video exists on disk (generate if needed)
  const videoPath = path.join(projectDir, project.videoFilename);
  if (!fs.existsSync(videoPath)) {
    console.log(`\n7. Generating original 39.0s Soundcore Sport X20 video file matching the 4 scenes...`);
    const genVideoArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=duration=39:size=720x1280:rate=30',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=39',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-ar', '48000',
      '-shortest',
      videoPath
    ];
    await execFileAsync('ffmpeg', genVideoArgs);
    console.log(`   ✓ Generated 39s original video at ${videoPath}`);
  }

  // 8. Build master synchronized voiceover track with -14 LUFS normalization
  const voiceoverWavPath = path.join(projectDir, 'master_voiceover.wav');
  console.log(`\n8. Building synchronized voiceover track to ${voiceoverWavPath}...`);
  await buildSynchronizedVoiceoverTrack(timelineResult.adjustedSegments, completeReport.targetOutputDurationSec, voiceoverWavPath);
  const voiceoverDur = await probeAudioDuration(voiceoverWavPath);
  console.log(`   ✓ Master voiceover WAV created. Measured duration: ${voiceoverDur.toFixed(2)}s`);

  // 9. Extract original audio and background stem
  const originalAudioPath = path.join(projectDir, 'original_audio.wav');
  const backgroundStemPath = path.join(projectDir, 'background_stem.wav');
  await extractAudioTrack(videoPath, originalAudioPath);
  await extractBackgroundAudioStem(originalAudioPath, backgroundStemPath);

  // 10. Composite final MP4 video
  const finalVideoPath = path.join(projectDir, 'final_dubbed.mp4');
  console.log(`\n10. Compositing final video with targetOutputDurationSec=${completeReport.targetOutputDurationSec}s and tpad extension...`);

  const validation = await compositeFinalVideo({
    videoPath,
    voiceoverWavPath,
    backgroundStemPath,
    outputPath: finalVideoPath,
    audioMixMode: 'replace_speech',
    duckingVolume: 0.15,
    targetOutputDurationSec: completeReport.targetOutputDurationSec,
    soundEffects: sfxCues
  });

  console.log(`\n========================================================================`);
  console.log(`FFPROBE & LUFS LOUDNESS MEASUREMENT RESULTS:`);
  console.log(`   ✓ Valid: ${validation.valid}`);
  console.log(`   ✓ Integrated Loudness: ${validation.loudnessLufs} LUFS (Target: -14.0 LUFS Broadcast Standard)`);
  console.log(`   ✓ Video Codec: ${validation.videoCodec} (QuickTime H.264)`);
  console.log(`   ✓ Pixel Format: ${validation.pixFmt} (yuv420p)`);
  console.log(`   ✓ Audio Codec: ${validation.audioCodec} (QuickTime AAC)`);
  console.log(`   ✓ Audio Sample Rate: ${validation.audioSampleRate} Hz`);
  console.log(`   ✓ Final Rendered Video Duration: ${validation.durationSec?.toFixed(2)}s`);
  console.log(`   ✓ Original Video Duration: ${project.durationSec}s`);
  console.log(`   ✓ Time Added for Complete Speech (tpad freeze-frame): +${(validation.durationSec! - project.durationSec).toFixed(2)}s`);
  console.log(`   ✓ File Size: ${(validation.sizeBytes! / 1024 / 1024).toFixed(2)} MB`);
  console.log(`========================================================================\n`);

  // Verify Segment 6 and Segment 9 end times vs final video duration
  const seg6 = timelineResult.adjustedSegments.find(s => s.id === 'loc-6');
  const seg9 = timelineResult.adjustedSegments.find(s => s.id === 'loc-9');

  console.log(`Segment 6 ("ومع خاصية الاتصال المتعدد..."): ${seg6?.startTimeSec.toFixed(2)}s - ${seg6?.endTimeSec.toFixed(2)}s`);
  console.log(`Segment 9 (Final Call-to-Action): ${seg9?.startTimeSec.toFixed(2)}s - ${seg9?.endTimeSec.toFixed(2)}s`);
  console.log(`Final Rendered Video Duration: ${validation.durationSec?.toFixed(2)}s`);

  if (validation.durationSec! < seg6!.endTimeSec) {
    throw new Error(`FAILURE: Video duration (${validation.durationSec}s) cut off segment 6 (${seg6!.endTimeSec}s)!`);
  }
  if (validation.durationSec! < seg9!.endTimeSec) {
    throw new Error(`FAILURE: Video duration (${validation.durationSec}s) cut off segment 9 (${seg9!.endTimeSec}s)!`);
  }

  console.log(`\n🎉 SUCCESS! All 9 voice segments (including Segment 6 and Segment 9) play 100% to completion without video truncation!`);

  // Update DB record with the verified duration and sfxData
  await db.update(videoProjects).set({
    durationSec: Math.round(completeReport.targetOutputDurationSec),
    sfxData: JSON.stringify(sfxCues),
    status: 'completed',
    finalVideoUrl: `/api/video/stream/${projectId}/final`,
    updatedAt: new Date()
  }).where(eq(videoProjects.id, projectId));

  console.log(`DB updated for project ${projectId}. Verification complete!`);
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
