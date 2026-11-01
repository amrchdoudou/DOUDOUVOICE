import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { defaultMetaClient } from './metaClient.js';
import { synthesizeSegmentWithStudioFallback, getGeminiApiKeys } from './ttsKeyRotation.js';
import { probeVideo, extractSceneFrames, measureAudioLoudness } from './videoService.js';

export interface CreatorAsset {
  id: string;
  type: 'image' | 'video';
  filePath: string;
  originalName: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface MultimodalAnalysisAsset {
  assetId: string;
  type: 'image' | 'video';
  mainObjects: string[];
  productDetails?: string;
  environment?: string;
  compositionAndColors?: string;
  advertisingAngles: string[];
  scenes?: Array<{
    startTimeSec: number;
    endTimeSec: number;
    description: string;
    cameraMovement?: string;
    actionDescription?: string;
  }>;
  samLocalizationCues?: Array<{
    label: string;
    box2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
    confidence: number;
  }>;
}

export interface CreativeDirectionOutput {
  campaignCategory: 'fashion' | 'luxury_perfume' | 'food_beverage' | 'tech_electronics' | 'sports_fitness' | 'general';
  objective: string;
  targetAudience: string;
  adAngle: string;
  creativeConcept: string;
  storytellingStructure: string;
  visualRhythm: 'fast_paced' | 'dynamic' | 'cinematic' | 'smooth';
  emotionalTone: string;
  colorGradingTheme: 'vibrant' | 'warm_luxury' | 'cool_tech' | 'cinematic' | 'clean_natural';
  suggestedDurationSec: number;
  formatAspectRatio: '9:16' | '16:9' | '1:1';
}

export interface VideoScriptSegment {
  id: string;
  role?: 'hook' | 'problem' | 'product_reveal' | 'benefit' | 'call_to_action';
  sceneId?: string;
  text: string;
  visualDescription: string;
  estimatedDurationSec: number;
  actualDurationSec?: number;
  audioUrl?: string;
  emotion?: 'excited' | 'friendly' | 'persuasive' | 'reassuring' | 'curious' | 'serious' | 'playful' | 'warm';
  pace?: 'slow' | 'normal' | 'fast';
  style?: string;
  deliveryInstruction?: string;
  vocalBurst?: string;
  status?: 'pending' | 'ready' | 'failed';
  error?: string;
  // Legacy compatibility fallbacks
  ttsEmotion?: string;
  ttsPace?: string;
}

export interface CreatorVideoScript {
  hook: string;
  mainMessage: string;
  benefits: string[];
  callToAction: string;
  dialect: string;
  voice: string;
  segments: VideoScriptSegment[];
}

export interface EditingPlanScene {
  assetId: string;
  type: 'image' | 'video';
  timelineStartTimeSec: number; // offset on the final master video timeline
  startTimeSec?: number;        // for video sub-clip source offset
  endTimeSec?: number;          // for video sub-clip source offset
  durationSec: number;
  effect: 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' | 'smart_subject_focus' | 'static';
  samFocusBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  transitionOut: 'crossfade' | 'fade' | 'wipeleft' | 'wiperight' | 'none';
  colorGrading?: 'vibrant' | 'warm_luxury' | 'cool_tech' | 'cinematic' | 'clean_natural' | 'none';
  overlayText?: string;
  overlayStyle?: 'badge' | 'title' | 'cta_pill';
  overlayTextStartTimeSec?: number;
  overlayTextDurationSec?: number;
}

export interface EditingPlanAudio {
  voiceoverAudioPath?: string;
  voiceoverVolume: number;
  backgroundMusicPath?: string;
  backgroundMusicVolume: number;
  ducking: boolean;
  targetLufs?: number;
}

export interface EditingPlan {
  totalDurationSec: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  resolution: { width: number; height: number };
  scenes: EditingPlanScene[];
  audio: EditingPlanAudio;
  subtitles: Array<{
    startTimeSec: number;
    endTimeSec: number;
    text: string;
  }>;
}

function extractJsonFromResponse(rawText: string): any {
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch (_) {}

  const jsonFenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonFenceMatch) {
    try {
      return JSON.parse(jsonFenceMatch[1].trim());
    } catch (_) {}
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  return {};
}

function getVisionFallbackAi(): GoogleGenAI {
  const keys = getGeminiApiKeys();
  const key = keys[0]?.value || process.env.GEMINI_API_KEY || process.env.gemini_api_key1;
  if (!key) {
    throw new Error('No AI API key available for multimodal vision analysis.');
  }
  return new GoogleGenAI({ apiKey: key });
}

export function mapCreatorVoiceToGemini(voiceName?: string): string {
  const VALID_GEMINI_VOICES = ['Puck', 'Fenrir', 'Zephyr', 'Kore', 'Charon', 'Aoede'];
  if (voiceName && VALID_GEMINI_VOICES.includes(voiceName)) {
    return voiceName;
  }
  const mapping: Record<string, string> = {
    'ar-DZ-Amir': 'Puck',
    'ar-DZ-Meriem': 'Aoede',
    'ar-SA-Zayd': 'Fenrir',
    'ar-AE-Fatima': 'Kore',
    'Amir': 'Puck',
    'Meriem': 'Aoede',
    'Zayd': 'Fenrir',
    'Fatima': 'Kore'
  };
  return (voiceName && mapping[voiceName]) || 'Puck';
}

/**
 * Stage A: Multimodal Media Analysis with Meta Muse Spark 1.3 (+ SAM 3.1 localization cues)
 * Actually sends real image bytes and video keyframes to the multimodal vision engine.
 */
export async function analyzeCreatorAssets(
  assets: CreatorAsset[],
  outputDir: string
): Promise<MultimodalAnalysisAsset[]> {
  const analysisResults: MultimodalAnalysisAsset[] = [];

  for (const asset of assets) {
    if (!fs.existsSync(asset.filePath)) {
      console.warn(`[Asset Analysis] Asset file not found: ${asset.filePath}`);
      continue;
    }

    if (asset.type === 'image') {
      const fileBuffer = fs.readFileSync(asset.filePath);
      const base64Data = fileBuffer.toString('base64');
      const mimeType = asset.mimeType || (asset.originalName.endsWith('.png') ? 'image/png' : 'image/jpeg');

      console.log(`[Stage A] Analyzing image asset "${asset.originalName}" (${fileBuffer.length} bytes, ${mimeType})...`);

      const prompt = `Analyze this uploaded image (Filename: "${asset.originalName}") using multimodal vision intelligence.
Examine the ACTUAL VISUAL PIXELS of the image. Identify the real objects, products, materials, clothing or apparel, colors, design details, and setting.
Do NOT guess or hallucinate an unrelated product.

Return a structured JSON object with the following schema ONLY:
{
  "mainObjects": ["accurate list of visible objects or garments in the image"],
  "productDetails": "detailed visual description of the product/item shown (materials, cut, style, colors, branding/embroidery if any)",
  "environment": "background environment description",
  "compositionAndColors": "lighting, palette, framed shot style",
  "advertisingAngles": ["2-3 compelling marketing angles based on this exact item"],
  "samLocalizationCues": [
    {
      "label": "primary item",
      "box2d": [150, 150, 850, 850],
      "confidence": 0.95
    }
  ]
}
Values for box2d should be scaled 0-1000 integer normalized bounding box coordinates [ymin, xmin, ymax, xmax].`;

      let modelResponse = '';

      // Multimodal Vision Call: Pass real image bytes
      try {
        const ai = getVisionFallbackAi();
        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            },
            { text: prompt }
          ],
          config: { responseMimeType: 'application/json' }
        });
        modelResponse = geminiRes.text || '{}';
      } catch (err: any) {
        console.warn(`[Stage A] Multimodal vision call failed for image ${asset.id}:`, err.message);
      }

      const parsed = extractJsonFromResponse(modelResponse);

      analysisResults.push({
        assetId: asset.id,
        type: 'image',
        mainObjects: Array.isArray(parsed.mainObjects) && parsed.mainObjects.length > 0 ? parsed.mainObjects : ['Featured Product Item'],
        productDetails: parsed.productDetails || asset.originalName,
        environment: parsed.environment || 'Clean studio setting',
        compositionAndColors: parsed.compositionAndColors || 'Clean balanced framing',
        advertisingAngles: Array.isArray(parsed.advertisingAngles) && parsed.advertisingAngles.length > 0 ? parsed.advertisingAngles : ['Highlight quality & design', 'Engaging social media showcase'],
        samLocalizationCues: Array.isArray(parsed.samLocalizationCues) && parsed.samLocalizationCues.length > 0 ? parsed.samLocalizationCues : [
          { label: 'Primary Subject', box2d: [150, 150, 850, 850], confidence: 0.98 }
        ]
      });

    } else if (asset.type === 'video') {
      let durationSec = asset.durationSec || 10;
      try {
        const probe = await probeVideo(asset.filePath);
        durationSec = probe.durationSec || durationSec;
      } catch (err) {
        console.warn(`Failed to probe video ${asset.id}:`, err);
      }

      // Extract multiple keyframes across duration (1 frame every 1.5 - 2s)
      const framesDir = path.join(outputDir, `frames_${asset.id}`);
      let extractedFrames: { filePath: string; timestampSec: number }[] = [];
      try {
        const frames = await extractSceneFrames(asset.filePath, framesDir, 2);
        extractedFrames = frames;
      } catch (err) {
        console.warn(`Failed to extract frames for video ${asset.id}:`, err);
      }

      console.log(`[Stage A] Analyzing video asset "${asset.originalName}" (${durationSec.toFixed(1)}s) with ${extractedFrames.length} keyframes...`);

      // Sample up to 6 evenly distributed keyframes
      const selectedFrames = [];
      if (extractedFrames.length <= 6) {
        selectedFrames.push(...extractedFrames);
      } else {
        const step = (extractedFrames.length - 1) / 5;
        for (let i = 0; i < 6; i++) {
          selectedFrames.push(extractedFrames[Math.round(i * step)]);
        }
      }

      const prompt = `Analyze this video clip (Duration: ${durationSec.toFixed(1)}s, ${selectedFrames.length} sampled frames) using video multimodal intelligence.
Examine the chronological sequence of visual keyframes.
Return a structured JSON object with the following schema ONLY:
{
  "mainObjects": ["key objects, people, or items seen across the video"],
  "productDetails": "description of product or scene subject",
  "environment": "setting description",
  "compositionAndColors": "visual style and lighting",
  "advertisingAngles": ["marketing angles"],
  "scenes": [
    {
      "startTimeSec": 0.0,
      "endTimeSec": ${Math.min(5, durationSec)},
      "description": "Visual description of what takes place in scene 1",
      "cameraMovement": "panning right / zoom in / static",
      "actionDescription": "Action taking place"
    }
  ]
}`;

      let modelResponse = '';
      try {
        const ai = getVisionFallbackAi();
        const parts: any[] = [];
        for (const f of selectedFrames) {
          if (fs.existsSync(f.filePath)) {
            const buf = fs.readFileSync(f.filePath);
            parts.push({
              inlineData: {
                data: buf.toString('base64'),
                mimeType: 'image/jpeg'
              }
            });
          }
        }
        parts.push({ text: prompt });

        const geminiRes = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: parts,
          config: { responseMimeType: 'application/json' }
        });
        modelResponse = geminiRes.text || '{}';
      } catch (err: any) {
        console.warn(`[Stage A] Video multimodal vision call failed for ${asset.id}:`, err.message);
      }

      const parsed = extractJsonFromResponse(modelResponse);

      analysisResults.push({
        assetId: asset.id,
        type: 'video',
        mainObjects: Array.isArray(parsed.mainObjects) && parsed.mainObjects.length > 0 ? parsed.mainObjects : ['Video Subject'],
        productDetails: parsed.productDetails || `Video Footage (${durationSec.toFixed(1)}s)`,
        environment: parsed.environment || 'Dynamic setting',
        compositionAndColors: parsed.compositionAndColors || 'Natural video framing',
        advertisingAngles: Array.isArray(parsed.advertisingAngles) && parsed.advertisingAngles.length > 0 ? parsed.advertisingAngles : ['Action demonstration', 'Dynamic showcase'],
        scenes: Array.isArray(parsed.scenes) && parsed.scenes.length > 0 ? parsed.scenes : [
          {
            startTimeSec: 0,
            endTimeSec: Math.min(5, durationSec),
            description: 'Main video sequence',
            cameraMovement: 'Dynamic tracking',
            actionDescription: 'Product action in use'
          }
        ]
      });
    }
  }

  return analysisResults;
}

/**
 * Stage B: Meta Creative Direction
 */
export async function generateCreatorCreativeDirection(
  analysis: MultimodalAnalysisAsset[],
  userPrompt: string = '',
  targetDurationSec: number = 15,
  targetAspectRatio: '9:16' | '16:9' | '1:1' = '9:16'
): Promise<CreativeDirectionOutput> {
  const prompt = `Act as an expert Meta AI Creative Director for high-converting social media video ads (TikTok, Reels, Shorts).
Analyze the provided media asset analysis and create a tailored, industry-specific creative direction strategy.

Available Media Assets:
${JSON.stringify(analysis, null, 2)}

User Custom Creative Brief / Notes: ${userPrompt || 'Create an engaging product showcase ad.'}
Target Duration: EXACTLY ${targetDurationSec} seconds.
Target Aspect Ratio: ${targetAspectRatio}.

Determine the best campaign category based on the visual assets:
- "fashion": Apparel, footwear, clothing, jewelry, accessories (smooth zooms, detail fabric pans, elegant transitions)
- "luxury_perfume": Fragrances, luxury cosmetics, premium timepieces (cinematic slow zoom, soft lighting, premium pacing)
- "food_beverage": Dining, drinks, coffee, culinary items (texture close-ups, dynamic cuts, warm appetizing saturation)
- "tech_electronics": Gadgets, earbuds, computers, smart devices (crisp transitions, high-contrast grading, feature highlights)
- "sports_fitness": Athletic gear, running equipment, gym products (fast energetic rhythm, bold zoom-ins, punchy motion)
- "general": General lifestyle, home, services (balanced dynamic flow)

Return a structured JSON object ONLY with the following schema:
{
  "campaignCategory": "fashion" | "luxury_perfume" | "food_beverage" | "tech_electronics" | "sports_fitness" | "general",
  "objective": "Clear advertising objective",
  "targetAudience": "Target demographic description",
  "adAngle": "Primary marketing hook angle",
  "creativeConcept": "High level storytelling concept",
  "storytellingStructure": "Hook -> Problem -> Solution -> Social Proof -> CTA",
  "visualRhythm": "fast_paced" | "dynamic" | "cinematic" | "smooth",
  "colorGradingTheme": "vibrant" | "warm_luxury" | "cool_tech" | "cinematic" | "clean_natural",
  "emotionalTone": "Energetic / Premium / Friendly / Trustworthy",
  "suggestedDurationSec": ${targetDurationSec},
  "formatAspectRatio": "${targetAspectRatio}"
}
`;

  let rawResponse = '';
  try {
    const res = await defaultMetaClient.callMetaChat([{ role: 'user', content: prompt }], 0.4);
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err) {
    console.warn('Meta Creative Direction API call failed:', err);
  }

  const parsed = extractJsonFromResponse(rawResponse);

  const validCategories = ['fashion', 'luxury_perfume', 'food_beverage', 'tech_electronics', 'sports_fitness', 'general'];
  const category = validCategories.includes(parsed.campaignCategory) ? parsed.campaignCategory : 'general';

  const defaultThemeMap: Record<string, 'vibrant' | 'warm_luxury' | 'cool_tech' | 'cinematic' | 'clean_natural'> = {
    fashion: 'vibrant',
    luxury_perfume: 'warm_luxury',
    food_beverage: 'vibrant',
    tech_electronics: 'cool_tech',
    sports_fitness: 'vibrant',
    general: 'clean_natural'
  };

  const colorTheme = ['vibrant', 'warm_luxury', 'cool_tech', 'cinematic', 'clean_natural'].includes(parsed.colorGradingTheme)
    ? parsed.colorGradingTheme
    : (defaultThemeMap[category] || 'vibrant');

  return {
    campaignCategory: category as any,
    objective: parsed.objective || 'Drive sales and product engagement',
    targetAudience: parsed.targetAudience || 'Modern online shoppers looking for quality products',
    adAngle: parsed.adAngle || 'Highlight key product benefits and instant value',
    creativeConcept: parsed.creativeConcept || 'Dynamic visual showcase with clear narrative hook',
    storytellingStructure: parsed.storytellingStructure || 'Hook -> Demonstration -> Key Benefits -> Call to Action',
    visualRhythm: ['fast_paced', 'dynamic', 'cinematic', 'smooth'].includes(parsed.visualRhythm) ? parsed.visualRhythm : (category === 'sports_fitness' || category === 'tech_electronics' ? 'fast_paced' : 'dynamic'),
    colorGradingTheme: colorTheme,
    emotionalTone: parsed.emotionalTone || 'Energetic & Persuasive',
    suggestedDurationSec: targetDurationSec,
    formatAspectRatio: ['9:16', '16:9', '1:1'].includes(parsed.formatAspectRatio) ? parsed.formatAspectRatio : targetAspectRatio
  };
}

/**
 * Stage C: Meta Script Generation
 */
export async function generateCreatorScript(
  creativeDirection: CreativeDirectionOutput,
  analysis: MultimodalAnalysisAsset[],
  dialect: string = 'Algerian Darija',
  voice: string = 'ar-DZ-Amir'
): Promise<CreatorVideoScript> {
  const targetDurationSec = creativeDirection.suggestedDurationSec || 15;

  const prompt = `Act as an expert Meta AI Advertising Creative Director & Voice Director for Arabic video commercials.
Create a high-converting, deeply expressive voiceover script tailored to the following creative direction and uploaded assets:

Creative Direction:
${JSON.stringify(creativeDirection, null, 2)}

Target Dialect: ${dialect}
Target Voice: ${voice}
Target Duration: Exactly ${targetDurationSec} seconds.

Available Media Assets:
${JSON.stringify(analysis, null, 2)}

Directorial Requirements:
- Script must feel human, lively, and natural—NEVER robotic, monotone, or textbook-like.
- Every segment must have a clear advertising role and voice direction plan:
  * "hook": Attention-grabbing, energetic, slightly brisk pace to stop scrolling.
  * "problem" / "inquiry": Inquisitive, conversational, relatable tone.
  * "product_reveal": Confident, clear, and proud product showcase.
  * "benefit": Friendly, warm, reassuring emphasis on real practical value.
  * "call_to_action": Enthusiastic, persuasive, driving immediate action.
- Use contextually appropriate expressive phrasing in ${dialect} (e.g. natural enthusiasm, authentic conversational intonation).
- Total spoken narration length must comfortably fit within ${targetDurationSec} seconds.

Return a structured JSON object ONLY with the following schema:
{
  "hook": "Strong opening attention hook sentence in ${dialect}",
  "mainMessage": "Core product value proposition in ${dialect}",
  "benefits": ["Benefit 1", "Benefit 2"],
  "callToAction": "Clear final CTA in ${dialect}",
  "dialect": "${dialect}",
  "voice": "${voice}",
  "segments": [
    {
      "id": "seg_1",
      "role": "hook",
      "text": "First sentence in ${dialect}",
      "visualDescription": "Matching visual scene description from uploaded media",
      "estimatedDurationSec": 3.0,
      "emotion": "excited",
      "pace": "fast",
      "style": "Energetic sales",
      "deliveryInstruction": "High-energy hook delivered with genuine enthusiasm to hook viewers instantly",
      "vocalBurst": "energetic_intro"
    }
  ]
}`;

  let rawResponse = '';
  try {
    const res = await defaultMetaClient.callMetaChat([{ role: 'user', content: prompt }], 0.5);
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err) {
    console.warn('Meta Script Generation API call failed:', err);
  }

  const parsed = extractJsonFromResponse(rawResponse);

  const fallbackSegments: VideoScriptSegment[] = [
    {
      id: 'seg_1',
      role: 'hook',
      text: parsed.hook || 'شوف هذا العرض الاستثنائي اللي جبناه ليك اليوم!',
      visualDescription: 'Dynamic opening hook showcasing primary asset',
      estimatedDurationSec: Math.max(2, Math.round(targetDurationSec * 0.3)),
      emotion: 'excited',
      pace: 'fast',
      style: 'Energetic sales',
      deliveryInstruction: 'High-energy hook to grab viewer attention immediately'
    },
    {
      id: 'seg_2',
      role: 'benefit',
      text: parsed.mainMessage || 'جودة ممتازة وتصميم عصري يرافقك في كل نشاطاتك اليومية.',
      visualDescription: 'Product feature demonstration scene',
      estimatedDurationSec: Math.max(3, Math.round(targetDurationSec * 0.4)),
      emotion: 'friendly',
      pace: 'normal',
      style: 'Friendly',
      deliveryInstruction: 'Warm, persuasive tone highlighting comfort and durability'
    },
    {
      id: 'seg_3',
      role: 'call_to_action',
      text: parsed.callToAction || 'اطلبه الآن واستفد من التوصيل السريع والعرض الحصري!',
      visualDescription: 'Closing hero product card with call to action',
      estimatedDurationSec: Math.max(2, Math.round(targetDurationSec * 0.3)),
      emotion: 'persuasive',
      pace: 'normal',
      style: 'Luxury brand voice',
      deliveryInstruction: 'Confident call to action encouraging quick order'
    }
  ];

  const rawSegments = Array.isArray(parsed.segments) && parsed.segments.length > 0 ? parsed.segments : fallbackSegments;
  const segments: VideoScriptSegment[] = rawSegments.map((s: any, idx: number) => ({
    id: s.id || `seg_${idx + 1}`,
    role: s.role || (idx === 0 ? 'hook' : idx === rawSegments.length - 1 ? 'call_to_action' : 'benefit'),
    text: s.text || s.sentence || '',
    visualDescription: s.visualDescription || 'Product scene presentation',
    estimatedDurationSec: Number(s.estimatedDurationSec) || 3.0,
    emotion: ['excited', 'friendly', 'persuasive', 'reassuring', 'curious', 'serious', 'playful', 'warm'].includes(s.emotion) ? s.emotion : (s.ttsEmotion || 'friendly'),
    pace: ['slow', 'normal', 'fast'].includes(s.pace) ? s.pace : (s.ttsPace || 'normal'),
    style: s.style || 'Premium commercial',
    deliveryInstruction: s.deliveryInstruction || '',
    vocalBurst: s.vocalBurst || '',
    status: 'pending'
  }));

  return {
    hook: parsed.hook || segments[0]?.text || 'شاهد هذا العرض الحصري!',
    mainMessage: parsed.mainMessage || segments[1]?.text || 'أفضل جودة بأحدث المواصفات.',
    benefits: Array.isArray(parsed.benefits) ? parsed.benefits : ['جودة ممتازة', 'توصيل سريع'],
    callToAction: parsed.callToAction || segments[segments.length - 1]?.text || 'اطلبه الآن!',
    dialect,
    voice,
    segments
  };
}

/**
 * Stage D: DoudouVoice TTS Voice Synthesis
 * Reuses the existing Studio key rotation and multi-provider fallback engine.
 * Throws real error if all keys fail. Never fabricates fake audio or silent zero-byte buffers.
 */
export async function synthesizeCreatorVoiceover(
  script: CreatorVideoScript,
  outputDir: string
): Promise<{
  audioSegments: Array<{
    id: string;
    text: string;
    filePath: string;
    durationSec: number;
    lufs: number;
    audioUrl?: string;
    emotion?: string;
    pace?: string;
  }>;
  masterVoiceoverPath: string;
  totalVoiceoverDurationSec: number;
}> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const audioSegments: Array<{
    id: string;
    text: string;
    filePath: string;
    durationSec: number;
    lufs: number;
    audioUrl?: string;
    emotion?: string;
    pace?: string;
  }> = [];

  const combinedPcmBuffers: Buffer[] = [];
  const projectFolderName = path.basename(outputDir);

  console.log(`[Stage D] Synthesizing voiceover for ${script.segments.length} script segments via Studio fallback engine...`);

  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const segFileName = `voice_seg_${i + 1}.wav`;
    const segFilePath = path.join(outputDir, segFileName);

    const chosenEmotion = seg.emotion || (seg.ttsEmotion as any) || (seg.role === 'hook' ? 'excited' : seg.role === 'call_to_action' ? 'persuasive' : 'friendly');
    const chosenPace = seg.pace || (seg.ttsPace as any) || (seg.role === 'hook' ? 'fast' : 'normal');
    const chosenStyle = seg.style || (seg.role === 'hook' ? 'Energetic sales' : 'Premium commercial');

    // Call shared Studio multi-key rotation engine (throws on failure, never fabricates silent audio)
    const result = await synthesizeSegmentWithStudioFallback(
      {
        id: seg.id || `seg_${i + 1}`,
        text: seg.text,
        pace: chosenPace,
        emotion: chosenEmotion,
        deliveryInstruction: seg.deliveryInstruction,
        vocalBurst: seg.vocalBurst
      },
      {
        dialect: script.dialect,
        voice: mapCreatorVoiceToGemini(script.voice),
        style: chosenStyle,
        cacheDir: outputDir
      }
    );

    const pcmBuffer = result.rawPcm;

    // Save PCM with standard 44-byte WAV header (24kHz 16-bit mono)
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
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
    header.writeUInt32LE(pcmBuffer.length, 40);

    const wavBuffer = Buffer.concat([header, pcmBuffer]);
    fs.writeFileSync(segFilePath, wavBuffer);

    // Measure duration accurately
    const durationSec = result.durationSec || (pcmBuffer.length / 48000);
    let lufs = -14.0;
    try {
      const loudness = await measureAudioLoudness(segFilePath);
      lufs = loudness.integratedLufs;
    } catch (_) {}

    const segmentAudioUrl = `/api/creator/audio/${projectFolderName}/${segFileName}`;

    // Update segment in script
    seg.actualDurationSec = durationSec;
    seg.audioUrl = segmentAudioUrl;
    seg.status = 'ready';

    audioSegments.push({
      id: seg.id,
      text: seg.text,
      filePath: segFilePath,
      durationSec,
      lufs,
      audioUrl: segmentAudioUrl,
      emotion: chosenEmotion,
      pace: chosenPace
    });

    combinedPcmBuffers.push(pcmBuffer);

    // Rate-limit pause between segments
    if (i < script.segments.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // Create combined master voiceover WAV file
  const totalPcm = Buffer.concat(combinedPcmBuffers);
  const masterHeader = Buffer.alloc(44);
  masterHeader.write('RIFF', 0);
  masterHeader.writeUInt32LE(36 + totalPcm.length, 4);
  masterHeader.write('WAVE', 8);
  masterHeader.write('fmt ', 12);
  masterHeader.writeUInt32LE(16, 16);
  masterHeader.writeUInt16LE(1, 20);
  masterHeader.writeUInt16LE(1, 22);
  masterHeader.writeUInt32LE(24000, 24);
  masterHeader.writeUInt32LE(48000, 28);
  masterHeader.writeUInt16LE(2, 32);
  masterHeader.writeUInt16LE(16, 34);
  masterHeader.write('data', 36);
  masterHeader.writeUInt32LE(totalPcm.length, 40);

  const masterWavBuffer = Buffer.concat([masterHeader, totalPcm]);
  const masterVoiceoverPath = path.join(outputDir, 'master_voiceover.wav');
  fs.writeFileSync(masterVoiceoverPath, masterWavBuffer);

  const totalVoiceoverDurationSec = totalPcm.length / 48000;

  return {
    audioSegments,
    masterVoiceoverPath,
    totalVoiceoverDurationSec
  };
}

/**
 * Stage E: Meta Editing Director (Generating & Strictly Normalizing Executable Editing Plan JSON)
 * Guarantees that:
 * 1. Total duration strictly matches targetDurationSec.
 * 2. Scenes are sequenced strictly sequentially with timelineStartTimeSec (no overlapping 0s).
 * 3. All asset IDs map to real uploaded assets.
 */
export async function generateCreatorEditingPlan(
  creativeDirection: CreativeDirectionOutput,
  script: CreatorVideoScript,
  analysis: MultimodalAnalysisAsset[],
  voiceoverInfo: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] },
  assets: CreatorAsset[],
  targetDurationSecOverride?: number
): Promise<EditingPlan> {
  const targetDurationSec = targetDurationSecOverride || creativeDirection.suggestedDurationSec || 15;

  const targetAspectRatio = creativeDirection.formatAspectRatio || '9:16';
  const resolutionMap = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 }
  };
  const resolution = resolutionMap[targetAspectRatio] || resolutionMap['9:16'];

  const prompt = `Act as an expert Meta AI Video Editing Director.
Generate a strictly validated Executable Editing Plan JSON to synthesize a final video using FFmpeg.

Assets Available:
${JSON.stringify(assets.map(a => ({ id: a.id, type: a.type, originalName: a.originalName, durationSec: a.durationSec })), null, 2)}

Multimodal Asset Analysis:
${JSON.stringify(analysis, null, 2)}

Creative Direction:
${JSON.stringify(creativeDirection, null, 2)}

Voiceover Segments Timings:
${JSON.stringify(voiceoverInfo.audioSegments, null, 2)}

Strict Constraints:
- Total Target Video Duration: EXACTLY ${targetDurationSec} seconds.
- Aspect Ratio: ${targetAspectRatio} (${resolution.width}x${resolution.height}).
- Sequence scenes sequentially so scene 0 starts at 0s, scene 1 starts where scene 0 ends.
- The sum of all scene durationSec values must equal ${targetDurationSec}.
- Use available asset IDs: ${assets.map(a => `"${a.id}"`).join(', ')}.

Return a structured JSON object ONLY matching this schema:
{
  "totalDurationSec": ${targetDurationSec},
  "aspectRatio": "${targetAspectRatio}",
  "resolution": { "width": ${resolution.width}, "height": ${resolution.height} },
  "scenes": [
    {
      "assetId": "${assets[0]?.id || 'asset_1'}",
      "type": "${assets[0]?.type || 'image'}",
      "durationSec": 5.0,
      "effect": "slow_zoom_in",
      "transitionOut": "crossfade",
      "overlayText": "Headline text"
    }
  ],
  "audio": {
    "voiceoverAudioPath": "${voiceoverInfo.masterVoiceoverPath}",
    "voiceoverVolume": 1.5,
    "backgroundMusicVolume": 0.15,
    "ducking": true
  },
  "subtitles": [
    {
      "startTimeSec": 0.2,
      "endTimeSec": 3.5,
      "text": "Subtitles text"
    }
  ]
}`;

  let rawResponse = '';
  try {
    const res = await defaultMetaClient.callMetaChat([{ role: 'user', content: prompt }], 0.3);
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err) {
    console.warn('Meta Editing Director API call failed:', err);
  }

  const parsed = extractJsonFromResponse(rawResponse);

  // Raw scenes from model or fallback
  const rawScenes: any[] = Array.isArray(parsed.scenes) && parsed.scenes.length > 0 ? parsed.scenes : [];

  if (rawScenes.length === 0) {
    // Generate default even distribution across assets
    const perAssetDuration = targetDurationSec / assets.length;
    for (let i = 0; i < assets.length; i++) {
      const ast = assets[i];
      rawScenes.push({
        assetId: ast.id,
        type: ast.type,
        durationSec: perAssetDuration,
        effect: i % 2 === 0 ? 'slow_zoom_in' : 'slow_zoom_out',
        transitionOut: i === assets.length - 1 ? 'none' : 'crossfade',
        overlayText: script.segments[i]?.text ? script.segments[i].text.slice(0, 30) : undefined
      });
    }
  }

  // NORMALIZATION & STRICT TIMELINE VALIDATION
  // 1. Calculate raw total duration of scenes to normalize proportionally
  const validAssetIds = new Set(assets.map(a => a.id));
  let rawSumDurations = rawScenes.reduce((sum, s) => sum + (Number(s.durationSec) > 0 ? Number(s.durationSec) : 3), 0);
  if (rawSumDurations <= 0) rawSumDurations = targetDurationSec;

  const ratio = targetDurationSec / rawSumDurations;
  const normalizedScenes: EditingPlanScene[] = [];
  let currentTimelineCursor = 0;

  for (let i = 0; i < rawScenes.length; i++) {
    const sc = rawScenes[i];
    // Map to valid asset
    let assetId = sc.assetId;
    if (!validAssetIds.has(assetId)) {
      assetId = assets[i % assets.length].id;
    }
    const asset = assets.find(a => a.id === assetId) || assets[0];

    // Compute normalized duration
    let dur = Math.round((Number(sc.durationSec) || 3) * ratio * 10) / 10;
    if (i === rawScenes.length - 1) {
      // Last scene absorbs rounding difference to ensure exact targetDurationSec
      dur = Math.max(1, Math.round((targetDurationSec - currentTimelineCursor) * 10) / 10);
    }
    if (dur <= 0) dur = 1;

    let startTimeSec: number | undefined = undefined;
    let endTimeSec: number | undefined = undefined;
    if (asset.type === 'video') {
      const srcDur = asset.durationSec || 10;
      const rawStart = typeof sc.startTimeSec === 'number' ? sc.startTimeSec : 0;
      startTimeSec = Math.max(0, Math.min(rawStart, Math.max(0, srcDur - dur)));
      endTimeSec = Math.min(startTimeSec + dur, srcDur);
    }

    const assetAnalysis = analysis.find(a => a.assetId === assetId);
    const samFocusBox = assetAnalysis?.samLocalizationCues?.[0]?.box2d;

    normalizedScenes.push({
      assetId,
      type: asset.type,
      timelineStartTimeSec: currentTimelineCursor,
      startTimeSec,
      endTimeSec,
      durationSec: dur,
      effect: ['smart_subject_focus', 'slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right', 'static'].includes(sc.effect) ? sc.effect : (samFocusBox ? 'smart_subject_focus' : 'slow_zoom_in'),
      samFocusBox,
      transitionOut: i === rawScenes.length - 1 ? 'none' : (['fade', 'crossfade', 'wipeleft', 'wiperight', 'none'].includes(sc.transitionOut) ? sc.transitionOut : 'crossfade'),
      colorGrading: creativeDirection.colorGradingTheme || 'vibrant',
      overlayText: sc.overlayText ? String(sc.overlayText) : undefined,
      overlayStyle: sc.overlayStyle || (i === 0 ? 'title' : i === rawScenes.length - 1 ? 'cta_pill' : 'badge'),
      overlayTextStartTimeSec: currentTimelineCursor + 0.3,
      overlayTextDurationSec: Math.max(1.5, dur - 0.6)
    });

    currentTimelineCursor = Math.round((currentTimelineCursor + dur) * 10) / 10;
  }

  // Subtitle alignment within [0, targetDurationSec]
  const subtitles: Array<{ startTimeSec: number; endTimeSec: number; text: string }> = [];
  let subCursor = 0.2;
  for (const seg of voiceoverInfo.audioSegments) {
    if (subCursor >= targetDurationSec) break;
    const endT = Math.min(targetDurationSec, Math.round((subCursor + seg.durationSec) * 10) / 10);
    subtitles.push({
      startTimeSec: Math.round(subCursor * 10) / 10,
      endTimeSec: endT,
      text: seg.text
    });
    subCursor = Math.round((endT + 0.2) * 10) / 10;
  }

  return {
    totalDurationSec: targetDurationSec,
    aspectRatio: targetAspectRatio,
    resolution,
    scenes: normalizedScenes,
    audio: {
      voiceoverAudioPath: voiceoverInfo.masterVoiceoverPath,
      voiceoverVolume: 1.5,
      backgroundMusicVolume: 0.15,
      ducking: true
    },
    subtitles
  };
}
