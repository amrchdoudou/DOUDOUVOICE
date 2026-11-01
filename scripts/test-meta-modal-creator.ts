import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeCreatorAssets,
  generateCreatorCreativeDirection,
  generateCreatorScript,
  synthesizeCreatorVoiceover,
  generateCreatorEditingPlan,
  CreatorAsset
} from '../server/metaCreatorService.js';
import { executeModalRendering } from '../server/modalRunner.js';

async function testMetaModalCreatorPipeline() {
  console.log("=== Testing Meta AI Video Creator + Modal Cloud Pipeline ===");

  const testDir = path.join(process.cwd(), "creator_storage", "test_project_001");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // Create mock image asset for test
  const mockImagePath = path.join(testDir, "mock_product.png");
  if (!fs.existsSync(mockImagePath)) {
    // 1x1 transparent PNG buffer as dummy file
    const dummyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    fs.writeFileSync(mockImagePath, dummyPng);
  }

  const assets: CreatorAsset[] = [
    {
      id: "asset_test_1",
      type: "image",
      filePath: mockImagePath,
      originalName: "mock_product.png",
      mimeType: "image/png"
    }
  ];

  try {
    // Stage A: Multimodal Asset Analysis
    console.log("\n1. Testing Stage A: Meta Multimodal Asset Analysis...");
    const analysis = await analyzeCreatorAssets(assets, testDir);
    console.log("Stage A Output:", JSON.stringify(analysis, null, 2));

    // Stage B: Meta Creative Direction
    console.log("\n2. Testing Stage B: Meta Creative Direction...");
    const direction = await generateCreatorCreativeDirection(analysis, "Promote wireless earbuds sale", 10, "9:16");
    console.log("Stage B Output:", JSON.stringify(direction, null, 2));

    // Stage C: Meta Script Generation
    console.log("\n3. Testing Stage C: Meta Script Generation...");
    const script = await generateCreatorScript(direction, analysis, "Algerian Darija", "ar-DZ-Amir");
    console.log("Stage C Output:", JSON.stringify(script, null, 2));

    // Stage D: DoudouVoice TTS Voice Synthesis
    console.log("\n4. Testing Stage D: Voice Synthesis via DoudouVoice TTS...");
    const voiceoverInfo = await synthesizeCreatorVoiceover(script, testDir);
    console.log(`Stage D Output: Total voiceover duration = ${voiceoverInfo.totalVoiceoverDurationSec}s across ${voiceoverInfo.audioSegments.length} segments.`);

    // Stage E: Meta Editing Director (Editing Plan)
    console.log("\n5. Testing Stage E: Meta Editing Director...");
    const editingPlan = await generateCreatorEditingPlan(direction, script, analysis, voiceoverInfo, assets);
    console.log("Stage E Output:", JSON.stringify(editingPlan, null, 2));

    // Stage 3: Modal Cloud / Local FFmpeg Rendering
    console.log("\n6. Testing Stage 3: Modal Cloud Remote / Local FFmpeg Video Rendering...");
    const finalVideoPath = path.join(testDir, "final_creator_test.mp4");
    const renderResult = await executeModalRendering({
      projectId: "test_project_001",
      assets,
      editingPlan,
      masterVoiceoverPath: voiceoverInfo.masterVoiceoverPath,
      outputFilePath: finalVideoPath
    });

    console.log(`\n=== Pipeline Test Succeeded! ===`);
    console.log(`Rendered Via: ${renderResult.renderedVia}`);
    console.log(`Final Video File: ${renderResult.finalVideoPath}`);
    console.log(`Duration: ${renderResult.durationSec}s`);
    console.log(`File Size: ${(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);

  } catch (err: any) {
    console.error("Pipeline test failed:", err);
    process.exit(1);
  }
}

testMetaModalCreatorPipeline();
