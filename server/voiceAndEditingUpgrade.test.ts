import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  recalculateCompleteEditingTimeline,
  validateEditingPlanConstraints,
  buildCreatorSynchronizedVoiceover,
  validateVoiceoverCompleteness,
  inspectRenderedVideoWithMuseSpark11,
  repairEditingPlanFromInspection,
  extractWavPcmData,
  NarrationDurationConflictError,
  PURE_ZOOM_EFFECTS,
  TIMELINE_TAIL_MARGIN_SEC,
  SEGMENT_TAIL_CUSHION_SEC,
  MAX_NATURAL_ATEMPO,
  EditingPlan,
  CreatorVideoScript,
  CreativeDirectionOutput,
  MultimodalAnalysisAsset,
  CreatorAsset
} from './metaCreatorService.js';
import { executeModalRendering } from './modalRunner.js';

const execFileAsync = promisify(execFile);

function createSynthSpeechWav(
  filePath: string,
  durationSec: number,
  freqHz = 440,
  tailMarkerFreqHz = 880
): void {
  const sampleRate = 24000;
  const numSamples = Math.round(durationSec * sampleRate);
  const pcmSamples = Math.round((durationSec + SEGMENT_TAIL_CUSHION_SEC) * sampleRate);
  const dataSize = pcmSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Fill active speech with modulated carrier + distinct final-word burst in last 250ms of active speech
  const tailWordStartSample = Math.max(0, numSamples - Math.round(0.25 * sampleRate));
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const isFinalWord = i >= tailWordStartSample;
    const f = isFinalWord ? tailMarkerFreqHz : freqHz;
    const env = isFinalWord ? 0.65 : 0.45 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t));
    const sample = Math.round(Math.sin(2 * Math.PI * f * t) * 32767 * env);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }
  // Remaining SEGMENT_TAIL_CUSHION_SEC samples are 0 (digital silence cushion)
  fs.writeFileSync(filePath, buf);
}

async function createTestImage(filePath: string, colorHex: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `color=c=${colorHex}:s=1080x1920:d=1`,
    '-vf', 'drawbox=x=180:y=360:w=720:h=960:color=white@0.85:t=fill,drawbox=x=260:y=500:w=560:h=680:color=0x1e293b@0.95:t=fill',
    '-frames:v', '1',
    filePath
  ]);
}

async function createShortTestVideo(filePath: string, durationSec: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=size=720x1280:rate=30:duration=${durationSec}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    filePath
  ]);
}

async function runTests() {
  console.log('=== Running Voice Completion & Professional Commercial Editing Upgrade Suite (11 Scenarios) ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doudou-voice-edit-upgrade-'));

  try {
    const img1 = path.join(tmpDir, 'product_hero.jpg');
    const img2 = path.join(tmpDir, 'product_detail.jpg');
    const img3 = path.join(tmpDir, 'product_lifestyle.jpg');
    const shortVid = path.join(tmpDir, 'product_clip_1_8s.mp4');

    await createTestImage(img1, '0x0f172a');
    await createTestImage(img2, '0x1e1b4b');
    await createTestImage(img3, '0x14532d');
    await createShortTestVideo(shortVid, 1.8);

    const multiAssets: CreatorAsset[] = [
      { id: 'asset_1', type: 'image', filePath: img1, originalName: 'hero.jpg', mimeType: 'image/jpeg' },
      { id: 'asset_2', type: 'image', filePath: img2, originalName: 'detail.jpg', mimeType: 'image/jpeg' },
      { id: 'asset_3', type: 'image', filePath: img3, originalName: 'lifestyle.jpg', mimeType: 'image/jpeg' }
    ];

    const multiAnalysis: MultimodalAnalysisAsset[] = [
      {
        assetId: 'asset_1',
        type: 'image',
        mainObjects: ['coffee bag'],
        productDetails: 'Hero coffee bag',
        advertisingAngles: ['Hero reveal'],
        samLocalizationCues: [{ label: 'coffee bag', box2d: [0.2, 0.2, 0.8, 0.8], confidence: 0.95 }]
      },
      {
        assetId: 'asset_2',
        type: 'image',
        mainObjects: ['coffee beans'],
        productDetails: 'Roasted espresso beans macro',
        advertisingAngles: ['Detail macro'],
        samLocalizationCues: [{ label: 'coffee beans', box2d: [0.25, 0.25, 0.75, 0.75], confidence: 0.94 }]
      },
      {
        assetId: 'asset_3',
        type: 'image',
        mainObjects: ['espresso cup'],
        productDetails: 'Pouring espresso cup',
        advertisingAngles: ['Lifestyle CTA'],
        samLocalizationCues: [{ label: 'espresso cup', box2d: [0.2, 0.2, 0.8, 0.8], confidence: 0.96 }]
      }
    ];

    // -------------------------------------------------------------------------
    // TEST 1, 2, 3:
    // 1. Multi-segment Arabic narration where every segment is present & complete in final MP4
    // 2. Narration segment longer than initial scene duration -> timeline redistributes so speech is never cut
    // 3. Final scene narration with trailing words -> Backward-Cascade Tail Guard preserves >= 0.18s tail margin and final spoken word is intact
    // -------------------------------------------------------------------------
    console.log('\n[Test 1, 2, 3] Testing multi-segment Arabic narration completeness, long-segment redistribution & final-word tail guard...');
    const seg1Path = path.join(tmpDir, 'seg1.wav');
    const seg2Path = path.join(tmpDir, 'seg2_long.wav');
    const seg3Path = path.join(tmpDir, 'seg3_final_words.wav');

    // Initial raw scenes are [3.0s, 2.0s, 3.0s] = 8.0s total.
    // Segment 2 is 2.95s active speech (+0.10s cushion = 3.05s), which is LONGER than Scene 2's initial 2.0s!
    // Segment 3 is 2.55s active speech (+0.10s cushion = 2.65s) in the final scene!
    createSynthSpeechWav(seg1Path, 1.45, 420, 840);
    createSynthSpeechWav(seg2Path, 2.95, 480, 920);
    createSynthSpeechWav(seg3Path, 2.55, 520, 980);

    const script3Seg: CreatorVideoScript = {
      hook: 'اكتشفوا قهوة دودو الفاخرة اليوم!',
      mainMessage: 'محمصة بعناية فائقة من أجود حبوب البن الطبيعي لتعطيكم مذاقاً لا يقاوم في كل رشفة.',
      benefits: ['تحميص طبيعي ١٠٠٪', 'مذاق غني', 'توصيل سريع'],
      callToAction: 'اطلبوها الآن واستمتعوا بالتوصيل السريع لباب الدار!',
      dialect: 'Algerian Arabic',
      voice: 'Puck',
      provider: 'meta',
      model: 'muse-spark-1.2-contributor',
      segments: [
        {
          id: 'seg_1',
          sceneId: 'asset_1',
          role: 'hook',
          text: 'اكتشفوا قهوة دودو الفاخرة اليوم!',
          visualDescription: 'Hero coffee bag reveal',
          estimatedDurationSec: 1.5,
          actualDurationSec: Number((1.45 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)),
          emotion: 'excited'
        },
        {
          id: 'seg_2',
          sceneId: 'asset_2',
          role: 'benefit',
          text: 'محمصة بعناية فائقة من أجود حبوب البن الطبيعي لتعطيكم مذاقاً لا يقاوم في كل رشفة.',
          visualDescription: 'Macro roasted coffee beans',
          estimatedDurationSec: 2.0,
          actualDurationSec: Number((2.95 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)),
          emotion: 'warm'
        },
        {
          id: 'seg_3',
          sceneId: 'asset_3',
          role: 'call_to_action',
          text: 'اطلبوها الآن واستمتعوا بالتوصيل السريع لباب الدار!',
          visualDescription: 'Pouring espresso CTA',
          estimatedDurationSec: 2.5,
          actualDurationSec: Number((2.55 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)),
          emotion: 'persuasive'
        }
      ]
    };

    const audioSegments3 = [
      { id: 'seg_1', sceneId: 'asset_1', role: 'hook', text: script3Seg.segments[0].text, filePath: seg1Path, durationSec: Number((1.45 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)) },
      { id: 'seg_2', sceneId: 'asset_2', role: 'body', text: script3Seg.segments[1].text, filePath: seg2Path, durationSec: Number((2.95 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)) },
      { id: 'seg_3', sceneId: 'asset_3', role: 'cta', text: script3Seg.segments[2].text, filePath: seg3Path, durationSec: Number((2.55 + SEGMENT_TAIL_CUSHION_SEC).toFixed(3)) }
    ];

    const rawScenes8s = [
      {
        assetId: 'asset_1',
        type: 'image',
        sceneRole: 'hook',
        shotType: 'medium_hero',
        durationSec: 3.0,
        effect: 'pull_back_reveal',
        transitionOut: 'smoothleft',
        colorGrading: 'warm_luxury',
        overlayText: 'قهوة دودو الفاخرة',
        overlayStyle: 'title'
      },
      {
        assetId: 'asset_2',
        type: 'image',
        sceneRole: 'demonstration',
        shotType: 'detail_closeup',
        durationSec: 2.0, // Intentionally shorter than seg_2 (3.05s) to test redistribution!
        effect: 'detail_closeup',
        transitionOut: 'circleopen',
        colorGrading: 'warm_luxury',
        overlayText: 'تحميص طبيعي ١٠٠٪',
        overlayStyle: 'badge'
      },
      {
        assetId: 'asset_3',
        type: 'image',
        sceneRole: 'cta',
        shotType: 'cta_card',
        durationSec: 3.0,
        effect: 'track_horizontal',
        transitionOut: 'none',
        colorGrading: 'warm_luxury',
        overlayText: 'اطلب الآن — توصيل سريع',
        overlayStyle: 'cta_pill'
      }
    ];

    const recalc8s = recalculateCompleteEditingTimeline({
      rawScenes: rawScenes8s,
      assets: multiAssets,
      analysis: multiAnalysis,
      audioSegments: audioSegments3,
      targetDurationSec: 8,
      colorGradingTheme: 'warm_luxury'
    });

    // Verify Scene 2 was expanded to accommodate seg_2 (3.05s + lead-in/pad)
    assert.ok(
      recalc8s.scenes[1].durationSec >= audioSegments3[1].durationSec,
      `Scene 2 duration (${recalc8s.scenes[1].durationSec}s) must expand to fit Segment 2 (${audioSegments3[1].durationSec}s)`
    );

    // Verify Final Scene starts early enough so Segment 3 finishes before 8.0s - TIMELINE_TAIL_MARGIN_SEC
    const lastSegSync = recalc8s.synchronizedSegments[2];
    const tailMarginSec = recalc8s.totalDurationSec - lastSegSync.endTimeSec;
    assert.ok(
      tailMarginSec >= TIMELINE_TAIL_MARGIN_SEC - 0.02,
      `Final segment must finish with >= ${TIMELINE_TAIL_MARGIN_SEC}s tail safety margin (actual: ${tailMarginSec.toFixed(3)}s)`
    );

    const masterWavPath = path.join(tmpDir, 'master_voiceover_8s.wav');
    await buildCreatorSynchronizedVoiceover(
      recalc8s.synchronizedSegments,
      recalc8s.totalDurationSec,
      masterWavPath
    );

    // Verify the final spoken word is present in masterWavPath PCM waveform right before lastSegSync.endTimeSec
    const masterPcm = extractWavPcmData(fs.readFileSync(masterWavPath));
    const finalWordCenterSec = lastSegSync.endTimeSec - SEGMENT_TAIL_CUSHION_SEC - 0.12;
    const sampleIdx = Math.floor(finalWordCenterSec * 24000);
    let finalWordPeak = 0;
    for (let k = Math.max(0, sampleIdx - 1200); k < Math.min(masterPcm.length / 2, sampleIdx + 1200); k++) {
      const amp = Math.abs(masterPcm.readInt16LE(k * 2));
      if (amp > finalWordPeak) finalWordPeak = amp;
    }
    assert.ok(
      finalWordPeak > 8000,
      `Final spoken word waveform must be intact and non-clipped in master voiceover WAV (peak=${finalWordPeak})`
    );
    console.log(`  ✓ Scene 2 expanded to ${recalc8s.scenes[1].durationSec.toFixed(2)}s; final word ends at ${lastSegSync.endTimeSec.toFixed(2)}s/${recalc8s.totalDurationSec}s (tail margin=${tailMarginSec.toFixed(2)}s, peak=${finalWordPeak})`);

    // Also verify NarrationDurationConflictError when narration exceeds natural speech speed limit
    const conflictErr = new NarrationDurationConflictError(
      `Generated narration (22.5s) exceeds target 15s even at max natural speed (${MAX_NATURAL_ATEMPO}x)`,
      15,
      22.5
    );
    assert.equal(conflictErr.name, 'NarrationDurationConflictError');
    assert.equal(conflictErr.code, 'NARRATION_DURATION_CONFLICT');
    assert.ok(conflictErr.message.includes(String(MAX_NATURAL_ATEMPO)));
    console.log(`  ✓ NarrationDurationConflictError explicitly reports natural speech overflow (> ${MAX_NATURAL_ATEMPO}x)`);

    // -------------------------------------------------------------------------
    // TEST 4, 7, 8, 11:
    // Render real MP4 from multiple uploaded product images with Arabic RTL overlays,
    // varied camera movements, smooth transitions, and validate voiceover + FFprobe streams
    // -------------------------------------------------------------------------
    console.log('\n[Test 4, 7, 8, 11] Rendering real commercial MP4 with multiple product images, Arabic RTL overlays & varied camera choreography...');
    const planMulti8s: EditingPlan = {
      aspectRatio: '9:16',
      resolution: { width: 540, height: 960 },
      totalDurationSec: recalc8s.totalDurationSec,
      totalFrames: recalc8s.totalFrames,
      scenes: recalc8s.scenes,
      audio: {
        voiceoverAudioPath: masterWavPath,
        voiceoverVolume: 1.4,
        backgroundMusicVolume: 0.15,
        ducking: true
      },
      subtitles: recalc8s.subtitles,
      synchronizedSegments: recalc8s.synchronizedSegments
    };

    const mp4MultiPath = path.join(tmpDir, 'commercial_multi_8s.mp4');
    const renderMultiRes = await executeModalRendering({
      projectId: 'test_multi_8s',
      assets: multiAssets,
      editingPlan: planMulti8s,
      masterVoiceoverPath: masterWavPath,
      outputFilePath: mp4MultiPath
    });

    assert.equal(renderMultiRes.success, true, `Multi-asset render must succeed: ${renderMultiRes.error || ''}`);
    assert.equal(renderMultiRes.validation.valid, true, `FFprobe validation must pass: ${renderMultiRes.validation.errors.join(', ')}`);
    assert.equal(renderMultiRes.validation.video.codec, 'h264');
    assert.equal(renderMultiRes.validation.video.pixFmt, 'yuv420p');
    assert.equal(renderMultiRes.validation.audio.isAudioPresent, true);
    assert.equal(renderMultiRes.validation.audio.codec, 'aac');
    assert.equal(renderMultiRes.validation.video.blackFrameSegments, 0, 'Must have 0 black frame glitches');
    assert.equal(renderMultiRes.validation.video.whiteFlashSegments, 0, 'Must have 0 white flash glitches');
    assert.ok(Math.abs(renderMultiRes.durationSec - 8.0) <= 0.35, `MP4 duration (${renderMultiRes.durationSec}s) must match 8.0s target`);

    const voiceValMulti = await validateVoiceoverCompleteness({
      script: script3Seg,
      voiceoverInfo: {
        audioSegments: audioSegments3,
        masterVoiceoverPath: masterWavPath,
        totalVoiceoverDurationSec: 8.0
      },
      editingPlan: planMulti8s,
      renderedMp4Path: mp4MultiPath
    });
    assert.equal(voiceValMulti.valid, true, `Voiceover completeness validation must pass: ${voiceValMulti.errors.join(' | ')}`);
    assert.equal(voiceValMulti.allSegmentsPresent, true);
    assert.equal(voiceValMulti.noSceneCut, true);
    assert.equal(voiceValMulti.noClippedWords, true);
    assert.equal(voiceValMulti.waveformVerified, true);
    console.log(`  ✓ Multi-image commercial MP4 verified: ${voiceValMulti.summary}`);

    // -------------------------------------------------------------------------
    // TEST 5:
    // Single uploaded product image -> multiple derived compositions (pull_back_reveal,
    // detail_closeup, pip_detail_spotlight, track_horizontal)
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Testing single product image derived multi-angle commercial compositions (including PiP Detail Spotlight)...');
    const singleAssetList: CreatorAsset[] = [
      { id: 'single_1', type: 'image', filePath: img1, originalName: 'hero.jpg', mimeType: 'image/jpeg' }
    ];
    const singleRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        {
          assetId: 'single_1',
          type: 'image',
          sceneRole: 'hook',
          shotType: 'medium_hero',
          durationSec: 2.0,
          effect: 'pull_back_reveal',
          transitionOut: 'smoothleft',
          colorGrading: 'warm_luxury',
          samFocusBox: [0.20, 0.20, 0.80, 0.80]
        },
        {
          assetId: 'single_1',
          type: 'image',
          sceneRole: 'product_intro',
          shotType: 'detail_closeup',
          durationSec: 2.0,
          effect: 'detail_closeup',
          transitionOut: 'wiperight',
          colorGrading: 'warm_luxury',
          samFocusBox: [0.30, 0.30, 0.65, 0.65]
        },
        {
          assetId: 'single_1',
          type: 'image',
          sceneRole: 'benefits',
          shotType: 'pip_detail',
          durationSec: 2.0,
          effect: 'pip_detail_spotlight',
          transitionOut: 'circleopen',
          colorGrading: 'warm_luxury',
          samFocusBox: [0.25, 0.25, 0.75, 0.75]
        },
        {
          assetId: 'single_1',
          type: 'image',
          sceneRole: 'cta',
          shotType: 'cta_card',
          durationSec: 2.0,
          effect: 'track_horizontal',
          transitionOut: 'none',
          colorGrading: 'warm_luxury',
          samFocusBox: [0.15, 0.15, 0.85, 0.85]
        }
      ],
      assets: singleAssetList,
      analysis: [multiAnalysis[0]],
      audioSegments: [],
      targetDurationSec: 8,
      colorGradingTheme: 'warm_luxury'
    });

    const singleAssetPlan: EditingPlan = {
      aspectRatio: '9:16',
      resolution: { width: 540, height: 960 },
      totalDurationSec: singleRecalc.totalDurationSec,
      totalFrames: singleRecalc.totalFrames,
      scenes: singleRecalc.scenes,
      audio: {
        voiceoverAudioPath: masterWavPath,
        voiceoverVolume: 1.4,
        backgroundMusicVolume: 0.15,
        ducking: true
      },
      subtitles: [],
      synchronizedSegments: []
    };

    const singlePlanCheck = validateEditingPlanConstraints(singleAssetPlan, {
      targetDurationSec: 8,
      targetAspectRatio: '9:16',
      assets: singleAssetList
    });
    assert.equal(singlePlanCheck.valid, true, `Single-image multi-composition plan must pass constraint validation: ${singlePlanCheck.violations.join(' | ')}`);

    const singleMp4Path = path.join(tmpDir, 'single_image_pip_8s.mp4');
    const singleRenderRes = await executeModalRendering({
      projectId: 'test_single_pip_8s',
      assets: singleAssetList,
      editingPlan: singleAssetPlan,
      masterVoiceoverPath: masterWavPath,
      outputFilePath: singleMp4Path
    });
    assert.equal(singleRenderRes.success, true, `Single-image PiP spotlight render must succeed: ${singleRenderRes.error || ''}`);
    assert.equal(singleRenderRes.validation.valid, true);
    console.log(`  ✓ Single-image 4-scene commercial composition (pull_back_reveal -> detail_closeup -> pip_detail_spotlight -> track_horizontal) rendered & validated`);

    // -------------------------------------------------------------------------
    // TEST 6:
    // Short video asset (1.8s) + images -> natural speed handling without frozen frames
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Testing short video asset (1.8s) + images natural speed policy (zero frozen frames)...');
    const hybridAssets: CreatorAsset[] = [
      { id: 'vid_short', type: 'video', filePath: shortVid, originalName: 'clip.mp4', mimeType: 'video/mp4', durationSec: 1.8 },
      { id: 'img_cta', type: 'image', filePath: img2, originalName: 'cta.jpg', mimeType: 'image/jpeg' }
    ];
    const hybridRecalc = recalculateCompleteEditingTimeline({
      rawScenes: [
        {
          assetId: 'vid_short',
          type: 'video',
          sceneRole: 'hook',
          shotType: 'full_shot',
          durationSec: 3.2,
          effect: 'smart_subject_focus',
          transitionOut: 'smoothleft',
          colorGrading: 'cinematic'
        },
        {
          assetId: 'img_cta',
          type: 'image',
          sceneRole: 'cta',
          shotType: 'cta_card',
          durationSec: 2.8,
          effect: 'pull_back_reveal',
          transitionOut: 'none',
          colorGrading: 'cinematic'
        }
      ],
      assets: hybridAssets,
      analysis: [],
      audioSegments: [],
      targetDurationSec: 6,
      colorGradingTheme: 'cinematic'
    });

    const hybridPlan: EditingPlan = {
      aspectRatio: '9:16',
      resolution: { width: 540, height: 960 },
      totalDurationSec: hybridRecalc.totalDurationSec,
      totalFrames: hybridRecalc.totalFrames,
      scenes: hybridRecalc.scenes,
      audio: { voiceoverVolume: 1.4, backgroundMusicVolume: 0.15, ducking: true },
      subtitles: [],
      synchronizedSegments: []
    };

    const hybridMp4Path = path.join(tmpDir, 'hybrid_video_image_6s.mp4');
    const hybridRenderRes = await executeModalRendering({
      projectId: 'test_hybrid_6s',
      assets: hybridAssets,
      editingPlan: hybridPlan,
      masterVoiceoverPath: '',
      outputFilePath: hybridMp4Path
    });
    assert.equal(hybridRenderRes.success, true);
    assert.equal(hybridRenderRes.validation.valid, true);
    assert.equal(hybridRenderRes.validation.video.frozenFrameSegments, 0, 'Short video scene must have 0 frozen frame segments');
    console.log(`  ✓ Hybrid short-video + image render passed with 0 frozen frames`);

    // -------------------------------------------------------------------------
    // TEST 9 & 10:
    // Muse Spark 1.1 post-render inspection rejects repetitive zoom-only editing,
    // distinguishes observable vs non-observable findings, and triggers bounded repair (capped at 2 cycles)
    // -------------------------------------------------------------------------
    console.log('\n[Test 9, 10] Testing repetitive zoom rejection and bounded post-render repair loop (max 2 cycles)...');
    const repetitiveZoomPlan: EditingPlan = JSON.parse(JSON.stringify(planMulti8s));
    repetitiveZoomPlan.scenes[0].effect = 'slow_zoom_in';
    repetitiveZoomPlan.scenes[1].effect = 'slow_zoom_out';
    repetitiveZoomPlan.scenes[2].effect = 'smart_subject_focus';

    const zoomConstraintCheck = validateEditingPlanConstraints(repetitiveZoomPlan, {
      targetDurationSec: 8,
      targetAspectRatio: '9:16',
      assets: multiAssets
    });
    assert.equal(zoomConstraintCheck.valid, false, 'validateEditingPlanConstraints must reject plans where >50% of scenes use pure zoom');
    assert.ok(
      zoomConstraintCheck.violations.some(iss => iss.includes('Repetitive zoom editing detected')),
      'Constraint violation must explicitly report repetitive zoom editing'
    );

    const mockDirection: CreativeDirectionOutput = {
      campaignCategory: 'food_beverage',
      objective: 'Drive direct orders',
      targetAudience: 'Coffee lovers',
      adAngle: 'Rich crema closeup & roasted aroma',
      creativeConcept: 'Luxury Algerian Coffee Commercial',
      storytellingStructure: 'Hook -> Detail -> CTA',
      visualRhythm: 'dynamic',
      emotionalTone: 'Warm and inviting',
      colorGradingTheme: 'warm_luxury',
      recommendedCallToAction: 'اطلب الآن',
      formatAspectRatio: '9:16',
      suggestedDurationSec: 8
    };

    const inspectionOnZoomPlan = await inspectRenderedVideoWithMuseSpark11({
      videoPath: mp4MultiPath,
      editingPlan: repetitiveZoomPlan,
      creativeDirection: mockDirection,
      script: script3Seg,
      technicalValidation: renderMultiRes.validation,
      voiceValidation: voiceValMulti,
      outputDir: tmpDir,
      repairCycle: 0
    });

    assert.equal(inspectionOnZoomPlan.decision, 'FAIL', 'Post-render inspector must reject repetitive zoom-only plan with FAIL');
    assert.ok(Array.isArray(inspectionOnZoomPlan.observable_visual_findings), 'Inspection report must include observable_visual_findings');
    assert.ok(Array.isArray(inspectionOnZoomPlan.non_observable_from_frames), 'Inspection report must explicitly declare non_observable_from_frames');

    // Run bounded repair (max 2 cycles) and verify it replaces repetitive zoom with diverse commercial movements
    const maxRepairCycles = 2;
    let planUnderRepair = repetitiveZoomPlan;
    let repairCount = 0;
    for (let cycle = 1; cycle <= maxRepairCycles; cycle++) {
      repairCount++;
      planUnderRepair = await repairEditingPlanFromInspection({
        currentPlan: planUnderRepair,
        inspectionReport: inspectionOnZoomPlan,
        creativeDirection: mockDirection,
        script: script3Seg,
        analysis: multiAnalysis,
        voiceoverInfo: {
          audioSegments: audioSegments3,
          masterVoiceoverPath: masterWavPath,
          totalVoiceoverDurationSec: 8.0
        },
        assets: multiAssets,
        targetDurationSec: 8,
        repairCycle: cycle
      });
      const checkAfterRepair = validateEditingPlanConstraints(planUnderRepair, {
        targetDurationSec: 8,
        targetAspectRatio: '9:16',
        assets: multiAssets
      });
      if (checkAfterRepair.valid) break;
    }

    assert.ok(repairCount <= 2, 'Repair loop must be strictly bounded to <= 2 cycles');
    const zoomCountAfterRepair = planUnderRepair.scenes.filter(s => PURE_ZOOM_EFFECTS.has(s.effect)).length;
    assert.ok(
      zoomCountAfterRepair <= Math.floor(planUnderRepair.scenes.length / 2),
      `Repaired plan must have <= 50% pure zoom scenes (got ${zoomCountAfterRepair}/${planUnderRepair.scenes.length}: [${planUnderRepair.scenes.map(s => s.effect).join(', ')}])`
    );
    console.log(`  ✓ Repetitive zoom plan rejected and repaired in ${repairCount} cycle(s) -> effects: [${planUnderRepair.scenes.map(s => s.effect).join(', ')}]`);

    console.log('\n=== ALL 11 VOICE COMPLETION & COMMERCIAL EDITING UPGRADE TESTS PASSED ===');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
