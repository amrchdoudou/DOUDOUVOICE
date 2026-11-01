import fs from 'node:fs';
import path from 'node:path';
import { executeModalRendering, inspectAndValidateMp4 } from '../server/modalRunner.js';
import { EditingPlan } from '../server/metaCreatorService.js';

async function runRenderingAuditSuite() {
  console.log("=================================================");
  console.log("DoudouVoice AI Creator Rendering Audit & Test Suite");
  console.log("=================================================\n");

  const testDir = path.join(process.cwd(), "creator_storage", "test_audit_suite");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 1. Prepare Test Assets (Valid Image & Valid Audio WAV)
  const imagePath = path.join(testDir, "test_image.png");
  if (!fs.existsSync(imagePath)) {
    // 1x1 PNG pixel
    const pngBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    fs.writeFileSync(imagePath, pngBuffer);
  }

  // 3 seconds 24kHz 16-bit mono WAV audio (48000 bytes/sec PCM)
  const wavPath = path.join(testDir, "test_voiceover.wav");
  const pcmSize = 48000 * 3; // 3 seconds
  const pcmBuffer = Buffer.alloc(pcmSize);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmSize, 40);
  fs.writeFileSync(wavPath, Buffer.concat([header, pcmBuffer]));

  const assets = [
    {
      id: "asset_audit_1",
      type: "image" as const,
      filePath: imagePath,
      originalName: "test_image.png"
    }
  ];

  const editingPlan: EditingPlan = {
    totalDurationSec: 10,
    aspectRatio: "9:16",
    resolution: { width: 1080, height: 1920 },
    scenes: [
      {
        assetId: "asset_audit_1",
        type: "image",
        timelineStartTimeSec: 0,
        durationSec: 10,
        effect: "slow_zoom_in",
        transitionOut: "none"
      }
    ],
    audio: {
      voiceoverAudioPath: wavPath,
      voiceoverVolume: 1.5,
      backgroundMusicVolume: 0.15,
      ducking: true
    },
    subtitles: []
  };

  // TEST 1: QuickTime-Compatible H.264/AAC MP4 Export with Audio
  console.log("--- TEST 1: QuickTime-Compatible H.264/AAC Export (With Audio) ---");
  const outputAudioMp4 = path.join(testDir, "output_with_audio.mp4");
  const result1 = await executeModalRendering({
    projectId: "audit_project_audio",
    assets,
    editingPlan,
    masterVoiceoverPath: wavPath,
    outputFilePath: outputAudioMp4
  });

  console.log(`Render Mode: ${result1.renderedVia}`);
  console.log(`Validation Success: ${result1.success}`);
  console.log(`Video Codec: ${result1.validation.video.codec}`);
  console.log(`Pixel Format: ${result1.validation.video.pixFmt}`);
  console.log(`Resolution: ${result1.validation.video.width}x${result1.validation.video.height}`);
  console.log(`Audio Codec: ${result1.validation.audio.codec}`);
  console.log(`Has Audio Input: ${result1.hasAudioInputSupplied}`);
  console.log(`Summary: ${result1.validation.summary}`);

  if (!result1.success || result1.validation.video.codec !== 'h264' || result1.validation.video.pixFmt !== 'yuv420p' || result1.validation.audio.codec !== 'aac') {
    throw new Error(`TEST 1 Failed: ${result1.validation.summary}`);
  }
  console.log("✅ TEST 1 PASSED!\n");

  // TEST 2: Video-Only Export (No Audio Input)
  console.log("--- TEST 2: Video-Only QuickTime Export (No Audio Input) ---");
  const outputNoAudioMp4 = path.join(testDir, "output_no_audio.mp4");
  const result2 = await executeModalRendering({
    projectId: "audit_project_no_audio",
    assets,
    editingPlan,
    masterVoiceoverPath: path.join(testDir, "non_existent.wav"), // Missing audio input
    outputFilePath: outputNoAudioMp4
  });

  console.log(`Render Mode: ${result2.renderedVia}`);
  console.log(`Validation Success: ${result2.success}`);
  console.log(`Video Codec: ${result2.validation.video.codec}`);
  console.log(`Pixel Format: ${result2.validation.video.pixFmt}`);
  console.log(`Has Audio Input: ${result2.hasAudioInputSupplied}`);
  console.log(`Video Only: ${result2.videoOnly}`);
  console.log(`Is Audio Stream Present: ${result2.validation.audio.isAudioPresent}`);
  console.log(`Summary: ${result2.validation.summary}`);

  if (!result2.success || result2.hasAudioInputSupplied || !result2.videoOnly) {
    throw new Error(`TEST 2 Failed: Expected video-only export without fake audio synthesis.`);
  }
  console.log("✅ TEST 2 PASSED!\n");

  // TEST 3: Strict Failure Detection on Corrupted File
  console.log("--- TEST 3: Strict FFprobe Failure Detection on Corrupted Output ---");
  const corruptFile = path.join(testDir, "corrupt_fake.mp4");
  fs.writeFileSync(corruptFile, "NOT_AN_MP4_FILE_DATA_CORRUPT");

  const validation3 = await inspectAndValidateMp4(
    corruptFile,
    10,
    1080,
    1920,
    true,
    'Local Server FFmpeg'
  );

  console.log(`Validation Success: ${validation3.valid}`);
  console.log(`Detected Errors: ${validation3.errors.join(' | ')}`);

  if (validation3.valid) {
    throw new Error("TEST 3 Failed: Validation reported success for corrupted file.");
  }
  console.log("✅ TEST 3 PASSED! (Corrupted file correctly rejected)\n");

  console.log("=================================================");
  console.log("ALL RENDERING AUDIT TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
}

runRenderingAuditSuite().catch(err => {
  console.error("Rendering audit suite failed:", err);
  process.exit(1);
});
