import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import wave from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  recalculateCompleteEditingTimeline,
  buildCreatorSynchronizedVoiceover,
  MAX_SLOWDOWN_FACTOR,
  EditingPlan
} from './metaCreatorService.js';
import { executeModalRendering, inspectAndValidateMp4 } from './modalRunner.js';
import { writeCreatorAssFile, escapeFfmpegFilterPath } from './assSubtitleBuilder.js';
import {
  validateAndAdjustTimeline,
  buildSynchronizedVoiceoverTrack,
  compositeFinalVideo
} from './videoService.js';

const execFileAsync = promisify(execFile);

async function extractRawRgbFrames(
  videoPath: string,
  width: number,
  height: number
): Promise<Buffer[]> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', videoPath,
      '-vf', `scale=${width}:${height}`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ],
    { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 }
  );

  const frameBytes = width * height * 3;
  const count = Math.floor(stdout.length / frameBytes);
  const frames: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(stdout.subarray(i * frameBytes, (i + 1) * frameBytes));
  }
  return frames;
}

function computeFrameMeanRgb(frame: Buffer): { r: number; g: number; b: number } {
  const pixels = frame.length / 3;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < frame.length; i += 3) {
    r += frame[i];
    g += frame[i + 1];
    b += frame[i + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

function computeFrameMad(frameA: Buffer, frameB: Buffer): number {
  const len = Math.min(frameA.length, frameB.length);
  if (len === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < len; i++) {
    sumDiff += Math.abs(frameA[i] - frameB[i]);
  }
  return sumDiff / len;
}

function computeWavWindowRmsDb(wavBuffer: Buffer, startSec: number, endSec: number, sampleRate = 24000): number {
  const dataOffset = 44;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(Math.floor((wavBuffer.length - dataOffset) / 2), Math.floor(endSec * sampleRate));
  if (endSample <= startSample) return -180;

  let sumSq = 0;
  const count = endSample - startSample;
  for (let i = startSample; i < endSample; i++) {
    const sample = wavBuffer.readInt16LE(dataOffset + i * 2) / 32768.0;
    sumSq += sample * sample;
  }
  const rms = Math.sqrt(sumSq / count);
  return 20 * Math.log10(Math.max(rms, 1e-9));
}

async function generateSolidImage(filePath: string, color: string, width = 320, height = 568): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=${width}x${height}:d=1`,
    '-frames:v', '1',
    filePath
  ]);
}

async function generateSyntheticMovingVideo(
  filePath: string,
  durationSec: number,
  width = 320,
  height = 568
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=s=${width}x${height}:r=30:d=${durationSec.toFixed(3)}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    filePath
  ]);
}

async function generateSineWav(filePath: string, durationSec: number, freqHz = 440): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `sine=f=${freqHz}:r=24000:d=${durationSec.toFixed(3)}`,
    '-af', 'volume=-12dB',
    '-ar', '24000',
    '-ac', '1',
    filePath
  ]);
}

async function runP0Tests() {
  console.log('================================================================');
  console.log('Running P0 Autonomous Video Editing Verification Suite (T1 - T7)');
  console.log('================================================================\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doudou-p0-test-'));

  try {
    // =========================================================================
    // TEST T1: Mixed Transitions (xfade + transitionOut = 'none') & Exact 30 FPS Frame Boundaries
    // =========================================================================
    console.log('[T1] Testing Mixed Transitions (xfade + transitionOut = "none") & Exact 30 FPS Frame Boundaries...');
    const t1Dir = path.join(tmpRoot, 't1');
    fs.mkdirSync(t1Dir, { recursive: true });

    const redImg = path.join(t1Dir, 'red.png');
    const greenImg = path.join(t1Dir, 'green.png');
    const blueImg = path.join(t1Dir, 'blue.png');
    const yellowImg = path.join(t1Dir, 'yellow.png');
    await Promise.all([
      generateSolidImage(redImg, 'red', 320, 180),
      generateSolidImage(greenImg, 'green', 320, 180),
      generateSolidImage(blueImg, 'blue', 320, 180),
      generateSolidImage(yellowImg, 'yellow', 320, 180)
    ]);

    const t1Assets = [
      { id: 'a_red', type: 'image' as const, filePath: redImg, originalName: 'red.png', mimeType: 'image/png' },
      { id: 'a_green', type: 'image' as const, filePath: greenImg, originalName: 'green.png', mimeType: 'image/png' },
      { id: 'a_blue', type: 'image' as const, filePath: blueImg, originalName: 'blue.png', mimeType: 'image/png' },
      { id: 'a_yellow', type: 'image' as const, filePath: yellowImg, originalName: 'yellow.png', mimeType: 'image/png' }
    ];

    // 4 scenes: 1.5s (45f), 1.5s (45f), 1.5s (45f), 1.5s (45f) = 6.000s (180 frames)
    // Scene 0 -> 1: crossfade (M_0 = 10f)
    // Scene 1 -> 2: none (M_1 = 0f, hard cut at frame 90 / 3.000s)
    // Scene 2 -> 3: wipeleft (M_2 = 10f)
    // Scene 3: none (M_3 = 0f)
    const t1Recalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'crossfade', colorGrading: 'clean_natural' },
        { assetId: 'a_green', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'none', colorGrading: 'clean_natural' },
        { assetId: 'a_blue', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'wipeleft', colorGrading: 'clean_natural' },
        { assetId: 'a_yellow', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'crossfade', colorGrading: 'clean_natural' }
      ],
      assets: t1Assets,
      analysis: [],
      audioSegments: [],
      targetDurationSec: 6.0
    });

    assert.equal(t1Recalc.totalFrames, 180, 'T1 totalFrames must be 180');
    assert.deepEqual(t1Recalc.scenes.map(s => s.nominalFrames), [45, 45, 45, 45]);
    assert.deepEqual(t1Recalc.scenes.map(s => s.transitionFrames), [10, 0, 10, 0]);
    assert.deepEqual(t1Recalc.scenes.map(s => s.preparedClipFrames), [55, 45, 55, 45]);
    assert.equal(t1Recalc.scenes[3].transitionOut, 'none', 'Final scene must have transitionOut = "none"');

    const t1Plan: EditingPlan = {
      totalDurationSec: t1Recalc.totalDurationSec,
      totalFrames: t1Recalc.totalFrames,
      aspectRatio: '16:9',
      resolution: { width: 320, height: 180 },
      scenes: t1Recalc.scenes,
      audio: { voiceoverVolume: 1.4, backgroundMusicVolume: 0.15, ducking: true },
      subtitles: []
    };

    const t1OutMp4 = path.join(t1Dir, 't1_final.mp4');
    const t1Res = await executeModalRendering({
      projectId: 'test_t1',
      assets: t1Assets,
      editingPlan: t1Plan,
      masterVoiceoverPath: '',
      outputFilePath: t1OutMp4
    });

    assert.equal(t1Res.success, true, `T1 render failed: ${t1Res.error}`);
    assert.equal(t1Res.validation.video.nbFrames, 180, 'T1 final MP4 must have exactly 180 frames');
    assert.ok(Math.abs(t1Res.validation.video.durationSec - 6.0) < 0.04, `T1 duration ${t1Res.validation.video.durationSec}s !== 6.0s`);

    const t1Frames = await extractRawRgbFrames(t1OutMp4, 64, 36);
    assert.equal(t1Frames.length, 180, 'T1 decoded frame count must be 180');

    // Frame 44 (last frame before xfade 0->1 at offset 45): Pure Red
    const f44 = computeFrameMeanRgb(t1Frames[44]);
    // Frame 50 (mid-xfade 0->1): Blend of Red & Green
    const f50 = computeFrameMeanRgb(t1Frames[50]);
    // Frame 56 (after xfade 0->1 completes at frame 55): Pure Green
    const f56 = computeFrameMeanRgb(t1Frames[56]);
    // Frame 89 (last frame of Scene 1 before hard cut at frame 90): Pure Green
    const f89 = computeFrameMeanRgb(t1Frames[89]);
    // Frame 90 (first frame of Scene 2 after hard cut): Pure Blue (0 blended frames!)
    const f90 = computeFrameMeanRgb(t1Frames[90]);
    // Frame 134 (last frame of Scene 2 before wipeleft at frame 135): Pure Blue
    const f134 = computeFrameMeanRgb(t1Frames[134]);
    // Frame 140 (mid-wipeleft 2->3): Blend of Blue & Yellow
    const f140 = computeFrameMeanRgb(t1Frames[140]);
    // Frame 146 (after wipeleft 2->3 completes): Pure Yellow
    const f146 = computeFrameMeanRgb(t1Frames[146]);

    assert.ok(f44.r > 200 && f44.g < 30, `Frame 44 expected Red, got R=${f44.r.toFixed(1)} G=${f44.g.toFixed(1)}`);
    assert.ok(f50.r > 50 && f50.r < 200 && f50.g > 30, `Frame 50 expected Red-Green xfade blend, got R=${f50.r.toFixed(1)} G=${f50.g.toFixed(1)}`);
    assert.ok(f56.g > 100 && f56.r < 30, `Frame 56 expected Green, got R=${f56.r.toFixed(1)} G=${f56.g.toFixed(1)}`);
    assert.ok(f89.g > 100 && f89.b < 30, `Frame 89 expected pure Green before hard cut, got G=${f89.g.toFixed(1)} B=${f89.b.toFixed(1)}`);
    assert.ok(f90.b > 200 && f90.g < 30, `Frame 90 expected immediate pure Blue after hard cut, got G=${f90.g.toFixed(1)} B=${f90.b.toFixed(1)}`);
    assert.ok(f134.b > 200 && f134.r < 30, `Frame 134 expected Blue, got B=${f134.b.toFixed(1)}`);
    assert.ok(f140.b > 40 && f140.r > 40, `Frame 140 expected Blue-Yellow wipeleft blend, got R=${f140.r.toFixed(1)} B=${f140.b.toFixed(1)}`);
    assert.ok(f146.r > 200 && f146.g > 200 && f146.b < 30, `Frame 146 expected Yellow, got R=${f146.r.toFixed(1)} G=${f146.g.toFixed(1)} B=${f146.b.toFixed(1)}`);
    console.log('  -> PASS: T1 Mixed xfade + concat hard cut verified (180/180 frames, 6.000s, exact frame boundaries).\n');

    // =========================================================================
    // TEST T2: All-Hard-Cut (transitionOut = 'none') Pipeline
    // =========================================================================
    console.log('[T2] Testing All-Hard-Cut (transitionOut = "none") Pipeline...');
    const t2Dir = path.join(tmpRoot, 't2');
    fs.mkdirSync(t2Dir, { recursive: true });

    const t2Recalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'none', colorGrading: 'clean_natural' },
        { assetId: 'a_green', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'none', colorGrading: 'clean_natural' },
        { assetId: 'a_blue', type: 'image', durationSec: 1.5, effect: 'static', transitionOut: 'none', colorGrading: 'clean_natural' }
      ],
      assets: t1Assets.slice(0, 3),
      analysis: [],
      audioSegments: [],
      targetDurationSec: 4.5
    });

    assert.equal(t2Recalc.totalFrames, 135);
    assert.deepEqual(t2Recalc.scenes.map(s => s.transitionFrames), [0, 0, 0]);
    assert.deepEqual(t2Recalc.scenes.map(s => s.preparedClipFrames), [45, 45, 45]);

    const t2OutMp4 = path.join(t2Dir, 't2_final.mp4');
    const t2Res = await executeModalRendering({
      projectId: 'test_t2',
      assets: t1Assets.slice(0, 3),
      editingPlan: {
        totalDurationSec: t2Recalc.totalDurationSec,
        totalFrames: t2Recalc.totalFrames,
        aspectRatio: '16:9',
        resolution: { width: 320, height: 180 },
        scenes: t2Recalc.scenes,
        audio: { voiceoverVolume: 1.4, backgroundMusicVolume: 0.15, ducking: true },
        subtitles: []
      },
      masterVoiceoverPath: '',
      outputFilePath: t2OutMp4
    });

    assert.equal(t2Res.success, true);
    assert.equal(t2Res.validation.video.nbFrames, 135);
    const t2Frames = await extractRawRgbFrames(t2OutMp4, 64, 36);
    assert.ok(computeFrameMeanRgb(t2Frames[44]).r > 200 && computeFrameMeanRgb(t2Frames[45]).g > 100, 'Hard cut 0->1 at frame 44->45 must be instantaneous');
    assert.ok(computeFrameMeanRgb(t2Frames[89]).g > 100 && computeFrameMeanRgb(t2Frames[90]).b > 200, 'Hard cut 1->2 at frame 89->90 must be instantaneous');
    console.log('  -> PASS: T2 All-Hard-Cut pipeline verified (135/135 frames, 4.500s, zero blended frames).\n');

    // =========================================================================
    // TEST T3: Voiceover Mapping (M != N, Silent Scenes, Speech > Scene, Expansion Cap, Uniform Gain)
    // =========================================================================
    console.log('[T3] Testing Voiceover Mapping (M>N, M<N, Speech>Scene Full Recalc, Expansion Cap, Uniform Gain)...');
    const t3Dir = path.join(tmpRoot, 't3');
    fs.mkdirSync(t3Dir, { recursive: true });

    // T3a: M > N (5 segments across 3 scenes)
    const t3aRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 4.0, transitionOut: 'crossfade' },
        { assetId: 'a_green', type: 'image', durationSec: 4.0, transitionOut: 'crossfade' },
        { assetId: 'a_blue', type: 'image', durationSec: 4.0, transitionOut: 'none' }
      ],
      assets: t1Assets.slice(0, 3),
      analysis: [],
      audioSegments: [
        { id: 's1', text: 'Seg 1', filePath: '', durationSec: 1.2 },
        { id: 's2', text: 'Seg 2', filePath: '', durationSec: 1.2 },
        { id: 's3', text: 'Seg 3', filePath: '', durationSec: 1.2 },
        { id: 's4', text: 'Seg 4', filePath: '', durationSec: 1.2 },
        { id: 's5', text: 'Seg 5', filePath: '', durationSec: 1.2 }
      ],
      targetDurationSec: 12.0
    });
    assert.equal(t3aRecalc.synchronizedSegments.length, 5);
    for (let k = 1; k < t3aRecalc.synchronizedSegments.length; k++) {
      const gap = t3aRecalc.synchronizedSegments[k].startTimeSec - t3aRecalc.synchronizedSegments[k - 1].endTimeSec;
      assert.ok(gap >= 0.179, `T3a segment ${k} overlapped previous segment (gap=${gap.toFixed(3)}s)`);
    }

    // T3b: M < N (2 segments mapped to Scene 0 & Scene 2, leaving Scene 1 silent) + Uniform Gain Check
    const wavSeg1 = path.join(t3Dir, 'seg1.wav');
    const wavSeg2 = path.join(t3Dir, 'seg2.wav');
    await Promise.all([
      generateSineWav(wavSeg1, 1.2, 440),
      generateSineWav(wavSeg2, 1.2, 440)
    ]);

    const t3bRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 3.0, transitionOut: 'crossfade' },
        { assetId: 'a_green', type: 'image', durationSec: 3.0, transitionOut: 'crossfade' },
        { assetId: 'a_blue', type: 'image', durationSec: 3.0, transitionOut: 'none' }
      ],
      assets: t1Assets.slice(0, 3),
      analysis: [],
      audioSegments: [
        { id: 's1', text: 'Opening hook', filePath: wavSeg1, durationSec: 1.2, role: 'hook' },
        { id: 's2', text: 'Final CTA', filePath: wavSeg2, durationSec: 1.2, role: 'call_to_action' }
      ],
      targetDurationSec: 9.0
    });

    assert.equal(t3bRecalc.scenes[1].voiceoverSegmentIds?.length, 0, 'T3b Scene 1 must have no narration');
    assert.ok(Math.abs(t3bRecalc.synchronizedSegments[0].startTimeSec - 0.15) < 0.02, 'T3b Seg 0 must start at 0.15s');
    assert.ok(Math.abs(t3bRecalc.synchronizedSegments[1].startTimeSec - (t3bRecalc.scenes[2].timelineStartTimeSec + 0.15)) < 0.02, 'T3b Seg 1 must anchor to Scene 2 start + 0.15s');

    const masterWavT3b = path.join(t3Dir, 'master_t3b.wav');
    await buildCreatorSynchronizedVoiceover(t3bRecalc.synchronizedSegments, t3bRecalc.totalDurationSec, masterWavT3b);
    const wavBuf = fs.readFileSync(masterWavT3b);
    const rmsSeg0 = computeWavWindowRmsDb(wavBuf, 0.25, 1.25);
    const rmsSilentScene1 = computeWavWindowRmsDb(wavBuf, 3.2, 5.8);
    const rmsSeg1 = computeWavWindowRmsDb(wavBuf, 6.25, 7.25);

    assert.ok(rmsSilentScene1 < -70, `T3b Silent Scene 1 must be silent (< -70 dBFS), got ${rmsSilentScene1.toFixed(1)} dBFS`);
    assert.ok(Math.abs(rmsSeg0 - rmsSeg1) < 0.25, `T3b Uniform gain required between Seg0 (${rmsSeg0.toFixed(2)} dB) and Seg1 (${rmsSeg1.toFixed(2)} dB)`);

    // T3c: Speech > Scene triggers Full-Timeline Recalculation + Expansion Cap Spillover
    const t3cRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 3.0, transitionOut: 'crossfade', overlayText: 'Scene 1' },
        { assetId: 'a_green', type: 'image', durationSec: 3.0, transitionOut: 'crossfade', overlayText: 'Scene 2' },
        { assetId: 'a_blue', type: 'image', durationSec: 3.0, transitionOut: 'none', overlayText: 'Scene 3' }
      ],
      assets: t1Assets.slice(0, 3),
      analysis: [],
      audioSegments: [
        { id: 's1', text: 'Short hook', filePath: '', durationSec: 1.5, sceneId: 'scene_1' },
        { id: 's2', text: 'Long explanation exceeding 3s scene', filePath: '', durationSec: 4.8, sceneId: 'scene_2' },
        { id: 's3', text: 'CTA', filePath: '', durationSec: 1.5, sceneId: 'scene_3' }
      ],
      targetDurationSec: 9.0
    });

    // Scene 1 must expand to >= 5.1s (4.8 + 0.3), and Scene 2 start time, xfadeOffset, subtitles, and totalDurationSec must all update atomically
    assert.ok(t3cRecalc.scenes[1].durationSec >= 5.1, `T3c Scene 1 should expand to >= 5.1s, got ${t3cRecalc.scenes[1].durationSec}s`);
    const expectedScene2Start = Number((t3cRecalc.scenes[0].durationSec + t3cRecalc.scenes[1].durationSec).toFixed(6));
    assert.ok(Math.abs(t3cRecalc.scenes[2].timelineStartTimeSec - expectedScene2Start) < 0.001, 'T3c Scene 2 timelineStartTimeSec must update atomically');
    assert.ok(Math.abs((t3cRecalc.scenes[1].xfadeOffsetSec || 0) - expectedScene2Start) < 0.001, 'T3c Scene 1 xfadeOffsetSec must update atomically');
    const sumDurations = t3cRecalc.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    assert.ok(Math.abs(sumDurations - t3cRecalc.totalDurationSec) < 0.001, 'T3c sum of scene durations must equal recalculated totalDurationSec');

    // Expansion Cap Spillover: 3 segments of 3.2s each (9.6s total) assigned to Scene 0 (initial 3.0s -> cap 5.25s)
    const t3cSpill = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 3.0, transitionOut: 'crossfade' },
        { assetId: 'a_green', type: 'image', durationSec: 3.0, transitionOut: 'none' }
      ],
      assets: t1Assets.slice(0, 2),
      analysis: [],
      audioSegments: [
        { id: 'sp1', text: 'Part 1', filePath: '', durationSec: 3.2, sceneId: 'scene_1' },
        { id: 'sp2', text: 'Part 2', filePath: '', durationSec: 3.2, sceneId: 'scene_1' },
        { id: 'sp3', text: 'Part 3', filePath: '', durationSec: 3.2, sceneId: 'scene_1' }
      ],
      targetDurationSec: 6.0
    });
    assert.equal(t3cSpill.scenes[0].voiceoverSegmentIds?.length, 1, 'T3c Expansion cap must spill excess segments out of Scene 0');
    console.log('  -> PASS: T3 Voiceover mapping, silent scene preservation, uniform amix gain (0.00 dB diff), and atomic timeline recalculation verified.\n');

    // =========================================================================
    // TEST T4: Arabic .ass Shaping + RTL Punctuation + Animated Overlays + Visual Frame Output
    // =========================================================================
    console.log('[T4] Testing Arabic .ass Shaping (HarfBuzz COMPLEX), RTL Punctuation, Cursive Joining & Visual Frame...');
    const t4Dir = path.join(tmpRoot, 't4');
    fs.mkdirSync(t4Dir, { recursive: true });

    // 1. Verify connected cursive width vs isolated letters using libass + HarfBuzz
    const renderWordBoundingBox = async (text: string, tag: string) => {
      const assPath = path.join(t4Dir, `box_${tag}.ass`);
      writeCreatorAssFile(assPath, {
        width: 800,
        height: 200,
        aspectRatio: '16:9',
        subtitles: [{ startTimeSec: 0, endTimeSec: 1, text }]
      });
      // Replace style with pure white text on pure black background (BorderStyle=1, Outline=0) to measure exact glyph ink
      let assRaw = fs.readFileSync(assPath, 'utf-8');
      assRaw = assRaw.replace(/Style: Subtitle,[^\n]+/, 'Style: Subtitle,Noto Sans Arabic,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,20,20,20,1');
      assRaw = assRaw.replace(/\{\\fad\(120,120\)\}/g, '');
      fs.writeFileSync(assPath, assRaw, 'utf-8');

      const { stdout, stderr } = await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi',
          '-i', 'color=c=black:s=800x200:d=1',
          '-vf', `ass=filename='${escapeFfmpegFilterPath(assPath)}':shaping=complex`,
          '-frames:v', '1',
          '-f', 'rawvideo',
          '-pix_fmt', 'rgb24',
          '-'
        ],
        { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }
      );

      const stderrStr = stderr.toString('utf-8');
      let minX = 800;
      let maxX = 0;
      const colHasInk = new Array(800).fill(false);
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x < 800; x++) {
          const idx = (y * 800 + x) * 3;
          if (stdout[idx] > 40) {
            colHasInk[x] = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      // Count internal vertical empty gaps inside [minX, maxX]
      let internalGaps = 0;
      let inGap = false;
      for (let x = minX; x <= maxX; x++) {
        if (!colHasInk[x]) {
          if (!inGap) {
            internalGaps++;
            inGap = true;
          }
        } else {
          inGap = false;
        }
      }

      return { minX, maxX, width: maxX - minX + 1, internalGaps, raw: stdout, stderrStr };
    };

    // Word "سلسلة" has 5 letters that ALL join cursively into a single unbroken horizontal ligature!
    const connectedWord = await renderWordBoundingBox('سلسلة', 'connected');
    const isolatedWord = await renderWordBoundingBox('س ل س ل ة', 'isolated');

    assert.ok(connectedWord.stderrStr.includes('HarfBuzz-ng'), 'T4 FFmpeg libass must use HarfBuzz-ng complex shaper');
    assert.ok(connectedWord.stderrStr.includes('NotoSansArabic-Bold.ttf'), 'T4 FFmpeg libass must resolve NotoSansArabic-Bold.ttf');
    assert.equal(connectedWord.internalGaps, 0, `T4 Connected Arabic word "سلسلة" must have 0 internal vertical gaps (got ${connectedWord.internalGaps})`);
    assert.ok(isolatedWord.internalGaps >= 4, `T4 Isolated letters "س ل س ل ة" must have >= 4 gaps (got ${isolatedWord.internalGaps})`);
    assert.ok(connectedWord.width < isolatedWord.width * 0.72, `T4 Connected word width (${connectedWord.width}px) must be < 72% of isolated (${isolatedWord.width}px)`);

    // 2. Verify RTL Punctuation placement ("اطلبه الآن" vs "اطلبه الآن!")
    // Because alignment=6 (middle-right) anchors the right edge of the RTL sentence, adding "!" at the end of an RTL phrase must extend ink to the LEFT (smaller minX)!
    const renderRightAligned = async (text: string, tag: string) => {
      const assPath = path.join(t4Dir, `rtl_${tag}.ass`);
      writeCreatorAssFile(assPath, {
        width: 800,
        height: 200,
        aspectRatio: '16:9',
        subtitles: [{ startTimeSec: 0, endTimeSec: 1, text }]
      });
      let assRaw = fs.readFileSync(assPath, 'utf-8');
      assRaw = assRaw.replace(/Style: Subtitle,[^\n]+/, 'Style: Subtitle,Noto Sans Arabic,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,6,40,40,20,1');
      assRaw = assRaw.replace(/\{\\fad\(120,120\)\}/g, '');
      fs.writeFileSync(assPath, assRaw, 'utf-8');

      const { stdout } = await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-v', 'error',
          '-f', 'lavfi',
          '-i', 'color=c=black:s=800x200:d=1',
          '-vf', `ass=filename='${escapeFfmpegFilterPath(assPath)}':shaping=complex`,
          '-frames:v', '1',
          '-f', 'rawvideo',
          '-pix_fmt', 'rgb24',
          '-'
        ],
        { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }
      );
      let minX = 800;
      let maxX = 0;
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x < 800; x++) {
          if (stdout[(y * 800 + x) * 3] > 40) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      return { minX, maxX };
    };

    const withoutBang = await renderRightAligned('اطلبه الآن', 'nobang');
    const withBang = await renderRightAligned('اطلبه الآن!', 'bang');
    assert.ok(
      withBang.minX <= withoutBang.minX - 5 && Math.abs(withBang.maxX - withoutBang.maxX) <= 2,
      `T4 RTL trailing "!" must appear on the LEFT side of the Arabic phrase (withoutBang=[${withoutBang.minX},${withoutBang.maxX}], withBang=[${withBang.minX},${withBang.maxX}])`
    );

    // 3. Render Full 1080x1920 Visual Inspection Frame with Connected Arabic, RTL Punctuation, Mixed English/Numbers, and Animated Kufi Title
    const visualInspectionAssPath = path.join(t4Dir, 'visual_inspection.ass');
    writeCreatorAssFile(visualInspectionAssPath, {
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
      subtitles: [
        {
          startTimeSec: 0.0,
          endTimeSec: 3.0,
          text: 'اكتشف DoudouVoice 2026 - خصم 50%! هل أنت مستعد؟'
        }
      ],
      overlays: [
        {
          startTimeSec: 0.0,
          endTimeSec: 3.0,
          text: 'عطر فاخر بتركيبة أصلية ١٠٠٪',
          style: 'title'
        }
      ]
    });

    const visualInspectionPngPath = path.resolve(
      process.cwd(),
      '.aistudio/artifacts/brain/f450c105-a269-4304-a383-4129465692e2/p0_arabic_verification_frame.png'
    );
    await execFileAsync('ffmpeg', [
      '-y',
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=#16192b:s=1080x1920:r=30:d=1.0',
      '-vf', `ass=filename='${escapeFfmpegFilterPath(visualInspectionAssPath)}':shaping=complex`,
      '-ss', '0.50',
      '-frames:v', '1',
      visualInspectionPngPath
    ]);
    assert.ok(fs.existsSync(visualInspectionPngPath) && fs.statSync(visualInspectionPngPath).size > 15000);
    console.log(`  -> PASS: T4 Arabic .ass shaping, 0-gap cursive ligature, RTL left-side punctuation, and visual frame (${visualInspectionPngPath}) verified.\n`);

    // =========================================================================
    // TEST T5: Short Video Asset — Tier 2 Controlled Slow Motion Within Limit (alpha = 1.20 <= 1.25)
    // =========================================================================
    console.log('[T5] Testing Short Video Asset — Tier 2 Controlled Slow Motion (alpha = 1.20 <= 1.25)...');
    const t5Dir = path.join(tmpRoot, 't5');
    fs.mkdirSync(t5Dir, { recursive: true });

    const shortVidT5 = path.join(t5Dir, 'moving_2_5s.mp4');
    await generateSyntheticMovingVideo(shortVidT5, 2.5, 320, 180);

    const t5Assets = [
      { id: 'v_short', type: 'video' as const, filePath: shortVidT5, originalName: 'moving_2_5s.mp4', mimeType: 'video/mp4', durationSec: 2.5 }
    ];

    const t5Plan: EditingPlan = {
      totalDurationSec: 3.0,
      totalFrames: 90,
      aspectRatio: '16:9',
      resolution: { width: 320, height: 180 },
      scenes: [
        {
          assetId: 'v_short',
          type: 'video',
          timelineStartTimeSec: 0,
          durationSec: 3.0,
          nominalFrames: 90,
          transitionFrames: 0,
          preparedClipFrames: 90,
          effect: 'static',
          transitionOut: 'none',
          colorGrading: 'clean_natural'
        }
      ],
      audio: { voiceoverVolume: 1.4, backgroundMusicVolume: 0.15, ducking: true },
      subtitles: []
    };

    const t5OutMp4 = path.join(t5Dir, 't5_final.mp4');
    const t5Res = await executeModalRendering({
      projectId: 'test_t5',
      assets: t5Assets,
      editingPlan: t5Plan,
      masterVoiceoverPath: '',
      outputFilePath: t5OutMp4
    });

    assert.equal(t5Res.success, true);
    assert.equal(t5Res.validation.video.nbFrames, 90);
    const t5Frames = await extractRawRgbFrames(t5OutMp4, 64, 36);
    assert.equal(t5Frames.length, 90);

    // Every 3-frame window must have pixel MAD > 1.0 (no freeze frames)
    for (let f = 0; f < t5Frames.length - 3; f++) {
      const mad3 = Math.max(
        computeFrameMad(t5Frames[f], t5Frames[f + 1]),
        computeFrameMad(t5Frames[f + 1], t5Frames[f + 2]),
        computeFrameMad(t5Frames[f], t5Frames[f + 3])
      );
      assert.ok(mad3 > 1.0, `T5 Freeze frame detected around frame ${f} (mad3=${mad3.toFixed(3)})`);
    }
    // Check that frame 81 (2.7s) did not loop back to frame 6 (0.2s)
    const loopCheckMadT5 = computeFrameMad(t5Frames[81], t5Frames[6]);
    assert.ok(loopCheckMadT5 > 8.0, `T5 Video looped instead of slow-motion (loopCheckMad=${loopCheckMadT5.toFixed(2)})`);
    console.log('  -> PASS: T5 Tier 2 controlled slow motion (1.20x <= 1.25x) verified (90 frames, continuous motion, no loop).\n');

    // =========================================================================
    // TEST T6: Short Video Asset — Tier 3 (alpha > 1.25) Scene Capping & PartA+PartB+xfade Exact Split
    // =========================================================================
    console.log('[T6] Testing Short Video Asset — Tier 3 (alpha > 1.25) Scene Capping & PartA+PartB+xfade Split...');
    const t6Dir = path.join(tmpRoot, 't6');
    fs.mkdirSync(t6Dir, { recursive: true });

    const shortVidT6 = path.join(t6Dir, 'moving_1_8s.mp4');
    await generateSyntheticMovingVideo(shortVidT6, 1.8, 320, 180);

    // T6a: Multi-scene timeline where 1.8s video is initially assigned 4.0s -> Stage E caps it to <= 2.25s (1.25 * 1.8s)
    const t6aRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'v_18', type: 'video', durationSec: 4.0, transitionOut: 'crossfade' },
        { assetId: 'a_red', type: 'image', durationSec: 4.0, transitionOut: 'none' }
      ],
      assets: [
        { id: 'v_18', type: 'video', filePath: shortVidT6, originalName: 'moving_1_8s.mp4', mimeType: 'video/mp4', durationSec: 1.8 },
        t1Assets[0]
      ],
      analysis: [],
      audioSegments: [],
      targetDurationSec: 8.0
    });
    assert.ok(
      (t6aRecalc.scenes[0].preparedClipDurationSec || 0) <= 1.8 * MAX_SLOWDOWN_FACTOR + 0.05,
      `T6a Video scene preparedClipDurationSec (${t6aRecalc.scenes[0].preparedClipDurationSec}s) must be capped at <= 1.25 * 1.8s (2.25s)`
    );
    assert.equal(t6aRecalc.totalFrames, 240, 'T6a Total frames must remain 240 (8.000s) after redistributing slack to Scene 1');

    // T6b: Single-asset 1.8s video forced into a 4.5s (135 frames, alpha=2.50 > 1.25) timeline -> Tier 3 PartA + PartB Ken Burns + xfade
    const t6OutMp4 = path.join(t6Dir, 't6_final.mp4');
    const t6Res = await executeModalRendering({
      projectId: 'test_t6',
      assets: [{ id: 'v_18', type: 'video', filePath: shortVidT6, originalName: 'moving_1_8s.mp4', durationSec: 1.8 }],
      editingPlan: {
        totalDurationSec: 4.5,
        totalFrames: 135,
        aspectRatio: '16:9',
        resolution: { width: 320, height: 180 },
        scenes: [
          {
            assetId: 'v_18',
            type: 'video',
            timelineStartTimeSec: 0,
            durationSec: 4.5,
            nominalFrames: 135,
            transitionFrames: 0,
            preparedClipFrames: 135,
            effect: 'slow_zoom_in',
            transitionOut: 'none',
            colorGrading: 'clean_natural'
          }
        ],
        audio: { voiceoverVolume: 1.4, backgroundMusicVolume: 0.15, ducking: true },
        subtitles: []
      },
      masterVoiceoverPath: '',
      outputFilePath: t6OutMp4
    });

    assert.equal(t6Res.success, true, `T6b render failed: ${t6Res.error}`);
    assert.equal(t6Res.validation.video.nbFrames, 135, 'T6b Tier 3 PartA + PartB - M_split must equal exactly 135 frames');

    const t6Frames = await extractRawRgbFrames(t6OutMp4, 64, 36);
    assert.equal(t6Frames.length, 135);

    // Verify continuous Ken Burns motion in Part B (final second: frames 105..134) — no frozen last frames!
    let movingPairsInLastSec = 0;
    for (let f = 105; f < 134; f++) {
      if (computeFrameMad(t6Frames[f], t6Frames[f + 1]) > 0.08) {
        movingPairsInLastSec++;
      }
    }
    assert.ok(movingPairsInLastSec >= 20, `T6b Expected continuous Ken Burns motion in final second, got ${movingPairsInLastSec}/29 moving frame pairs`);
    // Verify Part B did NOT loop back to start of video (compare frame 60 at 2.0s vs frame 6 at 0.2s)
    const loopCheckMadT6 = computeFrameMad(t6Frames[60], t6Frames[6]);
    assert.ok(loopCheckMadT6 > 8.0, `T6b Tier 3 must not loop video (loopCheckMad=${loopCheckMadT6.toFixed(2)})`);
    console.log('  -> PASS: T6 Tier 3 scene capping & PartA + PartB Ken Burns + xfade exact frame count (135/135 frames) verified.\n');

    // =========================================================================
    // TEST T7: End-to-End Creator Final MP4 Validation + Video Studio Non-Regression
    // =========================================================================
    console.log('[T7] Testing End-to-End Creator Final MP4 (with Arabic ASS + Synced Audio) & Video Studio Non-Regression...');
    const t7Dir = path.join(tmpRoot, 't7');
    fs.mkdirSync(t7Dir, { recursive: true });

    const e2eSeg1 = path.join(t7Dir, 'vo1.wav');
    const e2eSeg2 = path.join(t7Dir, 'vo2.wav');
    const e2eSeg3 = path.join(t7Dir, 'vo3.wav');
    await Promise.all([
      generateSineWav(e2eSeg1, 1.8, 440),
      generateSineWav(e2eSeg2, 2.0, 520),
      generateSineWav(e2eSeg3, 1.6, 600)
    ]);

    const e2eAssets = [
      t1Assets[0],
      { id: 'v_mid', type: 'video' as const, filePath: shortVidT5, originalName: 'moving_2_5s.mp4', mimeType: 'video/mp4', durationSec: 2.5 },
      t1Assets[2]
    ];

    const e2eRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        { assetId: 'a_red', type: 'image', durationSec: 3.0, effect: 'slow_zoom_in', transitionOut: 'crossfade', overlayText: 'عرض حصري اليوم', overlayStyle: 'title' },
        { assetId: 'v_mid', type: 'video', durationSec: 3.0, effect: 'smart_subject_focus', transitionOut: 'wipeleft', overlayText: 'جودة عالية ١٠٠٪', overlayStyle: 'badge' },
        { assetId: 'a_blue', type: 'image', durationSec: 3.0, effect: 'slow_zoom_out', transitionOut: 'none', overlayText: 'اطلبه الآن - خصم 50%!', overlayStyle: 'cta_pill' }
      ],
      assets: e2eAssets,
      analysis: [],
      audioSegments: [
        { id: 'vo_1', text: 'اكتشف الفخامة الأصيلة مع DoudouVoice 2026!', filePath: e2eSeg1, durationSec: 1.8, role: 'hook' },
        { id: 'vo_2', text: 'تصميم عصري وجودة لا مثيل لها.', filePath: e2eSeg2, durationSec: 2.0 },
        { id: 'vo_3', text: 'اطلبه الآن واستفد من خصم 50%!', filePath: e2eSeg3, durationSec: 1.6, role: 'call_to_action' }
      ],
      targetDurationSec: 9.0
    });

    const e2eMasterWav = path.join(t7Dir, 'master_voiceover.wav');
    await buildCreatorSynchronizedVoiceover(e2eRecalc.synchronizedSegments, e2eRecalc.totalDurationSec, e2eMasterWav);

    const e2eFinalMp4 = path.join(t7Dir, 'final_creator_video.mp4');
    const e2eRender = await executeModalRendering({
      projectId: 'test_t7_e2e',
      assets: e2eAssets,
      editingPlan: {
        totalDurationSec: e2eRecalc.totalDurationSec,
        totalFrames: e2eRecalc.totalFrames,
        aspectRatio: '9:16',
        resolution: { width: 540, height: 960 },
        scenes: e2eRecalc.scenes,
        audio: {
          voiceoverAudioPath: e2eMasterWav,
          voiceoverVolume: 1.4,
          backgroundMusicVolume: 0.15,
          ducking: true
        },
        subtitles: e2eRecalc.subtitles,
        synchronizedSegments: e2eRecalc.synchronizedSegments
      },
      masterVoiceoverPath: e2eMasterWav,
      outputFilePath: e2eFinalMp4
    });

    assert.equal(e2eRender.success, true, `T7 E2E Creator render failed: ${e2eRender.error}`);
    assert.equal(e2eRender.validation.valid, true);
    assert.equal(e2eRender.validation.video.codec, 'h264');
    assert.equal(e2eRender.validation.video.pixFmt, 'yuv420p');
    assert.equal(e2eRender.validation.video.width, 540);
    assert.equal(e2eRender.validation.video.height, 960);
    assert.equal(e2eRender.validation.video.fps, 30);
    assert.equal(e2eRender.validation.video.nbFrames, 270);
    assert.equal(e2eRender.validation.audio.isAudioPresent, true);
    assert.equal(e2eRender.validation.audio.codec, 'aac');
    assert.ok(Math.abs(e2eRender.validation.video.durationSec - 9.0) <= 0.05);

    // Video Studio (/video-studio) Non-Regression Smoke Test
    const vsTimeline = await validateAndAdjustTimeline(
      [
        { id: 'vs1', startTimeSec: 0.2, endTimeSec: 2.0, audioPath: e2eSeg1, text: 'مقطع أول' },
        { id: 'vs2', startTimeSec: 1.5, endTimeSec: 3.5, audioPath: e2eSeg2, text: 'مقطع ثاني' }
      ],
      6.0,
      0.20,
      [
        { id: 'scene-1', startTimeSec: 0, endTimeSec: 3, description: 'Scene 1' },
        { id: 'scene-2', startTimeSec: 3, endTimeSec: 6, description: 'Scene 2' }
      ]
    );
    assert.equal(vsTimeline.adjustedSegments.length, 2);
    assert.ok(vsTimeline.adjustedSegments[1].startTimeSec >= vsTimeline.adjustedSegments[0].endTimeSec + 0.19);

    const vsVoWav = path.join(t7Dir, 'vs_vo.wav');
    await buildSynchronizedVoiceoverTrack(vsTimeline.adjustedSegments, 5.0, vsVoWav);
    assert.ok(fs.existsSync(vsVoWav));

    const vsSrcVideo = path.join(t7Dir, 'vs_src.mp4');
    await generateSyntheticMovingVideo(vsSrcVideo, 5.0, 320, 180);
    const vsOutMp4 = path.join(t7Dir, 'vs_final_dubbed.mp4');
    const vsValidation = await compositeFinalVideo({
      videoPath: vsSrcVideo,
      voiceoverWavPath: vsVoWav,
      outputPath: vsOutMp4,
      audioMixMode: 'replace_speech',
      subtitles: [{ startTimeSec: 0.2, endTimeSec: 2.0, text: 'مقطع أول' }],
      outputWidth: 320,
      outputHeight: 180,
      fitMode: 'crop',
      targetOutputDurationSec: 5.0
    });
    assert.equal(vsValidation.valid, true, `T7 Video Studio compositeFinalVideo failed: ${vsValidation.error}`);
    console.log(
      `  -> PASS: T7 End-to-End Creator MP4 (${e2eRender.validation.video.width}x${e2eRender.validation.video.height}, ${e2eRender.validation.video.durationSec.toFixed(3)}s, ${e2eRender.validation.video.nbFrames} frames @ ${e2eRender.validation.video.fps}fps, ${e2eRender.validation.video.codec}/${e2eRender.validation.audio.codec}) & Video Studio non-regression verified.\n`
    );

    console.log('================================================================');
    console.log('ALL 7 P0 TESTS (T1 - T7) PASSED SUCCESSFULLY');
    console.log('================================================================');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runP0Tests().catch(err => {
  console.error('P0 Test Suite Failed:', err);
  process.exit(1);
});
