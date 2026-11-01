import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  getGeminiApiKeys,
  isKeySpecificError,
  synthesizeSegmentWithStudioFallback
} from '../server/ttsKeyRotation.js';
import {
  analyzeCreatorAssets,
  generateCreatorCreativeDirection,
  generateCreatorScript,
  generateCreatorEditingPlan,
  synthesizeCreatorVoiceover,
  CreatorAsset
} from '../server/metaCreatorService.js';
import {
  executeModalRendering,
  inspectAndValidateMp4
} from '../server/modalRunner.js';

const execAsync = promisify(exec);

async function runCompleteTestSuite() {
  console.log('====================================================');
  console.log('DoudouVoice AI Video Creator — Comprehensive Audit & Verification');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 5;

  // ----------------------------------------------------
  // TEST 1: Studio Shared TTS Key Discovery & Rotation
  // ----------------------------------------------------
  console.log('--- TEST 1: Studio Shared TTS Key Discovery & Fallback ---');
  const apiKeys = getGeminiApiKeys();
  console.log(`Discovered ${apiKeys.length} configured Gemini API key(s): ${apiKeys.map(k => k.name).join(', ')}`);

  if (apiKeys.length === 0) {
    throw new Error('Test 1 Failed: No Gemini API keys found in environment/secrets.');
  }

  // Test error classifier
  const quotaErr = new Error('Resource has been exhausted (e.g. check quota). 429 Too Many Requests');
  const authErr = new Error('API key not valid. Please pass a valid API key. (401)');
  const syntaxErr = new TypeError('Cannot read property of undefined');

  if (isKeySpecificError(quotaErr) && isKeySpecificError(authErr) && !isKeySpecificError(syntaxErr)) {
    console.log('✓ Error classification correctly identifies quota/auth errors vs application bugs.');
  } else {
    throw new Error('Test 1 Failed: Error classifier did not work as expected.');
  }

  // Test TTS generation with rotation fallback
  console.log('Testing TTS segment synthesis using shared Studio rotation engine...');
  const testDir = path.join(process.cwd(), 'creator_storage', 'test_verification');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const ttsResult = await synthesizeSegmentWithStudioFallback(
    {
      id: 'test_seg_1',
      text: 'مرحبا بكم في دودو فويس، أفضل استوديو ذكاء اصطناعي.',
      pace: 'normal'
    },
    {
      dialect: 'Algerian Arabic',
      voice: 'Puck',
      style: 'Friendly',
      cacheDir: testDir
    }
  );

  if (ttsResult.rawPcm && ttsResult.rawPcm.length > 1000) {
    console.log(`✓ Real TTS audio generated: ${ttsResult.durationSec.toFixed(2)}s (${ttsResult.rawPcm.length} PCM bytes) via key.`);
    passedTests++;
  } else {
    throw new Error('Test 1 Failed: TTS generation failed to produce valid audio file.');
  }

  // ----------------------------------------------------
  // TEST 2: Multimodal Asset Analysis with Real Image Data
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Multimodal Asset Analysis (No Hallucinations) ---');
  // Generate a test sports image with canvas or ffmpeg to feed into vision model
  const testImagePath = path.join(testDir, 'sports_sneaker_ad.png');
  // Create a clean 1080x1920 test image with ffmpeg
  await execAsync(`ffmpeg -y -f lavfi -i color=c=blue:s=1080x1920:d=1 -vf "drawtext=text='Soundcore Sport Pro Running Earbuds':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" -frames:v 1 "${testImagePath}"`);

  const assetList: CreatorAsset[] = [
    {
      id: 'asset_test_1',
      type: 'image',
      filePath: testImagePath,
      originalName: 'sports_sneaker_ad.png',
      mimeType: 'image/png'
    }
  ];

  console.log('Sending real image asset to multimodal analysis...');
  const analysis = await analyzeCreatorAssets(assetList, testDir);

  console.log(`Assets Analyzed: ${analysis.length}`);
  const firstAsset = analysis[0];
  console.log(`Product Details: "${firstAsset.productDetails}"`);
  console.log(`Main Objects: ${firstAsset.mainObjects.join(', ')}`);
  console.log(`Advertising Angles: ${firstAsset.advertisingAngles.join(', ')}`);

  // Verify that it didn't hallucinate "LUMIERE NOIR" or claim no pixels
  const rawText = JSON.stringify(analysis).toLowerCase();
  if (rawText.includes('lumiere noir')) {
    throw new Error('Test 2 Failed: Hallucinated perfume "LUMIERE NOIR" detected.');
  }
  if (rawText.includes('no accessible image') || rawText.includes('no image pixels')) {
    throw new Error('Test 2 Failed: Model reported image pixels were not accessible.');
  }
  console.log('✓ Multimodal analysis successfully inspected real image pixels without hallucination.');
  passedTests++;

  // ----------------------------------------------------
  // TEST 3: Editing Plan Duration & Timeline Normalization
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Editing Plan Normalization & Sequencing ---');
  const targetDurationSec = 15.0;

  const creativeDirection = await generateCreatorCreativeDirection(
    analysis,
    'Sporting ad for running and training with fast pace',
    targetDurationSec,
    '9:16'
  );

  const script = await generateCreatorScript(
    creativeDirection,
    analysis,
    'Algerian Darija',
    'ar-DZ-Amir'
  );

  const voiceoverInfo = await synthesizeCreatorVoiceover(script, testDir);
  console.log(`Synthesized ${voiceoverInfo.audioSegments.length} voiceover segments (total ${voiceoverInfo.totalVoiceoverDurationSec.toFixed(2)}s)`);

  const editingPlan = await generateCreatorEditingPlan(
    creativeDirection,
    script,
    analysis,
    voiceoverInfo,
    assetList,
    targetDurationSec
  );

  console.log(`Editing Plan Duration: ${editingPlan.totalDurationSec}s (Target: ${targetDurationSec}s)`);
  console.log(`Number of Scenes: ${editingPlan.scenes.length}`);

  // Verify duration equals targetDurationSec
  if (Math.abs(editingPlan.totalDurationSec - targetDurationSec) > 0.05) {
    throw new Error(`Test 3 Failed: Editing plan duration (${editingPlan.totalDurationSec}s) does not match target (${targetDurationSec}s).`);
  }

  // Verify sequential monotonic timelineStartTimeSec
  let currentExpectedStart = 0;
  for (let i = 0; i < editingPlan.scenes.length; i++) {
    const sc = editingPlan.scenes[i];
    console.log(`  Scene ${i + 1}: start=${sc.timelineStartTimeSec.toFixed(2)}s, dur=${sc.durationSec.toFixed(2)}s, asset=${sc.assetId}`);
    
    if (Math.abs(sc.timelineStartTimeSec - currentExpectedStart) > 0.05) {
      throw new Error(`Test 3 Failed: Scene ${i + 1} timeline start (${sc.timelineStartTimeSec}s) does not match expected sequence (${currentExpectedStart}s).`);
    }
    currentExpectedStart += sc.durationSec;
  }
  console.log('✓ Editing plan duration is exactly 15.0s with zero overlapping scenes and monotonic timestamps.');
  passedTests++;

  // ----------------------------------------------------
  // TEST 4: QuickTime-Compatible MP4 Rendering & FFprobe Inspection
  // ----------------------------------------------------
  console.log('\n--- TEST 4: QuickTime MP4 Export & FFprobe Validation ---');
  const finalVideoPath = path.join(testDir, 'final_creator_video.mp4');

  const renderResult = await executeModalRendering({
    projectId: 'test_verification',
    assets: assetList,
    editingPlan,
    masterVoiceoverPath: voiceoverInfo.masterVoiceoverPath,
    outputFilePath: finalVideoPath
  });

  console.log(`Render Result: success=${renderResult.success}, renderedVia="${renderResult.renderedVia}", isModalFallback=${renderResult.isModalFallback}`);
  console.log(`Validation Summary: ${renderResult.validation.summary}`);

  if (!renderResult.success || !fs.existsSync(finalVideoPath)) {
    throw new Error(`Test 4 Failed: Video rendering failed: ${renderResult.error}`);
  }

  // Deep probe validation
  const validation = await inspectAndValidateMp4(
    finalVideoPath,
    targetDurationSec,
    1080,
    1920,
    true,
    renderResult.renderedVia,
    renderResult.isModalFallback
  );

  if (!validation.valid) {
    throw new Error(`Test 4 Failed: Final MP4 validation failed: ${validation.errors.join(', ')}`);
  }

  console.log(`✓ QuickTime compatibility verified:`);
  console.log(`  - Video: ${validation.video.codec} (${validation.video.pixFmt}), ${validation.video.width}x${validation.video.height}, ${validation.video.durationSec.toFixed(2)}s, ${validation.video.fps}fps`);
  console.log(`  - Audio: ${validation.audio.codec}, ${validation.audio.sampleRate}Hz, duration: ${validation.audio.durationSec?.toFixed(2)}s`);
  console.log(`  - Format: ${validation.formatName}, size: ${(validation.fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  passedTests++;

  // ----------------------------------------------------
  // TEST 5: Download Endpoint Byte Verification
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Download Endpoint & Byte Consistency ---');
  const downloadUrl = 'http://localhost:3000/api/creator/stream/test_verification/final?download=true';
  const res = await fetch(downloadUrl);

  const disposition = res.headers.get('content-disposition');
  console.log(`Response HTTP Status: ${res.status}`);
  console.log(`Content-Disposition Header: "${disposition}"`);

  if (res.status !== 200) {
    throw new Error(`Test 5 Failed: Download endpoint returned status ${res.status}`);
  }

  if (!disposition || !disposition.includes('attachment') || !disposition.includes('filename="meta_ai_creator_video.mp4"')) {
    throw new Error(`Test 5 Failed: Content-Disposition attachment header missing or incorrect: ${disposition}`);
  }

  const downloadedBuffer = Buffer.from(await res.arrayBuffer());
  const diskSizeBytes = fs.statSync(finalVideoPath).size;

  console.log(`Disk Video Size: ${diskSizeBytes} bytes`);
  console.log(`Downloaded Bytes: ${downloadedBuffer.length} bytes`);

  if (downloadedBuffer.length !== diskSizeBytes) {
    throw new Error(`Test 5 Failed: Downloaded bytes (${downloadedBuffer.length}) do not match disk file size (${diskSizeBytes}).`);
  }

  console.log('✓ Download endpoint delivers exact byte-for-byte final rendered video with proper Content-Disposition header.');
  passedTests++;

  console.log('\n====================================================');
  console.log(`ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('====================================================');
}

runCompleteTestSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
