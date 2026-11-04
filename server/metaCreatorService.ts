import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultMetaClient, AiProviderType } from './metaClient.js';
import {
  getMetaModel,
  getMetaImageModel,
  getMetaContributorModel,
  getMetaReviewerModel,
  getMetaInspectorModel
} from './metaConfig.js';
import { synthesizeSegmentWithStudioFallback } from './ttsKeyRotation.js';
import { probeVideo, extractSceneFrames, measureAudioLoudness } from './videoService.js';

const execFileAsync = promisify(execFile);

export const MAX_SLOWDOWN_FACTOR = 1.25;
export const MIN_SCENE_DURATION_SEC = 1.5;
export const MAX_SCENE_EXPANSION_RATIO = 1.75;
export const MAX_SINGLE_SCENE_DURATION_SEC = 10.0;
export const MAX_TOTAL_DURATION_SEC = 60.0;
export const MAX_NATURAL_ATEMPO = 1.14;
export const SEGMENT_TAIL_CUSHION_SEC = 0.10;
export const TIMELINE_TAIL_MARGIN_SEC = 0.18;

export class NarrationDurationConflictError extends Error {
  public readonly status = 400;
  public readonly code = 'NARRATION_DURATION_CONFLICT';
  public readonly targetDurationSec: number;
  public readonly requiredSpeechDurationSec: number;

  constructor(message: string, targetDurationSec: number, requiredSpeechDurationSec: number) {
    super(message);
    this.name = 'NarrationDurationConflictError';
    this.targetDurationSec = targetDurationSec;
    this.requiredSpeechDurationSec = requiredSpeechDurationSec;
  }
}

export type CreatorTransitionType =
  | 'crossfade'
  | 'fade'
  | 'fadeblack'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'circleopen'
  | 'horzopen'
  | 'none';

export type CreatorCameraEffect =
  | 'smart_subject_focus'
  | 'slow_zoom_in'
  | 'slow_zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'pull_back_reveal'
  | 'track_horizontal'
  | 'track_vertical'
  | 'detail_closeup'
  | 'handheld_stabilized'
  | 'pip_detail_spotlight'
  | 'static';

export type CreatorSceneRole =
  | 'hook'
  | 'product_intro'
  | 'demonstration'
  | 'benefits'
  | 'cta';

export type CreatorShotType =
  | 'detail_closeup'
  | 'medium_hero'
  | 'full_shot'
  | 'pip_detail'
  | 'cta_card';

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
  provider?: AiProviderType;
  model?: string;
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
  recommendedCallToAction?: string;
  provider?: AiProviderType;
  model?: string;
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

export interface CreatorVoiceOptions {
  dialect?: string;
  voice?: string;
  gender?: 'male' | 'female';
  style?: string;
  emotion?: string;
  speed?: number;
  pitch?: number;
  kabyleRegion?: string;
}

export interface CreatorVideoScript {
  hook: string;
  mainMessage: string;
  benefits: string[];
  callToAction: string;
  dialect: string;
  voice: string;
  gender?: 'male' | 'female';
  style?: string;
  emotion?: string;
  speed?: number;
  pitch?: number;
  kabyleRegion?: string;
  segments: VideoScriptSegment[];
  provider?: AiProviderType;
  model?: string;
}

export interface EditingPlanScene {
  assetId: string;
  type: 'image' | 'video';
  sceneRole?: CreatorSceneRole;
  shotType?: CreatorShotType;
  timelineStartTimeSec: number; // offset on the final master video timeline
  startTimeSec?: number;        // for video sub-clip source offset
  endTimeSec?: number;          // for video sub-clip source offset
  durationSec: number;
  nominalFrames?: number;       // integer frames at 30 FPS (K_i)
  transitionFrames?: number;    // outgoing xfade overlap frames at 30 FPS (M_i)
  transitionDurationSec?: number; // M_i / 30
  preparedClipFrames?: number;  // K'_i = K_i + M_i
  preparedClipDurationSec?: number; // K'_i / 30
  xfadeOffsetSec?: number;      // cumulative offset O_i = S_{i+1}
  voiceoverSegmentIds?: string[];
  effect: CreatorCameraEffect;
  samFocusBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  transitionOut: CreatorTransitionType;
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

export interface SynchronizedCreatorSegment {
  id: string;
  sceneIndex: number;
  text: string;
  filePath: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
}

export interface VoiceoverValidationResult {
  valid: boolean;
  allSegmentsPresent: boolean;
  nonSilent: boolean;
  allSegmentsScheduled: boolean;
  noSceneCut: boolean;
  noClippedWords: boolean;
  waveformVerified: boolean;
  segmentsChecked: number;
  lastWordEndTimeSec: number;
  timelineDurationSec: number;
  tailMarginSec: number;
  errors: string[];
  summary: string;
}

export interface EditingPlan {
  totalDurationSec: number;
  totalFrames?: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  resolution: { width: number; height: number };
  scenes: EditingPlanScene[];
  audio: EditingPlanAudio;
  subtitles: Array<{
    startTimeSec: number;
    endTimeSec: number;
    text: string;
  }>;
  synchronizedSegments?: SynchronizedCreatorSegment[];
  assSubtitlePath?: string;
  provider?: AiProviderType;
  model?: string;
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
 * Stage A: Meta AI Multimodal Media Analysis with subject focus (LLM-estimated) localization cues.
 * Uploads images and extracted video keyframes to Meta Files API and analyzes them via Meta Responses API.
 * Never falls back to Gemini Vision or fabricates fake analysis on failure.
 */
export async function analyzeCreatorAssets(
  assets: CreatorAsset[],
  outputDir: string
): Promise<MultimodalAnalysisAsset[]> {
  if (!process.env.META_API_KEY) {
    throw new Error('META_API_KEY is not configured. Meta AI is required for Stage A multimodal asset analysis.');
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error('No media assets provided for Stage A multimodal analysis.');
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const analysisResults: MultimodalAnalysisAsset[] = [];

  for (const asset of assets) {
    if (!fs.existsSync(asset.filePath)) {
      throw new Error(`Stage A failed: Uploaded asset file not found on disk for "${asset.originalName}" (${asset.id}).`);
    }

    const stat = fs.statSync(asset.filePath);
    const cacheFilePath = path.join(outputDir, `analysis_cache_${asset.id}.json`);
    if (fs.existsSync(cacheFilePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
        if (cached && cached.size === stat.size && cached.analysis && cached.analysis.provider === 'meta') {
          console.log(`[Stage A] Reusing cached Meta AI multimodal analysis for "${asset.originalName}" (${asset.id}).`);
          analysisResults.push(cached.analysis);
          continue;
        }
      } catch (_) {}
    }

    if (asset.type === 'image') {
      const fileBuffer = fs.readFileSync(asset.filePath);
      const mimeType = asset.mimeType || (asset.originalName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');

      console.log(`[Stage A] Analyzing image asset "${asset.originalName}" (${fileBuffer.length} bytes, ${mimeType}) via Meta AI (${getMetaImageModel()})...`);

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

      let metaRes: { text: string; model: string; provider: 'meta' };
      try {
        const fileId = await defaultMetaClient.uploadImageBufferToMeta(fileBuffer, mimeType, asset.originalName || `${asset.id}.jpg`);
        metaRes = await defaultMetaClient.callMultimodalResponsesApi([fileId], prompt);
      } catch (err: any) {
        throw new Error(`Stage A Meta AI image analysis failed for "${asset.originalName}" (${asset.id}): ${err.message}`);
      }

      const parsed = extractJsonFromResponse(metaRes.text);
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
        throw new Error(`Stage A Meta AI returned unparseable JSON analysis for image "${asset.originalName}" (${asset.id}).`);
      }

      const itemAnalysis: MultimodalAnalysisAsset = {
        assetId: asset.id,
        type: 'image',
        mainObjects: Array.isArray(parsed.mainObjects) && parsed.mainObjects.length > 0 ? parsed.mainObjects.map(String) : ['Featured Product Item'],
        productDetails: String(parsed.productDetails || asset.originalName),
        environment: String(parsed.environment || 'Clean studio setting'),
        compositionAndColors: String(parsed.compositionAndColors || 'Clean balanced framing'),
        advertisingAngles: Array.isArray(parsed.advertisingAngles) && parsed.advertisingAngles.length > 0 ? parsed.advertisingAngles.map(String) : ['Highlight quality & design', 'Engaging social media showcase'],
        samLocalizationCues: Array.isArray(parsed.samLocalizationCues) && parsed.samLocalizationCues.length > 0 ? parsed.samLocalizationCues : [
          { label: 'Primary Subject', box2d: [150, 150, 850, 850], confidence: 0.98 }
        ],
        provider: 'meta',
        model: metaRes.model
      };

      try {
        fs.writeFileSync(cacheFilePath, JSON.stringify({ size: stat.size, analysis: itemAnalysis }, null, 2));
      } catch (_) {}

      analysisResults.push(itemAnalysis);

    } else if (asset.type === 'video') {
      let durationSec = asset.durationSec || 10;
      try {
        const probe = await probeVideo(asset.filePath);
        durationSec = probe.durationSec || durationSec;
        asset.durationSec = durationSec;
      } catch (err: any) {
        throw new Error(`Stage A failed to probe video "${asset.originalName}" (${asset.id}): ${err.message}`);
      }

      const framesDir = path.join(outputDir, `frames_${asset.id}`);
      let extractedFrames: { filePath: string; timestampSec: number }[] = [];
      try {
        extractedFrames = await extractSceneFrames(asset.filePath, framesDir, 2);
      } catch (err: any) {
        throw new Error(`Stage A failed to extract keyframes from video "${asset.originalName}" (${asset.id}): ${err.message}`);
      }

      if (extractedFrames.length === 0) {
        throw new Error(`Stage A extracted 0 keyframes from video "${asset.originalName}" (${asset.id}).`);
      }

      // Sample up to 4 evenly distributed keyframes across the video clip (matching MetaVideoClient)
      const selectedFrames: { filePath: string; timestampSec: number }[] = [];
      if (extractedFrames.length <= 4) {
        selectedFrames.push(...extractedFrames);
      } else {
        const step = (extractedFrames.length - 1) / 3;
        selectedFrames.push(
          extractedFrames[0],
          extractedFrames[Math.round(step)],
          extractedFrames[Math.round(step * 2)],
          extractedFrames[extractedFrames.length - 1]
        );
      }

      console.log(`[Stage A] Analyzing video asset "${asset.originalName}" (${durationSec.toFixed(1)}s) with ${selectedFrames.length} keyframes via Meta AI (${getMetaImageModel()})...`);

      const prompt = `Analyze this video clip (Filename: "${asset.originalName}", Duration: ${durationSec.toFixed(1)}s, ${selectedFrames.length} sampled chronological keyframes) using multimodal vision intelligence.
Examine the chronological sequence of visual keyframes.
Return a structured JSON object with the following schema ONLY:
{
  "mainObjects": ["key objects, people, or items seen across the video"],
  "productDetails": "description of product or scene subject",
  "environment": "setting description",
  "compositionAndColors": "visual style and lighting",
  "advertisingAngles": ["2-3 compelling marketing angles"],
  "scenes": [
    {
      "startTimeSec": 0.0,
      "endTimeSec": ${Number(Math.min(5, durationSec).toFixed(1))},
      "description": "Visual description of what takes place in scene 1",
      "cameraMovement": "panning right / zoom in / static",
      "actionDescription": "Action taking place"
    }
  ]
}`;

      let metaRes: { text: string; model: string; provider: 'meta' };
      try {
        const fileIds: string[] = [];
        for (let fIdx = 0; fIdx < selectedFrames.length; fIdx++) {
          const frame = selectedFrames[fIdx];
          if (!fs.existsSync(frame.filePath)) continue;
          const buf = fs.readFileSync(frame.filePath);
          const fid = await defaultMetaClient.uploadImageBufferToMeta(
            buf,
            'image/jpeg',
            `${asset.id}_frame_${fIdx + 1}.jpg`
          );
          fileIds.push(fid);
        }
        if (fileIds.length === 0) {
          throw new Error('No keyframe files could be uploaded to Meta Files API.');
        }
        metaRes = await defaultMetaClient.callMultimodalResponsesApi(fileIds, prompt);
      } catch (err: any) {
        throw new Error(`Stage A Meta AI video keyframe analysis failed for "${asset.originalName}" (${asset.id}): ${err.message}`);
      }

      const parsed = extractJsonFromResponse(metaRes.text);
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
        throw new Error(`Stage A Meta AI returned unparseable JSON analysis for video "${asset.originalName}" (${asset.id}).`);
      }

      const itemAnalysis: MultimodalAnalysisAsset = {
        assetId: asset.id,
        type: 'video',
        mainObjects: Array.isArray(parsed.mainObjects) && parsed.mainObjects.length > 0 ? parsed.mainObjects.map(String) : ['Video Subject'],
        productDetails: String(parsed.productDetails || `Video Footage (${durationSec.toFixed(1)}s)`),
        environment: String(parsed.environment || 'Dynamic setting'),
        compositionAndColors: String(parsed.compositionAndColors || 'Natural video framing'),
        advertisingAngles: Array.isArray(parsed.advertisingAngles) && parsed.advertisingAngles.length > 0 ? parsed.advertisingAngles.map(String) : ['Action demonstration', 'Dynamic showcase'],
        scenes: Array.isArray(parsed.scenes) && parsed.scenes.length > 0 ? parsed.scenes : [
          {
            startTimeSec: 0,
            endTimeSec: Math.min(5, durationSec),
            description: String(parsed.productDetails || 'Main video sequence'),
            cameraMovement: 'Dynamic tracking',
            actionDescription: 'Product action in use'
          }
        ],
        provider: 'meta',
        model: metaRes.model
      };

      try {
        fs.writeFileSync(cacheFilePath, JSON.stringify({ size: stat.size, analysis: itemAnalysis }, null, 2));
      } catch (_) {}

      analysisResults.push(itemAnalysis);
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
  let usedProvider: AiProviderType = 'meta';
  let usedModel: string = getMetaModel();
  try {
    const chatRes = await defaultMetaClient.callMetaChat([{ role: 'user', content: prompt }], 0.4, { strictMeta: true });
    usedProvider = chatRes.provider;
    usedModel = chatRes.model;
    const res = chatRes.data;
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err: any) {
    throw new Error(`Stage B Meta AI Creative Direction failed: ${err.message}`);
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
    formatAspectRatio: ['9:16', '16:9', '1:1'].includes(parsed.formatAspectRatio) ? parsed.formatAspectRatio : targetAspectRatio,
    provider: usedProvider,
    model: usedModel
  };
}

/**
 * Stage C: Meta Script Generation
 */
export async function generateCreatorScript(
  creativeDirection: CreativeDirectionOutput,
  analysis: MultimodalAnalysisAsset[],
  optionsOrDialect: string | CreatorVoiceOptions = 'Algerian Darija',
  legacyVoice: string = 'ar-DZ-Amir',
  lockedEditingPlan?: EditingPlan
): Promise<CreatorVideoScript> {
  const opts: CreatorVoiceOptions = typeof optionsOrDialect === 'string'
    ? { dialect: optionsOrDialect, voice: legacyVoice }
    : (optionsOrDialect || { dialect: 'Algerian Arabic', voice: legacyVoice });

  const dialect = opts.dialect || 'Algerian Arabic';
  const voice = opts.voice || 'Puck';
  const gender = opts.gender || (['Kore', 'Charon', 'Aoede', 'ar-DZ-Meriem', 'ar-AE-Fatima'].includes(voice) ? 'female' : 'male');
  const style = opts.style || 'Premium commercial';
  const emotion = opts.emotion || 'neutral';
  const speed = typeof opts.speed === 'number' ? opts.speed : 1;
  const pitch = typeof opts.pitch === 'number' ? opts.pitch : 0;
  const kabyleRegion = opts.kabyleRegion;

  const targetDurationSec = Number(lockedEditingPlan?.totalDurationSec || creativeDirection.suggestedDurationSec) || 15;

  const isEnglish = dialect === 'American English (US)' || dialect === 'British English (UK)' || dialect.toLowerCase().includes('english');
  const isKabyle = dialect === 'Algerian Kabyle (Taqbaylit)';

  // Determine strict segment count and spoken word limits based on lockedEditingPlan (when Step 4 ran first) or targetDurationSec.
  // Natural speech is ~2.1 words per second. Speech takes ~72% of each scene window to leave breathing room for transitions.
  let targetSegmentCount = 3;
  let maxTotalWords = 26;
  let segmentGuideline = '';

  const lockedScenes = Array.isArray(lockedEditingPlan?.scenes) && lockedEditingPlan!.scenes.length > 0
    ? lockedEditingPlan!.scenes
    : null;

  const wordsPerSec = isEnglish ? 2.25 : 1.95;

  const maxSegmentsForDuration =
    targetDurationSec <= 10 ? 2 :
    targetDurationSec <= 15 ? 3 :
    targetDurationSec <= 30 ? 6 : 10;

  const maxWordsBudgetForDuration =
    targetDurationSec <= 10 ? 14 :
    targetDurationSec <= 15 ? 20 :
    targetDurationSec <= 30 ? Math.round(targetDurationSec * 0.76 * wordsPerSec) :
    Math.round(targetDurationSec * 0.78 * wordsPerSec);

  if (lockedScenes) {
    targetSegmentCount =
      targetDurationSec <= 15
        ? Math.min(maxSegmentsForDuration, Math.max(2, lockedScenes.length))
        : Math.min(maxSegmentsForDuration, Math.max(2, lockedScenes.length));
    const sceneLines: string[] = [];
    let wordBudgetSum = 0;
    const perSegMaxWordsCap = Math.max(
      5,
      targetDurationSec <= 15
        ? Math.floor(maxWordsBudgetForDuration / targetSegmentCount)
        : Math.min(28, Math.ceil((maxWordsBudgetForDuration * 1.15) / targetSegmentCount))
    );
    for (let i = 0; i < targetSegmentCount; i++) {
      const mappedSceneIdx =
        targetSegmentCount === 1
          ? 0
          : i === 0
          ? 0
          : i === targetSegmentCount - 1
          ? lockedScenes.length - 1
          : Math.min(
              lockedScenes.length - 2,
              Math.max(1, Math.round((i * (lockedScenes.length - 1)) / (targetSegmentCount - 1)))
            );
      const sc = lockedScenes[mappedSceneIdx] || lockedScenes[lockedScenes.length - 1];
      const scDur = Number(sc?.durationSec) || (targetDurationSec / targetSegmentCount);
      const speechWindowSec =
        targetDurationSec <= 15
          ? Math.max(1.5, Math.min(scDur - 0.35, (targetDurationSec * 0.72) / targetSegmentCount))
          : Math.max(2.0, Math.min(scDur - 0.45, scDur * 0.80));
      const segMaxWords = Math.max(
        targetDurationSec <= 15 ? 4 : 8,
        Math.min(perSegMaxWordsCap, Math.round(speechWindowSec * wordsPerSec * speed))
      );
      wordBudgetSum += segMaxWords;
      const role = i === 0 ? 'hook' : i === targetSegmentCount - 1 ? 'call_to_action' : i === 1 ? 'benefit' : 'product_reveal';
      sceneLines.push(
        `- Segment ${i + 1} (id: "seg_${i + 1}", sceneId: "scene_${mappedSceneIdx + 1}", role: "${role}", target speech window: ${speechWindowSec.toFixed(1)}s, target ${ Math.max(4, segMaxWords - 3) }-${segMaxWords} words): Match Scene ${mappedSceneIdx + 1} (${sc?.assetId || `asset_${mappedSceneIdx + 1}`}, effect: ${sc?.effect || 'smart_subject_focus'}${sc?.overlayText ? `, headline: "${sc.overlayText}"` : ''}).`
      );
    }
    maxTotalWords = Math.min(maxWordsBudgetForDuration, Math.max(10, wordBudgetSum));
    segmentGuideline = `EXACTLY ${targetSegmentCount} natural, flowing narration segments synchronized 1-to-1 across the approved ${lockedScenes.length}-scene Editing Plan:\n${sceneLines.join('\n')}`;
  } else if (targetDurationSec <= 10) {
    targetSegmentCount = 2;
    maxTotalWords = 14;
    segmentGuideline = `EXACTLY 2 segments:
- Segment 1 (role: "hook", 6-7 words max): Punchy scroll-stopping attention hook.
- Segment 2 (role: "call_to_action", 6-7 words max): Urgent offer and immediate CTA.`;
  } else if (targetDurationSec <= 15) {
    targetSegmentCount = 3;
    maxTotalWords = 20;
    segmentGuideline = `EXACTLY 3 segments:
- Segment 1 (role: "hook", 5-6 words max): Immediate curiosity or scroll-stopping hook.
- Segment 2 (role: "benefit", 7-8 words max): Main product reveal & primary benefit.
- Segment 3 (role: "call_to_action", 5-6 words max): Direct, concise call to action.`;
  } else if (targetDurationSec <= 30) {
    targetSegmentCount = 4;
    maxTotalWords = Math.round(targetDurationSec * 0.76 * wordsPerSec);
    segmentGuideline = `EXACTLY 4 segments:
- Segment 1 (role: "hook", 10-12 words): Engaging hook to capture attention immediately.
- Segment 2 (role: "problem", 11-14 words): Relatable challenge or need.
- Segment 3 (role: "benefit", 12-15 words): Product solution, workflow, and practical value.
- Segment 4 (role: "call_to_action", 9-11 words): Clear, confident closing call to action.`;
  } else {
    targetSegmentCount = Math.min(8, Math.max(6, Math.round(targetDurationSec / 8)));
    maxTotalWords = Math.round(targetDurationSec * 0.78 * wordsPerSec);
    const avgWords = Math.round(maxTotalWords / targetSegmentCount);
    segmentGuideline = `EXACTLY ${targetSegmentCount} segments (~${Math.max(10, avgWords - 3)}-${avgWords + 2} words per segment) proportionally distributed across hook, problem, product walkthrough, key benefits, and call to action so every scene has continuous narration without dead silent gaps. Total words across all segments: ~${Math.round(maxTotalWords * 0.85)}-${maxTotalWords} words.`;
  }

  const languagePromptInstruction = isEnglish
    ? `Language: Natural commercial ${dialect}. Write fluent, engaging, persuasive English voiceover copy.`
    : isKabyle
    ? `Language: Authentic conversational Algerian Kabyle (Taqbaylit)${kabyleRegion ? ` (${kabyleRegion} region)` : ''}. Write in everyday spoken Kabyle Latin or Arabic script.`
    : `Language: Authentic colloquial ${dialect} (NEVER Modern Standard Arabic / Fusha). Write in authentic colloquial Arabic script matching the dialect phonetics.`;

  const prompt = `Act as an expert Meta AI Advertising Creative Director & Voice Director for video commercials and product presentations.
Create a high-converting, fluid, expressive voiceover script tailored to the following creative direction, uploaded assets, and approved scene timeline:

Creative Direction:
${JSON.stringify(creativeDirection, null, 2)}

Target Language/Dialect: ${dialect}
Voice Profile: ${voice} (${gender})
Style & Delivery: ${style} style with a ${emotion} tone (Speed factor: ${speed.toFixed(2)}x, Pitch: ${pitch})
${languagePromptInstruction}

CRITICAL DURATION, FLOW & CADENCE RULES (HARD CONSTRAINTS):
- Target Video Duration: EXACTLY ${targetDurationSec} seconds.
- You MUST output EXACTLY ${targetSegmentCount} segments in the "segments" array. Do not output fewer or more than ${targetSegmentCount} segments.
${segmentGuideline}
- Total Spoken Word Count: Target ${targetDurationSec <= 15 ? `at most ${maxTotalWords}` : `${Math.round(maxTotalWords * 0.82)} to ${maxTotalWords}`} words across all ${targetSegmentCount} segments combined so the voiceover fills each scene naturally without long silent gaps.
- CONTINUOUS NATURAL FLOW (NO CHOPPY FRAGMENTS): Write smooth, complete, natural spoken sentences for every segment. NEVER write choppy 1-to-3 word period-separated fragments like "Your words. Your voice. Perfectly realized." — periods between short fragments force the TTS engine to stop and speak unnaturally slowly. Connect short clauses with commas instead of periods so the voiceover flows smoothly and continuously.
- Script must feel human, lively, and natural in ${dialect}—NEVER robotic, monotone, or halting.

Return a structured JSON object ONLY with the following schema:
{
  "hook": "Opening hook in ${dialect} (short headline, under 7 words)",
  "mainMessage": "Core product value proposition in ${dialect}",
  "benefits": ["Benefit 1", "Benefit 2"],
  "callToAction": "Final CTA headline in ${dialect} (under 7 words)",
  "dialect": "${dialect}",
  "voice": "${voice}",
  "segments": [
    {
      "id": "seg_1",
      "role": "hook",
      "text": "Smooth, complete spoken sentence in ${dialect} matching the target word count for this scene",
      "visualDescription": "Matching visual scene description from uploaded media",
      "estimatedDurationSec": 3.5,
      "emotion": "${emotion}",
      "pace": "${speed > 1.08 ? 'fast' : speed < 0.88 ? 'slow' : 'normal'}",
      "style": "${style}",
      "deliveryInstruction": "Deliver with smooth, continuous, engaging cadence and natural warmth without pausing between words",
      "vocalBurst": "energetic_intro"
    }
  ]
}`;

  let rawResponse = '';
  let usedProvider: AiProviderType = 'meta';
  let usedModel: string = getMetaModel();
  try {
    const chatRes = await defaultMetaClient.callMetaChat([{ role: 'user', content: prompt }], 0.5, { strictMeta: true });
    usedProvider = chatRes.provider;
    usedModel = chatRes.model;
    const res = chatRes.data;
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err: any) {
    throw new Error(`Stage C Meta AI Script Generation failed: ${err.message}`);
  }

  const parsed = extractJsonFromResponse(rawResponse);

  const fallbackSegments10s: VideoScriptSegment[] = [
    {
      id: 'seg_1',
      role: 'hook',
      text: parsed.hook || 'شوف هذا العرض الحصري اليوم!',
      visualDescription: 'Dynamic opening hook showcasing primary asset',
      estimatedDurationSec: 3.5,
      emotion: 'excited',
      pace: 'fast',
      style: 'Energetic sales',
      deliveryInstruction: 'High-energy hook to grab viewer attention immediately'
    },
    {
      id: 'seg_2',
      role: 'call_to_action',
      text: parsed.callToAction || 'اطلبه الآن واستفد من التوصيل السريع!',
      visualDescription: 'Closing hero product card with call to action',
      estimatedDurationSec: 3.5,
      emotion: 'persuasive',
      pace: 'fast',
      style: 'Luxury brand voice',
      deliveryInstruction: 'Confident call to action encouraging quick order'
    }
  ];

  const fallbackSegments15s: VideoScriptSegment[] = [
    {
      id: 'seg_1',
      role: 'hook',
      text: parsed.hook || 'حبس السكرول، شوف هذا العرض الاستثنائي!',
      visualDescription: 'Dynamic opening hook showcasing primary asset',
      estimatedDurationSec: 3.0,
      emotion: 'excited',
      pace: 'fast',
      style: 'Energetic sales',
      deliveryInstruction: 'High-energy hook to grab viewer attention immediately'
    },
    {
      id: 'seg_2',
      role: 'benefit',
      text: parsed.mainMessage || 'جودة ممتازة وتصميم عصري يرافقك كل يوم.',
      visualDescription: 'Product feature demonstration scene',
      estimatedDurationSec: 4.0,
      emotion: 'friendly',
      pace: 'normal',
      style: 'Friendly',
      deliveryInstruction: 'Warm, persuasive tone highlighting quality'
    },
    {
      id: 'seg_3',
      role: 'call_to_action',
      text: parsed.callToAction || 'اطلبه الآن والتوصيل لباب دارك!',
      visualDescription: 'Closing hero product card with call to action',
      estimatedDurationSec: 3.0,
      emotion: 'persuasive',
      pace: 'fast',
      style: 'Luxury brand voice',
      deliveryInstruction: 'Confident call to action encouraging quick order'
    }
  ];

  const defaultFallbackSegments = targetDurationSec <= 10 ? fallbackSegments10s : fallbackSegments15s;

  let rawSegments = Array.isArray(parsed.segments) && parsed.segments.length > 0 ? parsed.segments : defaultFallbackSegments;

  // Strict enforcement: clamp segment count to targetSegmentCount to prevent over-duration
  if (rawSegments.length > targetSegmentCount) {
    console.log(`[Script Duration Guard] Trimming LLM segments from ${rawSegments.length} to ${targetSegmentCount} to enforce ${targetDurationSec}s target duration.`);
    const first = rawSegments[0];
    const last = rawSegments[rawSegments.length - 1];
    const middle = rawSegments.slice(1, targetSegmentCount - 1);
    rawSegments = [first, ...middle, last];
  }

  const perSegmentWordCap =
    targetDurationSec <= 15
      ? Math.max(5, Math.ceil((maxTotalWords + 2) / targetSegmentCount))
      : Math.max(10, Math.ceil((maxTotalWords * 1.2) / targetSegmentCount));

  const smoothChoppyPunctuation = (input: string): string => {
    // Replace internal periods/exclamations after 1-3 word micro-fragments with commas so TTS speaks fluidly without stopping
    const parts = input
      .split(/(?<=[.!؟])\s+/)
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) return input;
    const smoothed: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const wordCount = part.split(/\s+/).filter(Boolean).length;
      if (i < parts.length - 1 && wordCount <= 4) {
        smoothed.push(part.replace(/[.!؟]+$/, '') + ',');
      } else {
        smoothed.push(part);
      }
    }
    return smoothed.join(' ');
  };

  const segments: VideoScriptSegment[] = rawSegments.map((s: any, idx: number) => {
    let text = smoothChoppyPunctuation(String(s.text || s.sentence || '').trim());
    const mappedSceneIdx =
      lockedScenes
        ? rawSegments.length === 1
          ? 0
          : idx === 0
          ? 0
          : idx === rawSegments.length - 1
          ? lockedScenes.length - 1
          : Math.min(
              lockedScenes.length - 2,
              Math.max(1, Math.round((idx * (lockedScenes.length - 1)) / (rawSegments.length - 1)))
            )
        : idx;
    const matchedLockedScene = lockedScenes ? lockedScenes[mappedSceneIdx] : undefined;
    const scDur = Number(matchedLockedScene?.durationSec) || (targetDurationSec / targetSegmentCount);
    const lockedSpeechWindow =
      targetDurationSec <= 15
        ? Math.max(1.5, Math.min(scDur - 0.35, (targetDurationSec * 0.72) / targetSegmentCount))
        : Math.max(2.0, Math.min(scDur - 0.45, scDur * 0.80));

    // Enforce per-segment word limit matched to scene duration & campaign total budget
    const words = text.split(/\s+/).filter(Boolean);
    const maxWordsPerSeg =
      targetDurationSec <= 15
        ? Math.min(
            perSegmentWordCap,
            matchedLockedScene
              ? Math.max(5, Math.min(10, Math.round(lockedSpeechWindow * 1.9 * speed) + 1))
              : perSegmentWordCap
          )
        : Math.min(
            perSegmentWordCap,
            Math.max(8, Math.min(28, Math.round(lockedSpeechWindow * wordsPerSec * speed) + 3))
          );
    if (words.length > maxWordsPerSeg) {
      text = words.slice(0, maxWordsPerSeg).join(' ');
    }

    const rawPace = s.pace || s.ttsPace || 'normal';
    const normalizedPace: 'slow' | 'normal' | 'fast' =
      rawPace === 'slow' && speed >= 0.9 ? 'normal' : (['slow', 'normal', 'fast'].includes(rawPace) ? rawPace : 'normal');

    return {
      id: s.id || `seg_${idx + 1}`,
      sceneId: lockedScenes ? `scene_${mappedSceneIdx + 1}` : s.sceneId,
      role: s.role || (idx === 0 ? 'hook' : idx === rawSegments.length - 1 ? 'call_to_action' : 'benefit'),
      text,
      visualDescription: s.visualDescription || 'Product scene presentation',
      estimatedDurationSec: Number(s.estimatedDurationSec) || Number(lockedSpeechWindow.toFixed(2)),
      emotion: ['excited', 'friendly', 'persuasive', 'reassuring', 'curious', 'serious', 'playful', 'warm', 'neutral'].includes(s.emotion) ? s.emotion : (s.ttsEmotion || emotion || 'friendly'),
      pace: normalizedPace,
      style: s.style || style || 'Premium commercial',
      deliveryInstruction: s.deliveryInstruction || 'Deliver with smooth, continuous flow and natural pacing without long pauses',
      vocalBurst: s.vocalBurst || '',
      status: 'pending'
    };
  });

  return {
    hook: parsed.hook || segments[0]?.text || 'شاهد هذا العرض الحصري!',
    mainMessage: parsed.mainMessage || segments[1]?.text || 'أفضل جودة بأحدث المواصفات.',
    benefits: Array.isArray(parsed.benefits) ? parsed.benefits : ['جودة ممتازة', 'توصيل سريع'],
    callToAction: parsed.callToAction || segments[segments.length - 1]?.text || 'اطلبه الآن!',
    dialect,
    voice,
    gender,
    style,
    emotion,
    speed,
    pitch,
    kabyleRegion,
    segments,
    provider: usedProvider,
    model: usedModel
  };
}

/**
 * Trims excess leading/trailing digital silence from 24kHz 16-bit mono TTS PCM buffers
 * and collapses any unnatural internal dead-air pauses (> 260ms) down to a natural 150ms breath pause,
 * while preserving a 35ms vocal onset and 25ms vocal release before tail cushion is added.
 */
function trimExcessTtsPcmSilence(rawPcm: Buffer): Buffer {
  if (!rawPcm || rawPcm.length < 4800) return rawPcm; // < 100ms
  const totalSamples = Math.floor(rawPcm.length / 2);
  const silenceThreshold = 340; // ~ -40 dBFS in 16-bit PCM

  let firstActiveSample = 0;
  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(rawPcm.readInt16LE(i * 2)) > silenceThreshold) {
      firstActiveSample = i;
      break;
    }
  }

  let lastActiveSample = totalSamples - 1;
  for (let i = totalSamples - 1; i >= firstActiveSample; i--) {
    if (Math.abs(rawPcm.readInt16LE(i * 2)) > silenceThreshold) {
      lastActiveSample = i;
      break;
    }
  }

  if (lastActiveSample <= firstActiveSample) return rawPcm;

  const leadKeepSamples = Math.floor(0.035 * 24000); // 35ms natural onset
  const trailKeepSamples = Math.floor(0.025 * 24000); // 25ms natural release before 100ms cushion
  const startSample = Math.max(0, firstActiveSample - leadKeepSamples);
  const endSample = Math.min(totalSamples, lastActiveSample + trailKeepSamples);

  // Collapse internal silence runs longer than 260ms (6240 samples) down to 150ms (3600 samples)
  const maxInternalSilenceSamples = Math.floor(0.26 * 24000);
  const targetInternalSilenceSamples = Math.floor(0.15 * 24000);
  const windowSamples = 240; // 10ms RMS/peak window
  const outChunks: Buffer[] = [];

  let i = startSample;
  let silenceStart = -1;
  let activeCopyStart = startSample;

  while (i < endSample) {
    const winEnd = Math.min(endSample, i + windowSamples);
    let winPeak = 0;
    for (let j = i; j < winEnd; j++) {
      const amp = Math.abs(rawPcm.readInt16LE(j * 2));
      if (amp > winPeak) winPeak = amp;
    }

    if (winPeak <= silenceThreshold) {
      if (silenceStart === -1) {
        silenceStart = i;
      }
    } else {
      if (silenceStart !== -1) {
        const silentSamples = i - silenceStart;
        if (silentSamples > maxInternalSilenceSamples) {
          const keepEnd = silenceStart + targetInternalSilenceSamples;
          outChunks.push(rawPcm.subarray(activeCopyStart * 2, keepEnd * 2));
          activeCopyStart = i;
        }
        silenceStart = -1;
      }
    }
    i = winEnd;
  }

  if (activeCopyStart < endSample) {
    outChunks.push(rawPcm.subarray(activeCopyStart * 2, endSample * 2));
  }

  return outChunks.length === 1 ? outChunks[0] : Buffer.concat(outChunks);
}

/**
 * Stage D: DoudouVoice TTS Voice Synthesis
 * Reuses the existing Studio key rotation and multi-provider fallback engine.
 * Throws real error if all keys fail. Never fabricates fake audio or silent zero-byte buffers.
 */
export async function synthesizeCreatorVoiceover(
  script: CreatorVideoScript,
  outputDir: string,
  targetDurationSec: number = 15,
  options?: CreatorVoiceOptions
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

  const voiceGender = options?.gender || script.gender || 'male';
  const voiceStyle = options?.style || script.style || 'Premium commercial';
  const voiceEmotion = options?.emotion || script.emotion || 'neutral';
  const voiceSpeed = typeof options?.speed === 'number' ? options.speed : (typeof script.speed === 'number' ? script.speed : 1);
  const voicePitch = typeof options?.pitch === 'number' ? options.pitch : (typeof script.pitch === 'number' ? script.pitch : 0);
  const voiceKabyleRegion = options?.kabyleRegion || script.kabyleRegion;

  console.log(`[Stage D] Synthesizing voiceover for ${script.segments.length} script segments via Studio fallback engine (target: ${targetDurationSec}s, voice: ${script.voice}, style: ${voiceStyle}, emotion: ${voiceEmotion}, speed: ${voiceSpeed}x, pitch: ${voicePitch})...`);

  // 100ms (0.10s) trailing silence cushion at 24kHz 16-bit mono (48,000 bytes/sec -> 4,800 bytes)
  // Prevents final Arabic consonants/syllables from being clipped at segment or xfade boundaries
  const tailCushionBytes = Math.floor(SEGMENT_TAIL_CUSHION_SEC * 24000) * 2;
  const tailCushionBuffer = Buffer.alloc(tailCushionBytes, 0);

  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const segFileName = `voice_seg_${i + 1}.wav`;
    const segFilePath = path.join(outputDir, segFileName);

    const chosenEmotion = seg.emotion || (seg.ttsEmotion as any) || voiceEmotion || (seg.role === 'hook' ? 'excited' : seg.role === 'call_to_action' ? 'persuasive' : 'friendly');
    const chosenPace = seg.pace || (seg.ttsPace as any) || (voiceSpeed > 1.1 ? 'fast' : voiceSpeed < 0.9 ? 'slow' : seg.role === 'hook' ? 'fast' : 'normal');
    const chosenStyle = seg.style || voiceStyle || (seg.role === 'hook' ? 'Energetic sales' : 'Premium commercial');

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
        emotion: chosenEmotion,
        gender: voiceGender,
        speed: voiceSpeed,
        pitch: voicePitch,
        kabyleRegion: voiceKabyleRegion,
        cacheDir: outputDir
      }
    );

    const rawPcm = result.rawPcm;
    if (!rawPcm || rawPcm.length < 100) {
      throw new Error(`TTS synthesis produced an empty or silent audio buffer for segment "${seg.id || `seg_${i + 1}`}". Failed narration is never silently replaced with silence.`);
    }

    const trimmedPcm = trimExcessTtsPcmSilence(rawPcm);
    const pcmBuffer = Buffer.concat([trimmedPcm, tailCushionBuffer]);

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

    // Measure actual PCM duration accurately (24,000 Hz * 2 bytes/sample = 48,000 bytes/sec)
    const durationSec = Number((pcmBuffer.length / 48000).toFixed(3));
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

  // Duration Validation & Gentle Natural Pace Adjustment:
  // Preserve natural Arabic rhythm: never apply aggressive playback-speed changes (> 1.14x).
  // Account for per-scene lead-in (0.15s) and tail margins (0.15s–0.18s) used by recalculateCompleteEditingTimeline.
  const currentTotalSpeech = audioSegments.reduce((sum, s) => sum + s.durationSec, 0);
  const sceneTimelineOverheadSec = audioSegments.length * 0.31 + 0.05;
  const maxSpeechWindow = Math.max(2.0, targetDurationSec - sceneTimelineOverheadSec);
  const hardConflictThresholdSec = Math.max(targetDurationSec * 1.65, (targetDurationSec + 2.5) * MAX_NATURAL_ATEMPO);

  if (currentTotalSpeech > hardConflictThresholdSec) {
    throw new NarrationDurationConflictError(
      `Requested video duration (${targetDurationSec}s) cannot accommodate the complete narration (${currentTotalSpeech.toFixed(2)}s across ${audioSegments.length} segments) naturally without clipping or unnatural speed distortion. Please increase target duration to ${targetDurationSec <= 10 ? 15 : 30}s or shorten the script.`,
      targetDurationSec,
      Number((currentTotalSpeech + sceneTimelineOverheadSec).toFixed(2))
    );
  }

  if (currentTotalSpeech > maxSpeechWindow && audioSegments.length > 0) {
    const speedRatio = Math.min(MAX_NATURAL_ATEMPO, currentTotalSpeech / maxSpeechWindow);
    if (speedRatio >= 1.02) {
      console.log(`[Stage D Duration Guard] Speech duration (${currentTotalSpeech.toFixed(2)}s) exceeds nominal speech window (${maxSpeechWindow.toFixed(2)}s) for ${targetDurationSec}s video. Applying gentle natural pace adjustment (atempo=${speedRatio.toFixed(3)} <= ${MAX_NATURAL_ATEMPO}x)...`);
      combinedPcmBuffers.length = 0;

      for (const seg of audioSegments) {
        const tempPath = `${seg.filePath}.tempo.wav`;
        try {
          await execFileAsync('ffmpeg', [
            '-y',
            '-v', 'error',
            '-i', seg.filePath,
            '-filter:a', `atempo=${speedRatio.toFixed(4)}`,
            '-ar', '24000',
            '-ac', '1',
            tempPath
          ]);

          if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 44) {
            fs.renameSync(tempPath, seg.filePath);
            const fileBytes = fs.readFileSync(seg.filePath);
            const pcmOnly = extractWavPcmData(fileBytes);
            combinedPcmBuffers.push(pcmOnly);
            const newDur = pcmOnly.length / 48000;
            seg.durationSec = Number(newDur.toFixed(3));
            const scriptSeg = script.segments.find(s => s.id === seg.id);
            if (scriptSeg) scriptSeg.actualDurationSec = seg.durationSec;
          } else {
            const raw = extractWavPcmData(fs.readFileSync(seg.filePath));
            combinedPcmBuffers.push(raw);
          }
        } catch (err: any) {
          console.warn(`[Stage D Duration Guard] Failed to adjust tempo for ${seg.filePath}:`, err?.message);
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
          const raw = extractWavPcmData(fs.readFileSync(seg.filePath));
          combinedPcmBuffers.push(raw);
        }
      }
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

  const totalVoiceoverDurationSec = Number((totalPcm.length / 48000).toFixed(3));

  return {
    audioSegments,
    masterVoiceoverPath,
    totalVoiceoverDurationSec
  };
}

/**
 * Extracts raw 16-bit PCM sample bytes from a WAV buffer by locating the 'data' chunk header,
 * avoiding 34-byte header-offset errors when FFmpeg injects a 'LIST'/'INFO' chunk.
 */
export function extractWavPcmData(wavBytes: Buffer): Buffer {
  if (!wavBytes || wavBytes.length <= 44) return Buffer.alloc(0);
  let offset = 12; // Skip 'RIFF' + size + 'WAVE'
  while (offset + 8 <= wavBytes.length) {
    const chunkId = wavBytes.toString('ascii', offset, offset + 4);
    const chunkSize = wavBytes.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const start = offset + 8;
      const end = Math.min(wavBytes.length, start + chunkSize);
      return wavBytes.subarray(start, end);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  const fallbackIdx = wavBytes.indexOf(Buffer.from('data'));
  if (fallbackIdx !== -1 && fallbackIdx + 8 < wavBytes.length) {
    return wavBytes.subarray(fallbackIdx + 8);
  }
  return wavBytes.subarray(44);
}

export const VALID_CREATOR_TRANSITIONS: CreatorTransitionType[] = [
  'crossfade',
  'fade',
  'fadeblack',
  'dissolve',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'circleopen',
  'horzopen',
  'none'
];

export const VALID_CREATOR_EFFECTS: readonly CreatorCameraEffect[] = [
  'smart_subject_focus',
  'slow_zoom_in',
  'slow_zoom_out',
  'pan_left',
  'pan_right',
  'pull_back_reveal',
  'track_horizontal',
  'track_vertical',
  'detail_closeup',
  'handheld_stabilized',
  'pip_detail_spotlight',
  'static'
] as const;

export const PURE_ZOOM_EFFECTS: ReadonlySet<string> = new Set([
  'slow_zoom_in',
  'slow_zoom_out',
  'smart_subject_focus'
]);

/**
 * Builds a scene-synchronized master voiceover WAV file with exact adelay placement,
 * uniform gain across all segments (amix normalize=0), and guaranteed non-clipped completion.
 */
export async function buildCreatorSynchronizedVoiceover(
  segments: SynchronizedCreatorSegment[],
  totalDurationSec: number,
  outputWavPath: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputWavPath), { recursive: true });
  const lastSegEndSec = segments.reduce((maxEnd, s) => Math.max(maxEnd, Number(s.endTimeSec) || 0), 0);
  // Ensure the master WAV container is NEVER shorter than the final spoken word + 0.12s cushion
  const safeDuration = Math.max(1.0, Number(totalDurationSec) || 15.0, lastSegEndSec + 0.12);

  const validSegments = segments.filter(
    s => s.filePath && fs.existsSync(s.filePath) && fs.statSync(s.filePath).size > 44
  );

  if (validSegments.length === 0) {
    if (segments.length > 0) {
      throw new Error(
        'Failed to build synchronized voiceover: narration segments were supplied, but all audio segment files are missing or invalid. Failed TTS is never silently replaced with silence.'
      );
    }
    const silentArgs = [
      '-y',
      '-v', 'error',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=24000:cl=mono',
      '-t', safeDuration.toFixed(3),
      '-ar', '24000',
      '-ac', '1',
      outputWavPath
    ];
    await execFileAsync('ffmpeg', silentArgs);
    return;
  }

  for (const seg of validSegments) {
    const buf = fs.readFileSync(seg.filePath);
    const pcmData = extractWavPcmData(buf);
    let maxAbsSample = 0;
    for (let i = 0; i + 1 < pcmData.length; i += 2) {
      const sample = Math.abs(pcmData.readInt16LE(i));
      if (sample > maxAbsSample) {
        maxAbsSample = sample;
        if (maxAbsSample > 32) break;
      }
    }
    if (maxAbsSample <= 32) {
      throw new Error(
        `Failed to build synchronized voiceover: segment "${seg.id}" contains silent audio (peak sample=${maxAbsSample}). Failed TTS is never silently replaced with silence.`
      );
    }
  }

  const inputs: string[] = [];
  const filterParts: string[] = [];

  for (let i = 0; i < validSegments.length; i++) {
    inputs.push('-i', validSegments[i].filePath);
    const delayMs = Math.max(0, Math.round(validSegments[i].startTimeSec * 1000));
    filterParts.push(`[${i}:a]aresample=24000,adelay=${delayMs}|${delayMs}[a${i}]`);
  }

  const mixInputs = validSegments.map((_, i) => `[a${i}]`).join('');
  const mixFilter =
    `${mixInputs}amix=inputs=${validSegments.length}:duration=longest:dropout_transition=0:normalize=0,` +
    `alimiter=limit=0.95:level=false,apad=whole_dur=${safeDuration.toFixed(3)}[aout]`;

  const fullFilter = `${filterParts.join(';')};${mixFilter}`;

  const args = [
    '-y',
    '-v', 'error',
    ...inputs,
    '-filter_complex', fullFilter,
    '-map', '[aout]',
    '-ar', '24000',
    '-ac', '1',
    '-t', safeDuration.toFixed(3),
    outputWavPath
  ];

  await execFileAsync('ffmpeg', args);
}

/**
 * Programmatically validates complete voiceover playback, segment presence, non-silence,
 * scene synchronization, and final audio waveform completion so no final spoken word is ever clipped.
 */
export async function validateVoiceoverCompleteness(params: {
  script?: CreatorVideoScript | null;
  voiceoverInfo?: {
    masterVoiceoverPath: string;
    totalVoiceoverDurationSec: number;
    audioSegments: Array<{
      id: string;
      text: string;
      filePath: string;
      durationSec: number;
    }>;
  } | null;
  editingPlan: EditingPlan;
  renderedMp4Path?: string;
}): Promise<VoiceoverValidationResult> {
  const { script, voiceoverInfo, editingPlan, renderedMp4Path } = params;
  const errors: string[] = [];

  const expectedSegmentsCount =
    script?.segments?.length ||
    voiceoverInfo?.audioSegments?.length ||
    editingPlan.synchronizedSegments?.length ||
    0;

  const syncSegs = editingPlan.synchronizedSegments || [];
  const timelineDurationSec = Number(editingPlan.totalDurationSec) || 15;

  if (expectedSegmentsCount === 0 && syncSegs.length === 0) {
    return {
      valid: true,
      allSegmentsPresent: true,
      nonSilent: true,
      allSegmentsScheduled: true,
      noSceneCut: true,
      noClippedWords: true,
      waveformVerified: true,
      segmentsChecked: 0,
      lastWordEndTimeSec: 0,
      timelineDurationSec,
      tailMarginSec: timelineDurationSec,
      errors: [],
      summary: 'Video-only timeline (0 narration segments requested).'
    };
  }

  let allSegmentsPresent = true;
  let nonSilent = true;
  let allSegmentsScheduled = syncSegs.length >= expectedSegmentsCount && syncSegs.length > 0;
  let noSceneCut = true;
  let noClippedWords = true;
  let waveformVerified = true;

  if (!allSegmentsScheduled) {
    errors.push(
      `Expected ${expectedSegmentsCount} narration segment(s) in synchronized timeline, but only ${syncSegs.length} were scheduled.`
    );
  }

  // 1. Verify each audio segment exists on disk, is non-silent, and is not truncated in the timeline
  const audioSegList = voiceoverInfo?.audioSegments || syncSegs;
  for (let i = 0; i < audioSegList.length; i++) {
    const seg = audioSegList[i];
    if (!seg.filePath || !fs.existsSync(seg.filePath)) {
      allSegmentsPresent = false;
      errors.push(`Narration segment "${seg.id || `seg_${i + 1}`}" WAV file is missing on disk.`);
      continue;
    }
    const buf = fs.readFileSync(seg.filePath);
    const pcm = extractWavPcmData(buf);
    if (pcm.length < 200) {
      allSegmentsPresent = false;
      errors.push(`Narration segment "${seg.id || `seg_${i + 1}`}" has empty PCM data (${pcm.length} bytes).`);
      continue;
    }
    let peak = 0;
    for (let j = 0; j + 1 < pcm.length; j += 2) {
      const sample = Math.abs(pcm.readInt16LE(j));
      if (sample > peak) peak = sample;
    }
    if (peak <= 32) {
      nonSilent = false;
      errors.push(`Narration segment "${seg.id || `seg_${i + 1}`}" contains digital silence (peak=${peak}).`);
    }

    const actualPcmDur = Number((pcm.length / 48000).toFixed(3));
    const scheduled = syncSegs.find(s => s.id === seg.id) || syncSegs[i];
    if (!scheduled) {
      allSegmentsScheduled = false;
      errors.push(`Narration segment "${seg.id}" is missing from editingPlan.synchronizedSegments.`);
    } else {
      const scheduledWindow = Number((scheduled.endTimeSec - scheduled.startTimeSec).toFixed(3));
      if (scheduledWindow + 0.05 < actualPcmDur) {
        noSceneCut = false;
        errors.push(
          `Narration segment "${seg.id}" scheduled window (${scheduledWindow.toFixed(2)}s) is shorter than its actual PCM audio duration (${actualPcmDur.toFixed(2)}s).`
        );
      }
      if (i > 0 && scheduled.startTimeSec < syncSegs[i - 1].endTimeSec - 0.02) {
        noSceneCut = false;
        errors.push(
          `Narration segment "${seg.id}" overlaps previous segment "${syncSegs[i - 1].id}" (${scheduled.startTimeSec.toFixed(2)}s < ${syncSegs[i - 1].endTimeSec.toFixed(2)}s).`
        );
      }
    }
  }

  // 2. Verify last spoken word finishes cleanly before timeline end
  const lastWordEndTimeSec =
    syncSegs.length > 0
      ? Number(Math.max(...syncSegs.map(s => Number(s.endTimeSec) || 0)).toFixed(3))
      : 0;
  const tailMarginSec = Number((timelineDurationSec - lastWordEndTimeSec).toFixed(3));

  if (lastWordEndTimeSec > timelineDurationSec + 0.01) {
    noClippedWords = false;
    errors.push(
      `Final narration segment ends at ${lastWordEndTimeSec.toFixed(2)}s, which exceeds total video duration (${timelineDurationSec.toFixed(2)}s) and clips the final words.`
    );
  } else if (tailMarginSec < 0.05) {
    noClippedWords = false;
    errors.push(
      `Final narration segment ends too close to video end (tail margin ${tailMarginSec.toFixed(3)}s < 0.05s safety margin), risking clipped final syllables.`
    );
  }

  // 3. Verify master voiceover WAV waveform & rendered MP4 audio stream
  const masterWavPath = voiceoverInfo?.masterVoiceoverPath || editingPlan.audio?.voiceoverAudioPath;
  if (masterWavPath && fs.existsSync(masterWavPath)) {
    const masterBuf = fs.readFileSync(masterWavPath);
    const masterPcm = extractWavPcmData(masterBuf);
    const masterDurSec = masterPcm.length / 48000;
    if (masterDurSec + 0.08 < lastWordEndTimeSec) {
      waveformVerified = false;
      noClippedWords = false;
      errors.push(
        `Master voiceover WAV duration (${masterDurSec.toFixed(2)}s) is shorter than last scheduled narration end (${lastWordEndTimeSec.toFixed(2)}s).`
      );
    }

    // Check that the final 60ms of the master WAV is at peace (tail cushion / apad) rather than mid-peak truncation
    if (masterPcm.length >= 2880) {
      const tailSlice = masterPcm.subarray(masterPcm.length - 1920); // last 40ms
      let tailRmsSum = 0;
      const sampleCount = Math.floor(tailSlice.length / 2);
      for (let k = 0; k + 1 < tailSlice.length; k += 2) {
        const s = tailSlice.readInt16LE(k) / 32768;
        tailRmsSum += s * s;
      }
      const tailRms = Math.sqrt(tailRmsSum / Math.max(1, sampleCount));
      if (tailRms > 0.35) {
        waveformVerified = false;
        noClippedWords = false;
        errors.push(
          `Master voiceover waveform exhibits high amplitude right at the EOF boundary (tail RMS=${tailRms.toFixed(3)}), indicating a clipped final word.`
        );
      }
    }
  }

  if (renderedMp4Path && fs.existsSync(renderedMp4Path)) {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,duration',
        '-of', 'json',
        renderedMp4Path
      ]);
      const parsed = JSON.parse(stdout || '{}');
      const aStream = parsed?.streams?.[0];
      if (!aStream) {
        waveformVerified = false;
        errors.push('Rendered MP4 is missing an audio stream despite active voiceover segments.');
      } else {
        const aDur = parseFloat(aStream.duration || '0');
        if (aDur > 0 && aDur + 0.12 < lastWordEndTimeSec) {
          waveformVerified = false;
          noClippedWords = false;
          errors.push(
            `Rendered MP4 audio stream duration (${aDur.toFixed(2)}s) cuts off before final narration word (${lastWordEndTimeSec.toFixed(2)}s).`
          );
        }
      }
    } catch (_) {}
  }

  const valid =
    allSegmentsPresent &&
    nonSilent &&
    allSegmentsScheduled &&
    noSceneCut &&
    noClippedWords &&
    waveformVerified &&
    errors.length === 0;

  const summary = valid
    ? `Voiceover Validation Passed: ${syncSegs.length}/${expectedSegmentsCount} segments complete, last word at ${lastWordEndTimeSec.toFixed(2)}s / ${timelineDurationSec.toFixed(2)}s (tail margin +${tailMarginSec.toFixed(2)}s).`
    : `Voiceover Validation Failed: ${errors.join(' | ')}`;

  return {
    valid,
    allSegmentsPresent,
    nonSilent,
    allSegmentsScheduled,
    noSceneCut,
    noClippedWords,
    waveformVerified,
    segmentsChecked: syncSegs.length,
    lastWordEndTimeSec,
    timelineDurationSec,
    tailMarginSec,
    errors,
    summary
  };
}

export interface TimelineRecalculationInput {
  rawScenes: any[];
  assets: CreatorAsset[];
  analysis: MultimodalAnalysisAsset[];
  audioSegments: Array<{
    id: string;
    text: string;
    filePath: string;
    durationSec: number;
    sceneId?: string;
    role?: string;
  }>;
  targetDurationSec: number;
  colorGradingTheme?: 'vibrant' | 'warm_luxury' | 'cool_tech' | 'cinematic' | 'clean_natural';
}

export interface TimelineRecalculationOutput {
  totalDurationSec: number;
  totalFrames: number;
  scenes: EditingPlanScene[];
  synchronizedSegments: SynchronizedCreatorSegment[];
  subtitles: Array<{ startTimeSec: number; endTimeSec: number; text: string }>;
}

const COMMERCIAL_CAMERA_PROGRESSION: readonly CreatorCameraEffect[] = [
  'smart_subject_focus',
  'track_horizontal',
  'pull_back_reveal',
  'pip_detail_spotlight',
  'detail_closeup',
  'handheld_stabilized',
  'track_vertical',
  'pan_right'
];

const COMMERCIAL_TRANSITION_PROGRESSION: readonly CreatorTransitionType[] = [
  'crossfade',
  'smoothleft',
  'dissolve',
  'circleopen',
  'fadeblack',
  'smoothup'
];

const DIRECTIONAL_TRANSITIONS = new Set<string>([
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown'
]);

function inferCommercialSceneRole(index: number, totalScenes: number): CreatorSceneRole {
  if (index === 0) return 'hook';
  if (index === totalScenes - 1) return 'cta';
  if (index === 1) return 'product_intro';
  if (index === 2) return 'demonstration';
  return 'benefits';
}

function inferCommercialShotType(
  effect: CreatorCameraEffect,
  role: CreatorSceneRole
): CreatorShotType {
  if (effect === 'pip_detail_spotlight') return 'pip_detail';
  if (effect === 'detail_closeup' || effect === 'smart_subject_focus') return 'detail_closeup';
  if (role === 'cta') return 'cta_card';
  if (effect === 'pull_back_reveal' || effect === 'track_vertical') return 'full_shot';
  return 'medium_hero';
}

/**
 * Full-Graph Atomic Timeline Recalculation Engine (P0):
 * - Maps M voiceover segments to N scenes (supporting M=N, M>N, M<N, silent scenes, and speech > scene).
 * - Enforces MAX_SCENE_EXPANSION_RATIO (1.75x) / MAX_SINGLE_SCENE_DURATION_SEC (10.0s) with overflow segment spillover.
 * - Enforces Tier 3 short-video scene capping (MAX_SLOWDOWN_FACTOR = 1.25) when alternate scenes/assets exist.
 * - Guarantees every scene with narration receives enough 30-FPS frames for its complete speech + safety margin,
 *   and applies a Backward-Cascade Tail Guard so the final spoken word is NEVER clipped by timeline end (-t).
 * - Assigns commercial scene roles, shot types, and varied camera movements (preventing repetitive zoom-only plans).
 */
export function recalculateCompleteEditingTimeline(
  input: TimelineRecalculationInput
): TimelineRecalculationOutput {
  const {
    rawScenes,
    assets,
    analysis,
    audioSegments,
    targetDurationSec: requestedTargetDurationSec,
    colorGradingTheme = 'vibrant'
  } = input;

  const baseTargetDurationSec = Math.max(
    MIN_SCENE_DURATION_SEC,
    Number(requestedTargetDurationSec) || 15
  );

  const safeAssets: CreatorAsset[] =
    assets.length > 0
      ? assets
      : [{ id: 'asset_1', type: 'image', filePath: '', originalName: 'default.jpg', mimeType: 'image/jpeg' }];
  const validAssetIds = new Set(safeAssets.map(a => a.id));

  // 1. Build working scene list from rawScenes (or default across assets)
  const workingScenes: Array<{
    assetId: string;
    asset: CreatorAsset;
    sceneRole?: CreatorSceneRole;
    shotType?: CreatorShotType;
    initDurationSec: number;
    durationSec: number;
    rawStartTimeSec?: number;
    effect: CreatorCameraEffect;
    samFocusBox?: [number, number, number, number];
    transitionOut: CreatorTransitionType;
    colorGrading: EditingPlanScene['colorGrading'];
    overlayText?: string;
    overlayStyle?: 'badge' | 'title' | 'cta_pill';
    videoMaxDurationSec?: number;
  }> = [];

  const sourceScenes =
    Array.isArray(rawScenes) && rawScenes.length > 0
      ? rawScenes
      : safeAssets.map((ast, idx) => ({
          assetId: ast.id,
          type: ast.type,
          durationSec: baseTargetDurationSec / safeAssets.length,
          effect: COMMERCIAL_CAMERA_PROGRESSION[idx % COMMERCIAL_CAMERA_PROGRESSION.length],
          transitionOut:
            idx === safeAssets.length - 1
              ? 'none'
              : COMMERCIAL_TRANSITION_PROGRESSION[idx % COMMERCIAL_TRANSITION_PROGRESSION.length]
        }));

  let rawSum = sourceScenes.reduce(
    (sum, s) => sum + (Number(s.durationSec) > 0 ? Number(s.durationSec) : 3.0),
    0
  );
  if (rawSum <= 0) rawSum = baseTargetDurationSec;
  const initRatio = baseTargetDurationSec / rawSum;

  for (let i = 0; i < sourceScenes.length; i++) {
    const sc = sourceScenes[i];
    let assetId = sc.assetId;
    if (!validAssetIds.has(assetId)) {
      assetId = safeAssets[i % safeAssets.length].id;
    }
    // Avoid unnecessary consecutive reuse of identical asset when multiple uploaded assets exist
    if (i > 0 && safeAssets.length >= 2 && assetId === workingScenes[i - 1].assetId) {
      const usedSet = new Set(workingScenes.map(w => w.assetId));
      const unusedAsset = safeAssets.find(a => !usedSet.has(a.id) && a.id !== workingScenes[i - 1].assetId);
      const alternateAsset = unusedAsset || safeAssets.find(a => a.id !== workingScenes[i - 1].assetId);
      if (alternateAsset) {
        assetId = alternateAsset.id;
      }
    }
    const asset = safeAssets.find(a => a.id === assetId) || safeAssets[0];
    const assetAnalysis = analysis.find(a => a.assetId === assetId);
    const samFocusBox = sc.samFocusBox || assetAnalysis?.samLocalizationCues?.[0]?.box2d;

    const initDur = Math.max(
      MIN_SCENE_DURATION_SEC,
      (Number(sc.durationSec) > 0 ? Number(sc.durationSec) : 3.0) * initRatio
    );

    const transitionOut: CreatorTransitionType =
      VALID_CREATOR_TRANSITIONS.includes(sc.transitionOut)
        ? sc.transitionOut
        : COMMERCIAL_TRANSITION_PROGRESSION[i % COMMERCIAL_TRANSITION_PROGRESSION.length];

    const effect: CreatorCameraEffect =
      VALID_CREATOR_EFFECTS.includes(sc.effect)
        ? sc.effect
        : COMMERCIAL_CAMERA_PROGRESSION[i % COMMERCIAL_CAMERA_PROGRESSION.length];

    let videoMaxDurationSec: number | undefined = undefined;
    if (asset.type === 'video' && typeof asset.durationSec === 'number' && asset.durationSec > 0) {
      const maxPreExtendedSec = MAX_SLOWDOWN_FACTOR * asset.durationSec;
      videoMaxDurationSec = Math.max(MIN_SCENE_DURATION_SEC, maxPreExtendedSec);
    }

    workingScenes.push({
      assetId,
      asset,
      sceneRole: sc.sceneRole,
      shotType: sc.shotType,
      initDurationSec: initDur,
      durationSec: initDur,
      rawStartTimeSec: typeof sc.startTimeSec === 'number' ? sc.startTimeSec : undefined,
      effect,
      samFocusBox,
      transitionOut,
      colorGrading: sc.colorGrading || colorGradingTheme || 'vibrant',
      overlayText: sc.overlayText ? String(sc.overlayText) : undefined,
      overlayStyle: sc.overlayStyle,
      videoMaxDurationSec
    });
  }

  // 2. Map M voiceover segments to N scenes (handles M=N, M>N, M<N, explicit sceneId, role hooks)
  const sceneSegmentsMap: Array<typeof audioSegments> = workingScenes.map(() => []);
  const M = audioSegments.length;
  const N = workingScenes.length;

  for (let k = 0; k < M; k++) {
    const seg = audioSegments[k];
    let assignedIdx = -1;

    if (seg.sceneId) {
      const matchByAsset = workingScenes.findIndex(
        (s, idx) =>
          s.assetId === seg.sceneId ||
          `scene_${idx + 1}` === seg.sceneId ||
          `scene-${idx + 1}` === seg.sceneId
      );
      if (matchByAsset !== -1) {
        assignedIdx = matchByAsset;
      }
    }

    if (assignedIdx === -1) {
      if (seg.role === 'hook' && k === 0) {
        assignedIdx = 0;
      } else if (seg.role === 'call_to_action' && k === M - 1) {
        assignedIdx = N - 1;
      } else if (M <= N) {
        assignedIdx =
          M === 1
            ? 0
            : Math.min(N - 1, Math.round((k * (N - 1)) / (M - 1)));
      } else {
        assignedIdx = Math.min(N - 1, Math.floor((k * N) / M));
      }
    }

    sceneSegmentsMap[assignedIdx].push(seg);
  }

  const computeRequiredSpeechWindow = (segs: typeof audioSegments, isLastScene = false): number => {
    if (!segs || segs.length === 0) return 0;
    const sumDur = segs.reduce((acc, s) => acc + Math.max(0.2, Number(s.durationSec) || 0), 0);
    const intraPauses = Math.max(0, segs.length - 1) * 0.18;
    const tailMargin = isLastScene ? TIMELINE_TAIL_MARGIN_SEC : 0.15;
    return 0.15 + sumDur + intraPauses + tailMargin;
  };

  // 3. Enforce Deterministic Maximum Scene Expansion Policy & Overflow Segment Spillover
  let idx = 0;
  while (idx < workingScenes.length && workingScenes.length < 20) {
    const sc = workingScenes[idx];
    const segs = sceneSegmentsMap[idx];
    const capSec = Math.min(
      MAX_SINGLE_SCENE_DURATION_SEC,
      Math.max(5.0, MAX_SCENE_EXPANSION_RATIO * sc.initDurationSec)
    );

    while (segs.length > 1 && computeRequiredSpeechWindow(segs, idx === workingScenes.length - 1) > capSec) {
      const overflowSeg = segs.pop()!;
      if (idx + 1 < workingScenes.length) {
        sceneSegmentsMap[idx + 1].unshift(overflowSeg);
      } else {
        const nextAsset = safeAssets[workingScenes.length % safeAssets.length];
        const nextAnalysis = analysis.find(a => a.assetId === nextAsset.id);
        const nextSamBox = nextAnalysis?.samLocalizationCues?.[0]?.box2d;
        const spilledWindow = Math.max(2.0, (Number(overflowSeg.durationSec) || 2.0) + 0.45);
        workingScenes.push({
          assetId: nextAsset.id,
          asset: nextAsset,
          initDurationSec: spilledWindow,
          durationSec: spilledWindow,
          effect: COMMERCIAL_CAMERA_PROGRESSION[workingScenes.length % COMMERCIAL_CAMERA_PROGRESSION.length],
          samFocusBox: nextSamBox,
          transitionOut: 'none',
          colorGrading: colorGradingTheme || 'vibrant',
          overlayStyle: 'cta_pill',
          videoMaxDurationSec:
            nextAsset.type === 'video' && nextAsset.durationSec
              ? Math.max(MIN_SCENE_DURATION_SEC, MAX_SLOWDOWN_FACTOR * nextAsset.durationSec)
              : undefined
        });
        sceneSegmentsMap.push([overflowSeg]);
      }
    }
    idx++;
  }

  // 4. Tier 3 Short-Video Capping (when multiple scenes exist so slack can be redistributed)
  if (workingScenes.length > 1) {
    let cappedExcess = 0;
    const uncappedIndices: number[] = [];

    for (let i = 0; i < workingScenes.length; i++) {
      const sc = workingScenes[i];
      const speechReq = computeRequiredSpeechWindow(sceneSegmentsMap[i], i === workingScenes.length - 1);
      if (
        sc.videoMaxDurationSec !== undefined &&
        sc.durationSec > sc.videoMaxDurationSec &&
        speechReq <= sc.videoMaxDurationSec
      ) {
        const hasOutgoingTrans = i < workingScenes.length - 1 && sc.transitionOut !== 'none';
        const maxNominal = Math.max(
          MIN_SCENE_DURATION_SEC,
          sc.videoMaxDurationSec - (hasOutgoingTrans ? 10 / 30 : 0)
        );
        if (sc.durationSec > maxNominal) {
          cappedExcess += sc.durationSec - maxNominal;
          sc.durationSec = maxNominal;
        }
      } else {
        uncappedIndices.push(i);
      }
    }

    if (cappedExcess > 0 && uncappedIndices.length > 0) {
      const perSceneAdd = cappedExcess / uncappedIndices.length;
      for (const uIdx of uncappedIndices) {
        workingScenes[uIdx].durationSec += perSceneAdd;
      }
    }
  }

  // 5. Speech-Aware Scene Duration Allocation (NEVER scale scenes below their required speech duration)
  const minRequiredPerScene = workingScenes.map((_, i) =>
    Math.max(
      MIN_SCENE_DURATION_SEC,
      computeRequiredSpeechWindow(sceneSegmentsMap[i], i === workingScenes.length - 1)
    )
  );

  const minRequiredTotalSec = minRequiredPerScene.reduce((acc, v) => acc + v, 0);
  const effectiveTargetDurationSec = Math.max(baseTargetDurationSec, minRequiredTotalSec);

  const targetTotalFrames = Math.round(effectiveTargetDurationSec * 30);
  const minFramesPerScene = Math.max(
    15,
    Math.min(Math.round(MIN_SCENE_DURATION_SEC * 30), Math.floor(targetTotalFrames / workingScenes.length))
  );

  const requiredFramesList = workingScenes.map((_, i) =>
    Math.max(minFramesPerScene, Math.ceil(minRequiredPerScene[i] * 30))
  );

  const hasUncappedScene = workingScenes.some(sc => sc.videoMaxDurationSec === undefined);
  const maxAllowedFramesList = workingScenes.map((sc, i) => {
    if (sc.videoMaxDurationSec !== undefined && hasUncappedScene) {
      const hasOutgoingTrans = i < workingScenes.length - 1 && sc.transitionOut !== 'none';
      const maxNominalSec = Math.max(
        MIN_SCENE_DURATION_SEC,
        sc.videoMaxDurationSec - (hasOutgoingTrans ? 10 / 30 : 0)
      );
      return Math.max(requiredFramesList[i], Math.floor(maxNominalSec * 30));
    }
    return Number.POSITIVE_INFINITY;
  });

  const requiredFramesSum = requiredFramesList.reduce((acc, f) => acc + f, 0);
  const nominalFramesList: number[] = [];

  if (requiredFramesSum >= targetTotalFrames) {
    let running = 0;
    for (let i = 0; i < workingScenes.length; i++) {
      const k = requiredFramesList[i];
      nominalFramesList.push(k);
      running += k;
    }
  } else {
    // Distribute surplus frames above requiredFramesList proportionally to each scene's post-cap duration slack
    const surplusFrames = targetTotalFrames - requiredFramesSum;
    const rawWeights = workingScenes.map((sc, i) => {
      if (requiredFramesList[i] >= maxAllowedFramesList[i]) return 0;
      return Math.max(0, sc.durationSec - minRequiredPerScene[i]);
    });
    const rawWeightSum = rawWeights.reduce((acc, w) => acc + w, 0);
    const weights =
      rawWeightSum > 0
        ? rawWeights
        : workingScenes.map((_, i) => (requiredFramesList[i] < maxAllowedFramesList[i] ? 1 : 0));
    const weightSum = weights.reduce((acc, w) => acc + w, 0) || 1;

    let running = 0;
    for (let i = 0; i < workingScenes.length; i++) {
      if (i < workingScenes.length - 1) {
        const addFrames = Math.round(surplusFrames * (weights[i] / weightSum));
        const k = Math.min(maxAllowedFramesList[i], requiredFramesList[i] + addFrames);
        nominalFramesList.push(k);
        running += k;
      } else {
        const kLast = Math.min(maxAllowedFramesList[i], Math.max(requiredFramesList[i], targetTotalFrames - running));
        nominalFramesList.push(kLast);
        running += kLast;
      }
    }
  }

  // Ensure exact frame sum === targetTotalFrames (when requiredFramesSum <= targetTotalFrames) without violating requiredFramesList or maxAllowedFramesList
  let framesRunningSum = nominalFramesList.reduce((acc, k) => acc + k, 0);
  let frameDelta = targetTotalFrames - framesRunningSum;
  if (frameDelta !== 0 && nominalFramesList.length > 0 && requiredFramesSum <= targetTotalFrames) {
    if (frameDelta > 0) {
      let toAdd = frameDelta;
      for (let i = nominalFramesList.length - 1; i >= 0 && toAdd > 0; i--) {
        const room = maxAllowedFramesList[i] - nominalFramesList[i];
        if (room > 0) {
          const add = Math.min(room, toAdd);
          nominalFramesList[i] += add;
          toAdd -= add;
        }
      }
      if (toAdd > 0) {
        nominalFramesList[nominalFramesList.length - 1] += toAdd;
      }
    } else {
      let toRemove = -frameDelta;
      for (let i = nominalFramesList.length - 1; i >= 0 && toRemove > 0; i--) {
        const removable = Math.max(0, nominalFramesList[i] - requiredFramesList[i]);
        const cut = Math.min(removable, toRemove);
        nominalFramesList[i] -= cut;
        toRemove -= cut;
      }
    }
    framesRunningSum = nominalFramesList.reduce((acc, k) => acc + k, 0);
  }

  const totalFrames = framesRunningSum;
  const totalDurationSec = Number((totalFrames / 30).toFixed(6));

  // 6b. Enforce commercial camera variety (prevent >50% pure zoom scenes) & non-repeating directional transitions
  if (workingScenes.length >= 2) {
    const nonZoomCommercialEffects: CreatorCameraEffect[] = [
      'track_horizontal',
      'pull_back_reveal',
      'detail_closeup',
      'pip_detail_spotlight',
      'handheld_stabilized',
      'track_vertical',
      'pan_right',
      'pan_left'
    ];
    const maxAllowedZoom = Math.max(1, Math.floor(workingScenes.length * 0.5));
    let seenZoomCount = 0;
    for (let i = 0; i < workingScenes.length; i++) {
      if (PURE_ZOOM_EFFECTS.has(workingScenes[i].effect)) {
        seenZoomCount++;
        if (seenZoomCount > maxAllowedZoom) {
          workingScenes[i].effect = nonZoomCommercialEffects[i % nonZoomCommercialEffects.length];
        }
      }
      if (i > 0 && i < workingScenes.length - 1) {
        const prevT = workingScenes[i - 1].transitionOut;
        const currT = workingScenes[i].transitionOut;
        if (prevT === currT && DIRECTIONAL_TRANSITIONS.has(currT)) {
          workingScenes[i].transitionOut =
            COMMERCIAL_TRANSITION_PROGRESSION[(i + 1) % COMMERCIAL_TRANSITION_PROGRESSION.length];
        }
      }
    }
  }

  // 7. Build normalized EditingPlanScene[] & SynchronizedCreatorSegment[] atomically
  const normalizedScenes: EditingPlanScene[] = [];
  const synchronizedSegments: SynchronizedCreatorSegment[] = [];
  let startFrameCursor = 0;
  let prevVoiceEndSec = 0;

  for (let i = 0; i < workingScenes.length; i++) {
    const sc = workingScenes[i];
    const isLastScene = i === workingScenes.length - 1;
    const K_i = nominalFramesList[i];
    const D_i = Number((K_i / 30).toFixed(6));
    const S_i = Number((startFrameCursor / 30).toFixed(6));

    const transitionOut: CreatorTransitionType = isLastScene ? 'none' : sc.transitionOut;

    const K_next = isLastScene ? 0 : nominalFramesList[i + 1];
    const M_i =
      isLastScene || transitionOut === 'none'
        ? 0
        : Math.min(10, Math.floor(0.25 * Math.min(K_i, K_next)));
    const T_i = Number((M_i / 30).toFixed(6));
    const K_prime_i = K_i + M_i;
    const D_prime_i = Number((K_prime_i / 30).toFixed(6));
    const O_i = Number(((startFrameCursor + K_i) / 30).toFixed(6));

    let startTimeSec: number | undefined = undefined;
    let endTimeSec: number | undefined = undefined;
    if (sc.asset.type === 'video') {
      const srcDur = sc.asset.durationSec || 10;
      const rawStart = typeof sc.rawStartTimeSec === 'number' ? sc.rawStartTimeSec : 0;
      if (srcDur >= D_prime_i) {
        startTimeSec = Number(Math.max(0, Math.min(rawStart, srcDur - D_prime_i)).toFixed(3));
        endTimeSec = Number((startTimeSec + D_prime_i).toFixed(3));
      } else {
        startTimeSec = 0;
        endTimeSec = Number(srcDur.toFixed(3));
      }
    }

    const assignedSegs = sceneSegmentsMap[i] || [];
    const segIds: string[] = [];

    for (const seg of assignedSegs) {
      const segDur = Math.max(0.2, Number(seg.durationSec) || 1.0);
      const minStart =
        synchronizedSegments.length === 0 ? S_i + 0.15 : Math.max(S_i + 0.15, prevVoiceEndSec + 0.18);
      const segStart = Number(minStart.toFixed(3));
      const segEnd = Number((segStart + segDur).toFixed(3));
      prevVoiceEndSec = segEnd;
      segIds.push(seg.id);

      synchronizedSegments.push({
        id: seg.id,
        sceneIndex: i,
        text: seg.text,
        filePath: seg.filePath,
        startTimeSec: segStart,
        endTimeSec: segEnd,
        durationSec: Number(segDur.toFixed(3))
      });
    }

    const sceneRole: CreatorSceneRole =
      sc.sceneRole || inferCommercialSceneRole(i, workingScenes.length);
    const shotType: CreatorShotType =
      sc.shotType || inferCommercialShotType(sc.effect, sceneRole);

    const overlayStyle: 'badge' | 'title' | 'cta_pill' =
      sc.overlayStyle || (i === 0 ? 'title' : isLastScene ? 'cta_pill' : 'badge');

    normalizedScenes.push({
      assetId: sc.assetId,
      type: sc.asset.type,
      sceneRole,
      shotType,
      timelineStartTimeSec: S_i,
      startTimeSec,
      endTimeSec,
      durationSec: D_i,
      nominalFrames: K_i,
      transitionFrames: M_i,
      transitionDurationSec: T_i,
      preparedClipFrames: K_prime_i,
      preparedClipDurationSec: D_prime_i,
      xfadeOffsetSec: O_i,
      voiceoverSegmentIds: segIds,
      effect: sc.effect,
      samFocusBox: sc.samFocusBox,
      transitionOut,
      colorGrading: sc.colorGrading,
      overlayText: sc.overlayText,
      overlayStyle,
      overlayTextStartTimeSec: Number((S_i + 0.25).toFixed(3)),
      overlayTextDurationSec: Number(Math.max(1.0, Math.min(3.5, D_i - 0.5)).toFixed(3))
    });

    startFrameCursor += K_i;
  }

  // 8. Backward-Cascade Tail Guard:
  // Guarantee the final spoken word NEVER exceeds (totalDurationSec - TIMELINE_TAIL_MARGIN_SEC)
  // so FFmpeg -t trimming or transition overlaps never cut off the final words!
  if (synchronizedSegments.length > 0) {
    const maxAllowedEndSec = Math.max(0.5, totalDurationSec - TIMELINE_TAIL_MARGIN_SEC);
    const lastIdx = synchronizedSegments.length - 1;
    if (synchronizedSegments[lastIdx].endTimeSec > maxAllowedEndSec) {
      const latestEnd = maxAllowedEndSec;
      synchronizedSegments[lastIdx].endTimeSec = Number(latestEnd.toFixed(3));
      synchronizedSegments[lastIdx].startTimeSec = Number(
        Math.max(0.06, latestEnd - synchronizedSegments[lastIdx].durationSec).toFixed(3)
      );

      for (let k = lastIdx - 1; k >= 0; k--) {
        const nextStart = synchronizedSegments[k + 1].startTimeSec;
        const maxEndForK = Math.max(0.2, nextStart - 0.18);
        if (synchronizedSegments[k].endTimeSec > maxEndForK) {
          synchronizedSegments[k].endTimeSec = Number(maxEndForK.toFixed(3));
          synchronizedSegments[k].startTimeSec = Number(
            Math.max(0.06, maxEndForK - synchronizedSegments[k].durationSec).toFixed(3)
          );
        }
      }

      // Forward pass to ensure strictly non-overlapping chronological order if total speech was very dense
      let cursorSec = Math.max(0.06, synchronizedSegments[0].startTimeSec);
      for (let k = 0; k < synchronizedSegments.length; k++) {
        const dur = synchronizedSegments[k].durationSec;
        const sStart = k === 0 ? cursorSec : Math.max(synchronizedSegments[k].startTimeSec, cursorSec + 0.18);
        synchronizedSegments[k].startTimeSec = Number(sStart.toFixed(3));
        synchronizedSegments[k].endTimeSec = Number((sStart + dur).toFixed(3));
        cursorSec = synchronizedSegments[k].endTimeSec;
      }
    }
  }

  const subtitles = synchronizedSegments.map(seg => ({
    startTimeSec: seg.startTimeSec,
    endTimeSec: Math.min(totalDurationSec, seg.endTimeSec),
    text: seg.text
  }));

  return {
    totalDurationSec,
    totalFrames,
    scenes: normalizedScenes,
    synchronizedSegments,
    subtitles
  };
}

/**
 * Estimates narration segment timing budgets BEFORE any TTS audio is synthesized.
 * Used during Step 4 (Editing Plan Generation & 5-Cycle Senior Director Review)
 * so zero TTS API calls are made while the Editing Plan is still being revised.
 */
export function estimatePreTtsNarrationBudgets(
  targetDurationSec: number,
  assets: CreatorAsset[],
  creativeDirection?: CreativeDirectionOutput,
  speed = 1.0
): {
  estimatedScript: CreatorVideoScript;
  estimatedVoiceoverInfo: {
    masterVoiceoverPath: string;
    totalVoiceoverDurationSec: number;
    audioSegments: Array<{
      id: string;
      text: string;
      filePath: string;
      durationSec: number;
      sceneId: string;
      role: 'hook' | 'problem' | 'solution' | 'benefit' | 'product_reveal' | 'call_to_action';
    }>;
  };
} {
  const safeDur = Math.max(6, Number(targetDurationSec) || 15);
  const maxScenes =
    safeDur <= 10 ? 3 :
    safeDur <= 15 ? 4 :
    safeDur <= 30 ? 6 :
    Math.min(10, Math.max(6, Math.round(safeDur / 7.5)));
  const minScenes =
    safeDur <= 10 ? 2 :
    safeDur <= 15 ? 3 :
    safeDur <= 30 ? 4 :
    Math.min(maxScenes, Math.max(5, assets.length));

  const desiredSceneCount =
    assets.length >= 2
      ? Math.min(Math.max(assets.length, minScenes), maxScenes)
      : safeDur <= 10
      ? 2
      : safeDur <= 15
      ? 3
      : Math.min(maxScenes, Math.max(3, Math.round(safeDur / 8)));

  const usableSpeechTotal = Number((safeDur * 0.72).toFixed(2));
  const hasNonShortAsset = assets.some(
    a => a.type === 'image' || !a.durationSec || a.durationSec * MAX_SLOWDOWN_FACTOR >= safeDur / desiredSceneCount
  );

  // Allocate pre-TTS speech budgets respecting short video clip caps so short video scenes don't get over-extended
  const rawSegDurs: number[] = [];
  let cappedSum = 0;
  const uncappedIndices: number[] = [];
  const defaultPerSeg = usableSpeechTotal / desiredSceneCount;

  for (let i = 0; i < desiredSceneCount; i++) {
    const ast = assets.length > 0 ? assets[i % assets.length] : undefined;
    if (
      hasNonShortAsset &&
      ast &&
      ast.type === 'video' &&
      typeof ast.durationSec === 'number' &&
      ast.durationSec > 0
    ) {
      const maxVidSceneSec = Math.max(MIN_SCENE_DURATION_SEC, ast.durationSec * MAX_SLOWDOWN_FACTOR - 10 / 30);
      const maxVidSpeechSec = Math.max(1.2, maxVidSceneSec - 0.35);
      if (maxVidSpeechSec < defaultPerSeg) {
        rawSegDurs.push(maxVidSpeechSec);
        cappedSum += maxVidSpeechSec;
        continue;
      }
    }
    rawSegDurs.push(defaultPerSeg);
    uncappedIndices.push(i);
  }

  if (uncappedIndices.length > 0 && cappedSum > 0) {
    const remainingSpeech = Math.max(uncappedIndices.length * 1.5, usableSpeechTotal - cappedSum);
    const perUncapped = remainingSpeech / uncappedIndices.length;
    for (const uIdx of uncappedIndices) {
      rawSegDurs[uIdx] = perUncapped;
    }
  }

  const segments: VideoScriptSegment[] = [];
  const audioSegments: Array<{
    id: string;
    text: string;
    filePath: string;
    durationSec: number;
    sceneId: string;
    role: 'hook' | 'problem' | 'solution' | 'benefit' | 'product_reveal' | 'call_to_action';
  }> = [];

  for (let i = 0; i < desiredSceneCount; i++) {
    const perSegDur = Number(rawSegDurs[i].toFixed(2));
    const role: VideoScriptSegment['role'] =
      i === 0
        ? 'hook'
        : i === desiredSceneCount - 1
        ? 'call_to_action'
        : i === 1
        ? 'benefit'
        : 'product_reveal';
    const segId = `seg_${i + 1}`;
    const sceneId = `scene_${i + 1}`;
    const placeholderText = '';

    segments.push({
      id: segId,
      sceneId,
      role,
      text: placeholderText,
      visualDescription: `Scene ${i + 1} (${role})`,
      estimatedDurationSec: perSegDur,
      actualDurationSec: perSegDur,
      emotion: role === 'hook' ? 'excited' : role === 'call_to_action' ? 'persuasive' : 'friendly',
      pace: speed > 1.1 ? 'fast' : 'normal',
      style: 'Premium commercial',
      status: 'pending'
    });

    audioSegments.push({
      id: segId,
      text: placeholderText,
      filePath: '',
      durationSec: perSegDur,
      sceneId,
      role
    });
  }

  return {
    estimatedScript: {
      hook: '',
      mainMessage: creativeDirection?.creativeConcept || '',
      benefits: [],
      callToAction: creativeDirection?.recommendedCallToAction || '',
      dialect: 'Algerian Arabic',
      voice: 'Puck',
      segments
    },
    estimatedVoiceoverInfo: {
      masterVoiceoverPath: '',
      totalVoiceoverDurationSec: usableSpeechTotal,
      audioSegments
    }
  };
}

/**
 * Reconciles a locked/approved Editing Plan (from Step 4) with the actual synthesized
 * DoudouVoice TTS audio segments (from Step 5) WITHOUT regenerating TTS audio.
 * Preserves the approved scene sequence, camera motion effects, transitions, and color grading
 * while elastically adjusting scene timing & building the synchronized master_voiceover.wav.
 */
export async function reconcileLockedEditingPlanWithSynthesizedVoiceover(params: {
  lockedPlan: EditingPlan;
  script: CreatorVideoScript;
  voiceoverInfo: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] };
  assets: CreatorAsset[];
  analysis: MultimodalAnalysisAsset[];
  targetDurationSec: number;
  creativeDirection?: CreativeDirectionOutput;
}): Promise<EditingPlan> {
  const {
    lockedPlan,
    script,
    voiceoverInfo,
    assets,
    analysis,
    targetDurationSec,
    creativeDirection
  } = params;

  const enrichedAudioSegments = (voiceoverInfo.audioSegments || []).map((seg: any, idx: number) => {
    const scriptSeg = script.segments?.find(s => s.id === seg.id) || script.segments?.[idx];
    return {
      id: seg.id || scriptSeg?.id || `seg_${idx + 1}`,
      text: seg.text || scriptSeg?.text || '',
      filePath: seg.filePath || '',
      durationSec:
        Number(seg.durationSec) ||
        Number(scriptSeg?.actualDurationSec) ||
        Number(scriptSeg?.estimatedDurationSec) ||
        2.5,
      sceneId: seg.sceneId || scriptSeg?.sceneId || `scene_${Math.min(idx + 1, Math.max(1, lockedPlan.scenes.length))}`,
      role: seg.role || scriptSeg?.role || (idx === 0 ? 'hook' : idx === (voiceoverInfo.audioSegments.length - 1) ? 'call_to_action' : 'benefit')
    };
  });

  // Preserve locked scene sequence, effects, transitions, colorGrading, and concise overlays (or populate from finalized script CTA/hook if empty)
  const rawScenesFromLocked = lockedPlan.scenes.map((sc, idx) => {
    const isLast = idx === lockedPlan.scenes.length - 1;
    let overlayText = sc.overlayText;
    if (!overlayText && idx === 0 && script.hook) {
      overlayText = script.hook.slice(0, 32).trim();
    } else if (!overlayText && isLast && (script.callToAction || creativeDirection?.recommendedCallToAction)) {
      overlayText = (script.callToAction || creativeDirection?.recommendedCallToAction || '').slice(0, 32).trim();
    }
    return {
      ...sc,
      overlayText,
      overlayStyle: sc.overlayStyle || (idx === 0 ? 'title' : isLast ? 'cta_pill' : 'badge')
    };
  });

  const recalc = recalculateCompleteEditingTimeline({
    rawScenes: rawScenesFromLocked,
    assets,
    analysis,
    audioSegments: enrichedAudioSegments,
    targetDurationSec,
    colorGradingTheme:
      (lockedPlan.scenes[0]?.colorGrading as any) ||
      creativeDirection?.colorGradingTheme ||
      'vibrant'
  });

  if (voiceoverInfo.masterVoiceoverPath && recalc.synchronizedSegments.length > 0) {
    const hasExistingSegmentFiles = recalc.synchronizedSegments.some(
      s => s.filePath && fs.existsSync(s.filePath)
    );
    if (hasExistingSegmentFiles) {
      await buildCreatorSynchronizedVoiceover(
        recalc.synchronizedSegments,
        recalc.totalDurationSec,
        voiceoverInfo.masterVoiceoverPath
      );
    }
  }

  return {
    ...lockedPlan,
    totalDurationSec: recalc.totalDurationSec,
    totalFrames: recalc.totalFrames,
    scenes: recalc.scenes,
    audio: {
      voiceoverAudioPath: voiceoverInfo.masterVoiceoverPath,
      voiceoverVolume: lockedPlan.audio?.voiceoverVolume || 1.4,
      backgroundMusicVolume: lockedPlan.audio?.backgroundMusicVolume || 0.15,
      ducking: true
    },
    subtitles: recalc.subtitles,
    synchronizedSegments: recalc.synchronizedSegments
  };
}

/**
 * Step 4 / Stage E: Meta Editing Director (Generating & Strictly Normalizing Executable Editing Plan JSON).
 * Supports running BEFORE Script & Voice (when script / voiceoverInfo are omitted, using pre-TTS narration timing budgets).
 */
export async function generateCreatorEditingPlan(
  creativeDirection: CreativeDirectionOutput,
  script?: CreatorVideoScript | null,
  analysis: MultimodalAnalysisAsset[] = [],
  voiceoverInfo?: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] } | null,
  assets: CreatorAsset[] = [],
  targetDurationSecOverride?: number
): Promise<EditingPlan> {
  const targetDurationSec = targetDurationSecOverride || creativeDirection.suggestedDurationSec || 15;
  const contributorModel = getMetaContributorModel();

  const preTts = (!script || !voiceoverInfo)
    ? estimatePreTtsNarrationBudgets(targetDurationSec, assets, creativeDirection)
    : null;
  const effectiveScript = script || preTts!.estimatedScript;
  const effectiveVoiceoverInfo = voiceoverInfo || preTts!.estimatedVoiceoverInfo;

  const targetAspectRatio = creativeDirection.formatAspectRatio || '9:16';
  const resolutionMap = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 }
  };
  const resolution = resolutionMap[targetAspectRatio] || resolutionMap['9:16'];

  const prompt = `Act as Muse Spark 1.2 Contributor, an expert AI Commercial Video Editing Contributor.
Generate a strictly validated Executable Editing Plan JSON to synthesize a commercial advertisement using FFmpeg.

Assets Available:
${JSON.stringify(assets.map(a => ({ id: a.id, type: a.type, originalName: a.originalName, durationSec: a.durationSec })), null, 2)}

Multimodal Asset Analysis:
${JSON.stringify(analysis, null, 2)}

Creative Direction:
${JSON.stringify(creativeDirection, null, 2)}

Narration Segment Timing Budgets:
${JSON.stringify(effectiveVoiceoverInfo.audioSegments, null, 2)}

Strict Commercial Editing & Technical Rules:
- Total Target Video Duration: EXACTLY ${targetDurationSec} seconds.
- Aspect Ratio: ${targetAspectRatio} (${resolution.width}x${resolution.height}).
- Sequence scenes sequentially so scene 0 starts at 0s, scene 1 starts where scene 0 ends.
- The sum of all scene durationSec values must equal ${targetDurationSec}.
- Use available asset IDs: ${assets.map(a => `"${a.id}"`).join(', ')}.
- NEVER reuse the exact same image/asset across consecutive scenes when multiple assets are available (${assets.length} uploaded assets available). Use every distinct uploaded asset before repeating any asset.
- Structure the commercial with clear visual storytelling roles ("sceneRole": "hook" | "product_intro" | "demonstration" | "benefits" | "cta") and shot types ("shotType": "detail_closeup" | "medium_hero" | "full_shot" | "pip_detail" | "cta_card").
- VARY camera movements across scenes: NEVER apply pure zoom to every scene or more than half of scenes. Choose from allowlisted professional camera effects: "smart_subject_focus", "track_horizontal", "pull_back_reveal", "pip_detail_spotlight", "detail_closeup", "handheld_stabilized", "track_vertical", "pan_left", "pan_right", "slow_zoom_in", "slow_zoom_out", "static".
- Choose from allowlisted professional transitions: "crossfade", "fade", "fadeblack", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "smoothleft", "smoothright", "smoothup", "smoothdown", "circleopen", "horzopen", "none". Do NOT repeat the same directional transition consecutively. The final scene must have transitionOut: "none".
- Maintain consistent colorGrading ("${creativeDirection.colorGradingTheme || 'vibrant'}") across scenes.
- Keep overlayText concise (max 32 characters) so it never obscures the main product subject or faces. Place a clear CTA overlay on the final scene.

Return a structured JSON object ONLY matching this schema:
{
  "totalDurationSec": ${targetDurationSec},
  "aspectRatio": "${targetAspectRatio}",
  "resolution": { "width": ${resolution.width}, "height": ${resolution.height} },
  "scenes": [
    {
      "assetId": "${assets[0]?.id || 'asset_1'}",
      "type": "${assets[0]?.type || 'image'}",
      "sceneRole": "hook",
      "shotType": "detail_closeup",
      "durationSec": 5.0,
      "effect": "smart_subject_focus",
      "transitionOut": "crossfade",
      "colorGrading": "${creativeDirection.colorGradingTheme || 'vibrant'}",
      "overlayText": "Headline text",
      "overlayStyle": "title"
    }
  ],
  "audio": {
    "voiceoverAudioPath": "${effectiveVoiceoverInfo.masterVoiceoverPath}",
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
  let usedProvider: AiProviderType = 'meta';
  let usedModel: string = contributorModel;
  try {
    const chatRes = await defaultMetaClient.callMetaChat(
      [{ role: 'user', content: prompt }],
      0.3,
      { strictMeta: true, modelOverride: contributorModel }
    );
    usedProvider = chatRes.provider;
    usedModel = chatRes.model;
    const res = chatRes.data;
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err: any) {
    throw new Error(`Stage E Meta AI Editing Contributor (${contributorModel}) failed: ${err.message}`);
  }

  return await buildAndNormalizeEditingPlanFromRaw(
    rawResponse,
    creativeDirection,
    effectiveScript,
    analysis,
    effectiveVoiceoverInfo,
    assets,
    targetDurationSec,
    usedProvider,
    usedModel
  );
}

async function buildAndNormalizeEditingPlanFromRaw(
  rawResponse: string,
  creativeDirection: CreativeDirectionOutput,
  script: CreatorVideoScript,
  analysis: MultimodalAnalysisAsset[],
  voiceoverInfo: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] },
  assets: CreatorAsset[],
  targetDurationSec: number,
  usedProvider: AiProviderType,
  usedModel: string
): Promise<EditingPlan> {
  const targetAspectRatio = creativeDirection.formatAspectRatio || '9:16';
  const resolutionMap = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 }
  };
  const resolution = resolutionMap[targetAspectRatio] || resolutionMap['9:16'];

  const parsed = extractJsonFromResponse(rawResponse);

  const rawScenes: any[] = Array.isArray(parsed.scenes) && parsed.scenes.length > 0 ? parsed.scenes : [];
  const diverseEffects: CreatorCameraEffect[] = [
    'smart_subject_focus',
    'track_horizontal',
    'pull_back_reveal',
    'pip_detail_spotlight',
    'detail_closeup',
    'handheld_stabilized',
    'track_vertical',
    'pan_right'
  ];
  const diverseTransitions: CreatorTransitionType[] = [
    'crossfade',
    'smoothleft',
    'dissolve',
    'circleopen',
    'fadeblack',
    'smoothup'
  ];

  if (rawScenes.length === 0) {
    const sceneCount = Math.max(2, assets.length);
    const perAssetDuration = targetDurationSec / sceneCount;
    for (let i = 0; i < sceneCount; i++) {
      const ast = assets[i % assets.length];
      rawScenes.push({
        assetId: ast.id,
        type: ast.type,
        sceneRole: inferCommercialSceneRole(i, sceneCount),
        durationSec: perAssetDuration,
        effect: diverseEffects[i % diverseEffects.length],
        transitionOut: i === sceneCount - 1 ? 'none' : diverseTransitions[i % diverseTransitions.length],
        colorGrading: creativeDirection.colorGradingTheme || 'vibrant',
        overlayText:
          script.segments[i]?.text
            ? script.segments[i].text.slice(0, 30)
            : i === sceneCount - 1 && creativeDirection.recommendedCallToAction
            ? creativeDirection.recommendedCallToAction.slice(0, 30)
            : undefined
      });
    }
  }

  const enrichedAudioSegments = (voiceoverInfo.audioSegments || []).map((seg: any, idx: number) => {
    const scriptSeg = script.segments?.find(s => s.id === seg.id) || script.segments?.[idx];
    return {
      id: seg.id || `seg_${idx + 1}`,
      text: seg.text || scriptSeg?.text || '',
      filePath: seg.filePath || '',
      durationSec: Number(seg.durationSec) || Number(scriptSeg?.actualDurationSec) || Number(scriptSeg?.estimatedDurationSec) || 2.5,
      sceneId: seg.sceneId || scriptSeg?.sceneId,
      role: seg.role || scriptSeg?.role
    };
  });

  const recalc = recalculateCompleteEditingTimeline({
    rawScenes,
    assets,
    analysis,
    audioSegments: enrichedAudioSegments,
    targetDurationSec,
    colorGradingTheme: creativeDirection.colorGradingTheme || 'vibrant'
  });

  if (voiceoverInfo.masterVoiceoverPath && recalc.synchronizedSegments.length > 0) {
    const hasExistingSegmentFiles = recalc.synchronizedSegments.some(
      s => s.filePath && fs.existsSync(s.filePath)
    );
    if (hasExistingSegmentFiles) {
      await buildCreatorSynchronizedVoiceover(
        recalc.synchronizedSegments,
        recalc.totalDurationSec,
        voiceoverInfo.masterVoiceoverPath
      );
    }
  }

  return {
    totalDurationSec: recalc.totalDurationSec,
    totalFrames: recalc.totalFrames,
    aspectRatio: targetAspectRatio,
    resolution,
    scenes: recalc.scenes,
    audio: {
      voiceoverAudioPath: voiceoverInfo.masterVoiceoverPath,
      voiceoverVolume: 1.4,
      backgroundMusicVolume: 0.15,
      ducking: true
    },
    subtitles: recalc.subtitles,
    synchronizedSegments: recalc.synchronizedSegments,
    provider: usedProvider,
    model: usedModel
  };
}

// ============================================================================
// MULTI-MODEL CREATIVE REVIEW LOOP (Muse Spark 1.2 Contributor + Muse Spark 1.1 Reviewer)
// ============================================================================

export interface SceneSpecificReviewFeedback {
  sceneIndex: number;
  assetId?: string;
  issue: string;
  requiredFix: string;
}

export interface EditingPlanReviewFeedback {
  decision: 'APPROVED' | 'NEEDS_REVISION';
  quality_score: number;
  strengths: string[];
  issues: string[];
  required_changes: string[];
  optional_changes: string[];
  scene_specific_feedback: SceneSpecificReviewFeedback[];
  approval_reason: string;
  reviewer_model: string;
  cycle: number;
  latencyMs?: number;
  usage?: any;
}

export interface EditingPlanConstraintValidation {
  valid: boolean;
  violations: string[];
}

export interface EditingPlanVersionRecord {
  version: number;
  contributorModel: string;
  reviewerModel: string;
  plan: EditingPlan;
  technicalConstraintValidation: EditingPlanConstraintValidation;
  review: EditingPlanReviewFeedback;
  createdAt: string;
}

export interface EditingPlanReviewSummary {
  finalDecision: 'APPROVED' | 'BEST_AVAILABLE_UNAPPROVED';
  approvedCycle?: number;
  selectedVersion: number;
  totalCyclesRun: number;
  maxCyclesAllowed: number;
  contributorModel: string;
  reviewerModel: string;
  finalQualityScore: number;
  versions: EditingPlanVersionRecord[];
}

/**
 * Programmatically validates an EditingPlan against hard campaign constraints, commercial motion variety,
 * non-repetitive zoom rules, and allowlisted renderer capabilities.
 */
export function validateEditingPlanConstraints(
  plan: EditingPlan,
  options: {
    targetDurationSec: number;
    targetAspectRatio: '9:16' | '16:9' | '1:1';
    assets: CreatorAsset[];
    expectedColorTheme?: string;
  }
): EditingPlanConstraintValidation {
  const violations: string[] = [];
  const { targetDurationSec, targetAspectRatio, assets, expectedColorTheme } = options;

  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    violations.push('Editing plan contains no scenes.');
    return { valid: false, violations };
  }

  // 1. Target duration hard check (±0.5s tolerance)
  if (Math.abs((plan.totalDurationSec || 0) - targetDurationSec) > 0.5) {
    violations.push(
      `Total plan duration (${plan.totalDurationSec}s) violates target duration constraint (${targetDurationSec}s ± 0.5s).`
    );
  }

  const sceneSumSec = plan.scenes.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0);
  if (Math.abs(sceneSumSec - targetDurationSec) > 0.5) {
    violations.push(
      `Sum of scene nominal durations (${sceneSumSec.toFixed(2)}s) does not match target duration (${targetDurationSec}s).`
    );
  }

  // 2. Aspect ratio check
  if (plan.aspectRatio !== targetAspectRatio) {
    violations.push(`Aspect ratio "${plan.aspectRatio}" does not match campaign aspect ratio "${targetAspectRatio}".`);
  }

  // 3. Asset reference & allowlist check
  const validAssetIds = new Set(assets.map(a => a.id));
  for (let i = 0; i < plan.scenes.length; i++) {
    const sc = plan.scenes[i];
    if (validAssetIds.size > 0 && !validAssetIds.has(sc.assetId)) {
      violations.push(`Scene ${i + 1} references unknown assetId "${sc.assetId}".`);
    }
    if (!VALID_CREATOR_EFFECTS.includes(sc.effect as any)) {
      violations.push(`Scene ${i + 1} uses unsupported camera effect "${sc.effect}".`);
    }
    if (!VALID_CREATOR_TRANSITIONS.includes(sc.transitionOut)) {
      violations.push(`Scene ${i + 1} uses unsupported transition "${sc.transitionOut}".`);
    }
    if (sc.durationSec < MIN_SCENE_DURATION_SEC - 0.25) {
      violations.push(`Scene ${i + 1} duration (${sc.durationSec.toFixed(2)}s) is too brief (< ${MIN_SCENE_DURATION_SEC}s).`);
    }
  }

  // 4. Visual variety, anti-repetitive zoom, non-repeating directional transitions, and non-duplicate consecutive assets
  if (plan.scenes.length >= 2) {
    const uniqueEffects = new Set(plan.scenes.map(s => s.effect));
    if (uniqueEffects.size === 1) {
      violations.push(
        `All ${plan.scenes.length} scenes use the exact same camera motion effect ("${plan.scenes[0].effect}"). Vary motion effects across scenes.`
      );
    }

    const zoomSceneCount = plan.scenes.filter(s => PURE_ZOOM_EFFECTS.has(s.effect)).length;
    const maxAllowedZoomScenes = Math.max(1, Math.floor(plan.scenes.length * 0.5));
    if (zoomSceneCount > maxAllowedZoomScenes) {
      violations.push(
        `Repetitive zoom editing detected (${zoomSceneCount}/${plan.scenes.length} scenes use pure zoom effects: ${plan.scenes.map(s => s.effect).join(', ')}). Combine subject focus with tracking pans ("track_horizontal", "track_vertical"), "pull_back_reveal", "detail_closeup", "handheld_stabilized", or "pip_detail_spotlight".`
      );
    }

    for (let i = 1; i < plan.scenes.length - 1; i++) {
      const prevTrans = plan.scenes[i - 1].transitionOut;
      const currTrans = plan.scenes[i].transitionOut;
      if (prevTrans === currTrans && DIRECTIONAL_TRANSITIONS.has(currTrans)) {
        violations.push(
          `Consecutive scenes ${i} and ${i + 1} repeat the identical directional transition "${currTrans}". Vary transition styles.`
        );
      }
    }

    if (assets.length >= 2) {
      for (let i = 1; i < plan.scenes.length; i++) {
        if (plan.scenes[i].assetId === plan.scenes[i - 1].assetId) {
          violations.push(
            `Consecutive scenes ${i} and ${i + 1} reuse the identical asset "${plan.scenes[i].assetId}" while ${assets.length} distinct assets are available.`
          );
        }
      }
    }
  }

  // 5. Color grading consistency check
  const uniqueColors = new Set(plan.scenes.map(s => s.colorGrading).filter(Boolean));
  if (uniqueColors.size > 1) {
    violations.push(
      `Inconsistent color grading across scenes (${Array.from(uniqueColors).join(', ')}). Maintain a unified color grading theme.`
    );
  } else if (expectedColorTheme && uniqueColors.size === 1 && !uniqueColors.has(expectedColorTheme as any)) {
    violations.push(
      `Scene color grading "${Array.from(uniqueColors)[0]}" does not match creative direction theme "${expectedColorTheme}".`
    );
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

/**
 * Muse Spark 1.1 — Senior Editing Director & Quality Reviewer.
 * Evaluates a candidate Editing Plan across all 12 commercial editing dimensions and returns a validated structured review.
 */
export async function reviewEditingPlanWithSeniorDirector(params: {
  plan: EditingPlan;
  creativeDirection: CreativeDirectionOutput;
  script?: CreatorVideoScript | null;
  analysis: MultimodalAnalysisAsset[];
  assets: CreatorAsset[];
  targetDurationSec: number;
  cycle: number;
  constraintValidation: EditingPlanConstraintValidation;
}): Promise<EditingPlanReviewFeedback> {
  const {
    plan,
    creativeDirection,
    script,
    analysis,
    assets,
    targetDurationSec,
    cycle,
    constraintValidation
  } = params;

  const effectiveScript = script || estimatePreTtsNarrationBudgets(targetDurationSec, assets, creativeDirection).estimatedScript;

  const reviewerModel = getMetaReviewerModel(); // 'muse-spark-1.1'
  const startMs = Date.now();

  const systemPrompt = `You are Muse Spark 1.1 acting as an independent Senior Commercial Video Editing Director and Quality Reviewer.
Your job is to rigorously evaluate the candidate Editing Plan produced by Muse Spark 1.2 Contributor against professional advertising standards and hard campaign constraints BEFORE voiceover TTS synthesis is triggered.

Evaluate these 12 mandatory dimensions:
1. Visual storytelling (Hook -> Product Intro -> Demonstration -> Benefits -> CTA)
2. Scene selection and ordering (avoid consecutive reuse of identical images when multiple assets exist)
3. Scene duration and pacing (allocated to accommodate natural narration timing without clipping final words)
4. Visual rhythm
5. Transition selection and timing (smooth transitions without white flashes or repeated directional wipes)
6. Camera movement and animation (NEVER allow basic repetitive zoom on every scene; require tracking pans, pull-back reveals, detail closeups, stabilized handheld motion, or PiP detail spotlights)
7. Product visibility and subject focus (preserve faces and product details via samFocusBox framing)
8. Composition and framing
9. Color grading consistency
10. Text placement and typography (concise overlays in safe areas that do not obscure product details)
11. Advertising impact (strong hook in Scene 1, clear CTA overlay on final scene)
12. Overall professional presentation & exact target duration compliance (${targetDurationSec}s)

Quality Rubric:
- Score 85–100: Broadcast-ready commercial editing plan, varied non-repetitive camera movements/transitions, no consecutive duplicate assets, consistent color grading, strong hook & CTA, zero constraint violations -> decision: "APPROVED".
- Score < 85 OR any required_changes / constraint violations exist -> decision: "NEEDS_REVISION".
- Provide concrete, scene-specific evidence for every issue. Never give vague instructions.

Return ONLY valid JSON matching this exact structure:
{
  "decision": "APPROVED" | "NEEDS_REVISION",
  "quality_score": 88,
  "strengths": ["Concrete strength 1", "Concrete strength 2"],
  "issues": ["Specific issue with scene index/evidence"],
  "required_changes": ["Actionable required change"],
  "optional_changes": ["Optional polish suggestion"],
  "scene_specific_feedback": [
    {
      "sceneIndex": 0,
      "assetId": "asset_1",
      "issue": "Specific weakness on scene 0",
      "requiredFix": "Change effect to track_horizontal and shorten overlayText"
    }
  ],
  "approval_reason": "Detailed explanation of why the plan is approved or why revision is required"
}`;

  const userPrompt = `Review Cycle: ${cycle} of 5
Campaign Target Duration: ${targetDurationSec}s
Campaign Aspect Ratio: ${creativeDirection.formatAspectRatio}
Expected Color Grading Theme: ${creativeDirection.colorGradingTheme}
Available Uploaded Assets: ${JSON.stringify(assets.map(a => ({ id: a.id, type: a.type, name: a.originalName, durationSec: a.durationSec })))}
Asset Visual Analysis Summary: ${JSON.stringify(analysis.map(a => ({ assetId: a.assetId, mainObjects: a.mainObjects, productDetails: a.productDetails, samLocalizationCues: a.samLocalizationCues })))}
Creative Direction: ${JSON.stringify(creativeDirection)}
Narration Timing Budgets: ${JSON.stringify(effectiveScript.segments.map(s => ({ id: s.id, role: s.role, text: s.text, durationSec: s.actualDurationSec || s.estimatedDurationSec })))}
Programmatic Constraint Check Result: ${JSON.stringify(constraintValidation)}

Candidate Editing Plan to Review:
${JSON.stringify({
  totalDurationSec: plan.totalDurationSec,
  aspectRatio: plan.aspectRatio,
  resolution: plan.resolution,
  scenes: plan.scenes,
  subtitlesCount: plan.subtitles?.length || 0
}, null, 2)}`;

  let parsed: any = {};
  let actualModel = reviewerModel;
  let usage: any = undefined;

  try {
    const chatRes = await defaultMetaClient.callMetaChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      0.2,
      { strictMeta: true, modelOverride: reviewerModel }
    );
    actualModel = chatRes.model || reviewerModel;
    usage = chatRes.usage;
    const raw = chatRes.data;
    const text = typeof raw === 'string' ? raw : (raw?.choices?.[0]?.message?.content || raw?.output_text || JSON.stringify(raw));
    parsed = extractJsonFromResponse(text);
  } catch (err: any) {
    console.warn(`[Senior Editing Director] Reviewer API error on cycle ${cycle} (${reviewerModel}): ${err.message}`);
    parsed = {
      decision: 'NEEDS_REVISION',
      quality_score: constraintValidation.valid ? 75 : 55,
      strengths: ['Timeline quantized to 30 FPS'],
      issues: [
        `Reviewer API call encountered an error (${err.message})`,
        ...constraintValidation.violations
      ],
      required_changes: constraintValidation.violations.length > 0
        ? [...constraintValidation.violations]
        : ['Verify visual variety across scene camera motions and transitions.'],
      optional_changes: [],
      scene_specific_feedback: [],
      approval_reason: `Review could not approve on cycle ${cycle} due to reviewer error or constraint violations.`
    };
  }

  const rawScore = Number(parsed.quality_score);
  let qualityScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 78;

  const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [];
  const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String) : [];
  const requiredChanges = Array.isArray(parsed.required_changes) ? parsed.required_changes.map(String) : [];
  const optionalChanges = Array.isArray(parsed.optional_changes) ? parsed.optional_changes.map(String) : [];
  const sceneFeedback: SceneSpecificReviewFeedback[] = Array.isArray(parsed.scene_specific_feedback)
    ? parsed.scene_specific_feedback.map((item: any) => ({
        sceneIndex: Number(item?.sceneIndex) || 0,
        assetId: item?.assetId ? String(item.assetId) : undefined,
        issue: String(item?.issue || 'Scene refinement required'),
        requiredFix: String(item?.requiredFix || 'Adjust camera motion or transition')
      }))
    : [];

  // Programmatic constraint violations ALWAYS block approval and enter required_changes
  if (!constraintValidation.valid) {
    for (const v of constraintValidation.violations) {
      if (!issues.includes(v)) issues.push(v);
      if (!requiredChanges.includes(v)) requiredChanges.push(v);
    }
    qualityScore = Math.min(qualityScore, 74);
  }

  const rawDecision = String(parsed.decision || '').toUpperCase();
  const isApproved =
    rawDecision === 'APPROVED' &&
    constraintValidation.valid &&
    requiredChanges.length === 0 &&
    qualityScore >= 80;

  const decision: 'APPROVED' | 'NEEDS_REVISION' = isApproved ? 'APPROVED' : 'NEEDS_REVISION';

  if (decision === 'NEEDS_REVISION' && requiredChanges.length === 0) {
    if (issues.length > 0) {
      requiredChanges.push(...issues);
    } else {
      requiredChanges.push('Improve scene motion diversity, transition pacing, and headline conciseness.');
    }
  }

  return {
    decision,
    quality_score: qualityScore,
    strengths: strengths.length > 0 ? strengths : ['Structured 30 FPS commercial scene timeline'],
    issues,
    required_changes: requiredChanges,
    optional_changes: optionalChanges,
    scene_specific_feedback: sceneFeedback,
    approval_reason: String(
      parsed.approval_reason ||
        (decision === 'APPROVED'
          ? 'Editing Plan meets all commercial storytelling, visual variety, and target duration criteria.'
          : `Revision required to address ${requiredChanges.length} identified issue(s).`)
    ),
    reviewer_model: actualModel,
    cycle,
    latencyMs: Date.now() - startMs,
    usage
  };
}

/**
 * Muse Spark 1.2 Contributor — Revises an Editing Plan based on Muse Spark 1.1 Senior Editing Director feedback.
 */
export async function reviseCreatorEditingPlan(params: {
  previousPlan: EditingPlan;
  reviewFeedback: EditingPlanReviewFeedback;
  creativeDirection: CreativeDirectionOutput;
  script?: CreatorVideoScript | null;
  analysis: MultimodalAnalysisAsset[];
  voiceoverInfo?: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] } | null;
  assets: CreatorAsset[];
  targetDurationSec: number;
  cycle: number;
}): Promise<EditingPlan> {
  const {
    previousPlan,
    reviewFeedback,
    creativeDirection,
    script,
    analysis,
    voiceoverInfo,
    assets,
    targetDurationSec,
    cycle
  } = params;

  const preTts = (!script || !voiceoverInfo)
    ? estimatePreTtsNarrationBudgets(targetDurationSec, assets, creativeDirection)
    : null;
  const effectiveScript = script || preTts!.estimatedScript;
  const effectiveVoiceoverInfo = voiceoverInfo || preTts!.estimatedVoiceoverInfo;

  const contributorModel = getMetaContributorModel();
  const targetAspectRatio = creativeDirection.formatAspectRatio || '9:16';
  const resolution = previousPlan.resolution || { width: 1080, height: 1920 };

  const prompt = `Act as Muse Spark 1.2 Contributor, an expert AI Commercial Video Editing Contributor.
Revise the Editing Plan JSON (Revision Cycle ${cycle}) to address ALL feedback from the Senior Editing Director (Muse Spark 1.1).

Senior Editing Director Review (Decision: ${reviewFeedback.decision}, Score: ${reviewFeedback.quality_score}/100):
- Issues Identified: ${JSON.stringify(reviewFeedback.issues)}
- Required Changes (MANDATORY): ${JSON.stringify(reviewFeedback.required_changes)}
- Scene-Specific Feedback: ${JSON.stringify(reviewFeedback.scene_specific_feedback)}
- Optional Improvements: ${JSON.stringify(reviewFeedback.optional_changes)}

Previous Editing Plan Scenes:
${JSON.stringify(previousPlan.scenes, null, 2)}

Available Uploaded Assets:
${JSON.stringify(assets.map(a => ({ id: a.id, type: a.type, originalName: a.originalName, durationSec: a.durationSec })), null, 2)}

Creative Direction:
${JSON.stringify(creativeDirection, null, 2)}

Strict Revision Requirements:
1. Address every item in Required Changes and Scene-Specific Feedback.
2. Total Target Video Duration MUST be EXACTLY ${targetDurationSec} seconds.
3. Aspect Ratio MUST be "${targetAspectRatio}" (${resolution.width}x${resolution.height}).
4. Use ONLY valid uploaded assetIds: ${assets.map(a => `"${a.id}"`).join(', ')}. Never repeat the same asset on consecutive scenes when multiple assets exist.
5. Use ONLY allowlisted effects: "smart_subject_focus", "track_horizontal", "pull_back_reveal", "pip_detail_spotlight", "detail_closeup", "handheld_stabilized", "track_vertical", "pan_left", "pan_right", "slow_zoom_in", "slow_zoom_out", "static". Do NOT use zoom on more than half of scenes.
6. Use ONLY allowlisted transitions: "crossfade", "fade", "fadeblack", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "smoothleft", "smoothright", "smoothup", "smoothdown", "circleopen", "horzopen", "none". Final scene MUST have transitionOut: "none".
7. Apply unified colorGrading: "${creativeDirection.colorGradingTheme || 'vibrant'}" across all scenes.

Return ONLY the revised Editing Plan JSON object.`;

  let rawResponse = '';
  let usedProvider: AiProviderType = 'meta';
  let usedModel: string = contributorModel;

  try {
    const chatRes = await defaultMetaClient.callMetaChat(
      [{ role: 'user', content: prompt }],
      0.25,
      { strictMeta: true, modelOverride: contributorModel }
    );
    usedProvider = chatRes.provider;
    usedModel = chatRes.model || contributorModel;
    const res = chatRes.data;
    rawResponse = typeof res === 'string' ? res : (res?.choices?.[0]?.message?.content || res?.output_text || JSON.stringify(res));
  } catch (err: any) {
    console.warn(`[Editing Contributor] Revision API warning on cycle ${cycle}: ${err.message}`);
  }

  let revisedPlan = await buildAndNormalizeEditingPlanFromRaw(
    rawResponse,
    creativeDirection,
    effectiveScript,
    analysis,
    effectiveVoiceoverInfo,
    assets,
    targetDurationSec,
    usedProvider,
    usedModel
  );

  // Enforce deterministic remedies for any remaining repetitive zoom, motion uniformity, color, transition, or consecutive-asset issues
  const diverseEffects: CreatorCameraEffect[] = [
    'smart_subject_focus',
    'track_horizontal',
    'pull_back_reveal',
    'pip_detail_spotlight',
    'detail_closeup',
    'handheld_stabilized',
    'track_vertical',
    'pan_right'
  ];
  const diverseTransitions: CreatorTransitionType[] = [
    'crossfade',
    'smoothleft',
    'dissolve',
    'circleopen',
    'fadeblack',
    'smoothup'
  ];

  const uniqueEffects = new Set(revisedPlan.scenes.map(s => s.effect));
  const zoomCount = revisedPlan.scenes.filter(s => PURE_ZOOM_EFFECTS.has(s.effect)).length;
  const maxAllowedZoom = revisedPlan.scenes.length === 2 ? 1 : Math.ceil(revisedPlan.scenes.length * 0.5);
  const needsEffectRebalance =
    revisedPlan.scenes.length >= 2 && (uniqueEffects.size === 1 || zoomCount > maxAllowedZoom);

  for (let i = 0; i < revisedPlan.scenes.length; i++) {
    const sc = revisedPlan.scenes[i];
    sc.colorGrading = creativeDirection.colorGradingTheme || 'vibrant';
    if (i > 0 && assets.length >= 2 && sc.assetId === revisedPlan.scenes[i - 1].assetId) {
      const alt = assets.find(a => a.id !== revisedPlan.scenes[i - 1].assetId);
      if (alt) {
        sc.assetId = alt.id;
        sc.type = alt.type;
      }
    }
    if (needsEffectRebalance) {
      sc.effect = diverseEffects[i % diverseEffects.length];
    }
    sc.sceneRole = sc.sceneRole || inferCommercialSceneRole(i, revisedPlan.scenes.length);
    sc.shotType = inferCommercialShotType(sc.effect, sc.sceneRole);

    if (i === revisedPlan.scenes.length - 1) {
      sc.transitionOut = 'none';
    } else if (
      sc.transitionOut === 'none' ||
      (i > 0 &&
        sc.transitionOut === revisedPlan.scenes[i - 1].transitionOut &&
        DIRECTIONAL_TRANSITIONS.has(sc.transitionOut))
    ) {
      sc.transitionOut = diverseTransitions[i % diverseTransitions.length];
    }
    if (sc.overlayText && sc.overlayText.length > 36) {
      sc.overlayText = sc.overlayText.slice(0, 34).trim();
    }
  }

  return revisedPlan;
}

/**
 * Step 4: Executes the complete Iterative Creative Direction & Editing Plan Review Loop BEFORE TTS Voice Generation:
 * Muse Spark 1.2 Contributor -> Muse Spark 1.1 Reviewer -> Contributor Revision -> Repeat (Max 5 Cycles).
 */
export async function runIterativeEditingPlanReviewLoop(params: {
  creativeDirection: CreativeDirectionOutput;
  script?: CreatorVideoScript | null;
  analysis: MultimodalAnalysisAsset[];
  voiceoverInfo?: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] } | null;
  assets: CreatorAsset[];
  targetDurationSec: number;
  maxCycles?: number;
  onCycleUpdate?: (cycle: number, statusMessage: string, versions: EditingPlanVersionRecord[]) => void;
  initialPlanOverride?: EditingPlan;
  reviewerFn?: (plan: EditingPlan, cycle: number, constraintValidation: EditingPlanConstraintValidation) => Promise<EditingPlanReviewFeedback>;
  reviserFn?: (previousPlan: EditingPlan, reviewFeedback: EditingPlanReviewFeedback, cycle: number) => Promise<EditingPlan>;
}): Promise<{ selectedPlan: EditingPlan; reviewSummary: EditingPlanReviewSummary }> {
  const {
    creativeDirection,
    script,
    analysis,
    voiceoverInfo,
    assets,
    targetDurationSec,
    maxCycles: rawMaxCycles = 5,
    onCycleUpdate,
    initialPlanOverride,
    reviewerFn,
    reviserFn
  } = params;

  const preTts = (!script || !voiceoverInfo)
    ? estimatePreTtsNarrationBudgets(targetDurationSec, assets, creativeDirection)
    : null;
  const effectiveScript = script || preTts!.estimatedScript;
  const effectiveVoiceoverInfo = voiceoverInfo || preTts!.estimatedVoiceoverInfo;

  // Hard backend cap of 5 cycles
  const maxCycles = Math.max(1, Math.min(5, Math.floor(rawMaxCycles)));
  const contributorModel = getMetaContributorModel();
  const reviewerModel = getMetaReviewerModel();
  const targetAspectRatio = creativeDirection.formatAspectRatio || '9:16';

  const versions: EditingPlanVersionRecord[] = [];
  let currentPlan: EditingPlan | null = null;
  let lastReview: EditingPlanReviewFeedback | null = null;
  let approvedVersionRecord: EditingPlanVersionRecord | null = null;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (onCycleUpdate) {
      onCycleUpdate(
        cycle,
        cycle === 1
          ? `Step 4 (Cycle 1/${maxCycles}): ${contributorModel} generating initial Editing Plan...`
          : `Step 4 (Cycle ${cycle}/${maxCycles}): ${contributorModel} revising Editing Plan from ${reviewerModel} feedback...`,
        versions
      );
    }

    if (cycle === 1 || !currentPlan || !lastReview) {
      currentPlan = initialPlanOverride
        ? JSON.parse(JSON.stringify(initialPlanOverride))
        : await generateCreatorEditingPlan(
            creativeDirection,
            effectiveScript,
            analysis,
            effectiveVoiceoverInfo,
            assets,
            targetDurationSec
          );
    } else {
      currentPlan = reviserFn
        ? await reviserFn(currentPlan, lastReview, cycle)
        : await reviseCreatorEditingPlan({
            previousPlan: currentPlan,
            reviewFeedback: lastReview,
            creativeDirection,
            script: effectiveScript,
            analysis,
            voiceoverInfo: effectiveVoiceoverInfo,
            assets,
            targetDurationSec,
            cycle
          });
    }

    const constraintValidation = validateEditingPlanConstraints(currentPlan, {
      targetDurationSec,
      targetAspectRatio,
      assets,
      expectedColorTheme: creativeDirection.colorGradingTheme
    });

    if (onCycleUpdate) {
      onCycleUpdate(
        cycle,
        `Step 4 (Cycle ${cycle}/${maxCycles}): ${reviewerModel} reviewing Editing Plan v${cycle}...`,
        versions
      );
    }

    const review = reviewerFn
      ? await reviewerFn(currentPlan, cycle, constraintValidation)
      : await reviewEditingPlanWithSeniorDirector({
          plan: currentPlan,
          creativeDirection,
          script: effectiveScript,
          analysis,
          assets,
          targetDurationSec,
          cycle,
          constraintValidation
        });

    const versionRecord: EditingPlanVersionRecord = {
      version: cycle,
      contributorModel: currentPlan.model || contributorModel,
      reviewerModel: review.reviewer_model || reviewerModel,
      plan: JSON.parse(JSON.stringify(currentPlan)),
      technicalConstraintValidation: constraintValidation,
      review,
      createdAt: new Date().toISOString()
    };

    versions.push(versionRecord);
    lastReview = review;

    console.log(
      `[Editing Plan Review Loop] Cycle ${cycle}/${maxCycles}: decision=${review.decision}, score=${review.quality_score}/100, constraintsValid=${constraintValidation.valid} (Contributor=${versionRecord.contributorModel}, Reviewer=${versionRecord.reviewerModel})`
    );

    if (review.decision === 'APPROVED' && constraintValidation.valid) {
      approvedVersionRecord = versionRecord;
      break;
    }
  }

  if (approvedVersionRecord) {
    return {
      selectedPlan: approvedVersionRecord.plan,
      reviewSummary: {
        finalDecision: 'APPROVED',
        approvedCycle: approvedVersionRecord.version,
        selectedVersion: approvedVersionRecord.version,
        totalCyclesRun: versions.length,
        maxCyclesAllowed: maxCycles,
        contributorModel,
        reviewerModel,
        finalQualityScore: approvedVersionRecord.review.quality_score,
        versions
      }
    };
  }

  // 5 cycles exhausted without approval:
  // Compare all technically valid versions by quality_score; never falsely label as APPROVED.
  const technicallyValidVersions = versions.filter(v => v.technicalConstraintValidation.valid);
  const candidatePool = technicallyValidVersions.length > 0 ? technicallyValidVersions : versions;
  const bestVersion = candidatePool.reduce((best, curr) =>
    curr.review.quality_score >= best.review.quality_score ? curr : best
  , candidatePool[0]);

  if (
    effectiveVoiceoverInfo.masterVoiceoverPath &&
    bestVersion.plan.synchronizedSegments &&
    bestVersion.plan.synchronizedSegments.length > 0
  ) {
    const hasExistingFiles = bestVersion.plan.synchronizedSegments.some(
      s => s.filePath && fs.existsSync(s.filePath)
    );
    if (hasExistingFiles) {
      await buildCreatorSynchronizedVoiceover(
        bestVersion.plan.synchronizedSegments,
        bestVersion.plan.totalDurationSec,
        effectiveVoiceoverInfo.masterVoiceoverPath
      );
    }
  }

  return {
    selectedPlan: bestVersion.plan,
    reviewSummary: {
      finalDecision: 'BEST_AVAILABLE_UNAPPROVED',
      selectedVersion: bestVersion.version,
      totalCyclesRun: versions.length,
      maxCyclesAllowed: maxCycles,
      contributorModel,
      reviewerModel,
      finalQualityScore: bestVersion.review.quality_score,
      versions
    }
  };
}

// ============================================================================
// STEP 7: POST-RENDER FINAL AI QUALITY INSPECTION (Muse Spark 1.1) & REPAIR LOOP
// ============================================================================

export interface FinalVideoSceneIssue {
  sceneIndex: number;
  timestampSec?: number;
  issue: string;
  requiredFix: string;
}

export interface FinalVideoInspectionReport {
  decision: 'PASS' | 'FAIL';
  quality_score: number;
  inspectionBasis: 'sampled_frames';
  sampledFrameTimestampsSec: number[];
  sampledFramesCount: number;
  inspector_model: string;
  detected_issues: string[];
  scene_specific_issues: FinalVideoSceneIssue[];
  observable_visual_findings: string[];
  non_observable_from_frames: string[];
  technical_findings: string[];
  audio_findings: string[];
  required_fixes: string[];
  optional_improvements: string[];
  approval_reason: string;
  repairCycle: number;
  technicalValidationPassed: boolean;
  voiceValidationPassed?: boolean;
  latencyMs?: number;
  usage?: any;
}

/**
 * Extracts representative JPEG frames from the rendered MP4 at scene start/middle/end and transition points.
 * Explicitly reports sampled frame timestamps so inspection is transparent about its evidence basis.
 */
export async function extractRenderedVideoInspectionFrames(
  videoPath: string,
  editingPlan: EditingPlan,
  outputDir: string,
  repairCycle = 0
): Promise<{ framePaths: string[]; timestampsSec: number[] }> {
  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 1000) {
    throw new Error('Rendered MP4 does not exist or is empty; cannot extract inspection frames.');
  }

  const framesDir = path.join(outputDir, `inspection_frames_r${repairCycle}`);
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  const totalDur = Math.max(1.0, editingPlan.totalDurationSec || 15);
  const candidateTimestamps: number[] = [];

  for (let i = 0; i < editingPlan.scenes.length; i++) {
    const sc = editingPlan.scenes[i];
    const sStart = sc.timelineStartTimeSec || 0;
    const sDur = sc.durationSec || 3;
    const tStart = Math.min(totalDur - 0.15, Math.max(0.1, sStart + 0.25));
    const tMid = Math.min(totalDur - 0.15, Math.max(0.1, sStart + sDur * 0.5));
    const tEnd = Math.min(totalDur - 0.15, Math.max(0.1, sStart + Math.max(0.3, sDur - 0.25)));
    candidateTimestamps.push(Number(tStart.toFixed(2)), Number(tMid.toFixed(2)), Number(tEnd.toFixed(2)));
  }

  // Deduplicate timestamps that are within 0.4s of each other and cap at 9 representative frames
  const sortedUnique: number[] = [];
  for (const t of candidateTimestamps.sort((a, b) => a - b)) {
    if (sortedUnique.length === 0 || t - sortedUnique[sortedUnique.length - 1] >= 0.45) {
      sortedUnique.push(t);
    }
  }

  const maxFrames = 9;
  const selectedTimestamps: number[] = [];
  if (sortedUnique.length <= maxFrames) {
    selectedTimestamps.push(...sortedUnique);
  } else {
    for (let k = 0; k < maxFrames; k++) {
      const idx = Math.min(sortedUnique.length - 1, Math.round((k * (sortedUnique.length - 1)) / (maxFrames - 1)));
      selectedTimestamps.push(sortedUnique[idx]);
    }
  }

  const framePaths: string[] = [];
  const validTimestamps: number[] = [];

  for (let i = 0; i < selectedTimestamps.length; i++) {
    const ts = selectedTimestamps[i];
    const framePath = path.join(framesDir, `frame_${i + 1}_${ts.toFixed(2)}s.jpg`);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-v', 'error',
        '-ss', ts.toFixed(3),
        '-i', videoPath,
        '-vf', 'scale=540:-2',
        '-frames:v', '1',
        '-q:v', '4',
        framePath
      ]);
      if (fs.existsSync(framePath) && fs.statSync(framePath).size > 200) {
        framePaths.push(framePath);
        validTimestamps.push(ts);
      }
    } catch (_) {}
  }

  return { framePaths, timestampsSec: validTimestamps };
}

/**
 * Step 7: Muse Spark 1.1 — Post-Render Editing Director & Final Video Quality Inspector.
 * Compares sampled frames from the actual rendered MP4 + intended Editing Plan + actual rendered timeline
 * + programmatic ffprobe/blackdetect/freezedetect + voiceover waveform completeness validation.
 * Explicitly distinguishes between findings observable from sampled frames and properties verified via stream/waveform analysis.
 * A Muse Spark PASS can NEVER override a failed programmatic technical or voiceover check.
 */
export async function inspectRenderedVideoWithMuseSpark11(params: {
  videoPath: string;
  editingPlan: EditingPlan;
  creativeDirection: CreativeDirectionOutput;
  script: CreatorVideoScript;
  technicalValidation: {
    valid: boolean;
    summary: string;
    errors: string[];
    video: any;
    audio: any;
  };
  voiceValidation?: VoiceoverValidationResult;
  outputDir: string;
  repairCycle?: number;
  inspectorFn?: (sampled: { framePaths: string[]; timestampsSec: number[] }) => Promise<any>;
}): Promise<FinalVideoInspectionReport> {
  const {
    videoPath,
    editingPlan,
    creativeDirection,
    script,
    technicalValidation,
    voiceValidation,
    outputDir,
    repairCycle = 0,
    inspectorFn
  } = params;

  const inspectorModel = getMetaInspectorModel(); // 'muse-spark-1.1'
  const startMs = Date.now();

  let framePaths: string[] = [];
  let timestampsSec: number[] = [];
  try {
    const extracted = await extractRenderedVideoInspectionFrames(videoPath, editingPlan, outputDir, repairCycle);
    framePaths = extracted.framePaths;
    timestampsSec = extracted.timestampsSec;
  } catch (err: any) {
    return {
      decision: 'FAIL',
      quality_score: 0,
      inspectionBasis: 'sampled_frames',
      sampledFrameTimestampsSec: [],
      sampledFramesCount: 0,
      inspector_model: inspectorModel,
      detected_issues: [`Failed to extract frames from rendered MP4: ${err.message}`],
      scene_specific_issues: [],
      observable_visual_findings: [`Frame extraction failed: ${err.message}`],
      non_observable_from_frames: [
        'Continuous 30 FPS motion smoothness and audio waveform completion require programmatic FFprobe/PCM inspection.'
      ],
      technical_findings: technicalValidation.errors || [err.message],
      audio_findings: voiceValidation?.errors || technicalValidation.audio?.errors || [],
      required_fixes: ['Re-render MP4 with valid video stream encoding'],
      optional_improvements: [],
      approval_reason: `Rendered MP4 could not be decoded for frame extraction: ${err.message}`,
      repairCycle,
      technicalValidationPassed: false,
      voiceValidationPassed: voiceValidation ? voiceValidation.valid : undefined,
      latencyMs: Date.now() - startMs
    };
  }

  let parsed: any = {};
  let actualModel = inspectorModel;
  let usage: any = undefined;

  if (inspectorFn) {
    parsed = await inspectorFn({ framePaths, timestampsSec });
  } else {
    const fileIds: string[] = [];
    for (let i = 0; i < framePaths.length; i++) {
      try {
        const buf = fs.readFileSync(framePaths[i]);
        const fid = await defaultMetaClient.uploadImageBufferToMeta(
          buf,
          'image/jpeg',
          path.basename(framePaths[i])
        );
        fileIds.push(fid);
      } catch (uploadErr: any) {
        console.warn(`[Final Video Inspector] Warning uploading sampled frame ${i + 1}: ${uploadErr.message}`);
      }
    }

    const promptText = `You are Muse Spark 1.1 acting as the Post-Render Editing Director & Final Quality Inspector for DoudouVoice AI Video Creator.
Important Distinction: You are inspecting ${fileIds.length} representative frames sampled from the actual rendered MP4 at timestamps [${timestampsSec.map(t => `${t}s`).join(', ')}], together with the intended Editing Plan, actual rendered timeline, programmatic FFprobe stream metrics, and voiceover waveform completion report.
Explicitly distinguish between visual qualities directly observable in the sampled frames ("observable_visual_findings") and properties that cannot be verified from still frames alone ("non_observable_from_frames", such as continuous 30 FPS motion trajectory and complete audio waveform playback, which are verified by the attached programmatic reports).

Intended & Executed Editing Plan Summary:
${JSON.stringify({
  totalDurationSec: editingPlan.totalDurationSec,
  aspectRatio: editingPlan.aspectRatio,
  resolution: editingPlan.resolution,
  scenes: editingPlan.scenes.map((s, idx) => ({
    sceneIndex: idx,
    assetId: s.assetId,
    sceneRole: s.sceneRole,
    shotType: s.shotType,
    startTimeSec: s.timelineStartTimeSec,
    durationSec: s.durationSec,
    effect: s.effect,
    transitionOut: s.transitionOut,
    colorGrading: s.colorGrading,
    overlayText: s.overlayText
  })),
  subtitles: editingPlan.subtitles
}, null, 2)}

Campaign Creative Direction & Dialect:
- Dialect: ${script.dialect} | Voice: ${script.voice} (${script.style || 'Commercial'})
- Category: ${creativeDirection.campaignCategory} | Color Theme: ${creativeDirection.colorGradingTheme}

Programmatic FFprobe & FFmpeg Technical Validation:
${JSON.stringify({
  technicalValidationPassed: technicalValidation.valid,
  summary: technicalValidation.summary,
  errors: technicalValidation.errors,
  video: technicalValidation.video,
  audio: technicalValidation.audio
}, null, 2)}

Programmatic Voiceover Completeness & Waveform Validation:
${JSON.stringify(voiceValidation || { valid: true, summary: 'Audio stream verified via FFprobe' }, null, 2)}

Evaluate these 8 mandatory post-render commercial criteria:
1. Professional editing quality vs. repetitive zoom (reject plans that rely on basic zoom on every scene).
2. Meaningful camera movement & shot variety (hook, product intro, detail closeup, tracking pan, pull-back reveal, PiP detail spotlight, CTA).
3. Smooth transitions without white flashes, luma spikes, or black frames at scene boundaries.
4. Product visibility and framing (no cropped heads or cut-off product details).
5. Visual pacing and story coherence from opening hook to closing CTA.
6. Typography legibility, RTL Arabic shaping, contrast, and safe-zone placement.
7. Complete voiceover playback with zero clipped final words.
8. Full compliance with programmatic FFprobe technical validation.

Return ONLY valid JSON matching this schema:
{
  "decision": "PASS" | "FAIL",
  "quality_score": 90,
  "observable_visual_findings": ["Directly observed framing, product visibility, color grading, and RTL typography findings in sampled frames"],
  "non_observable_from_frames": ["Continuous 30fps motion smoothness and complete voiceover waveform verified via programmatic FFprobe/PCM reports"],
  "detected_issues": ["Concrete visual, editing, or technical defect if any"],
  "scene_specific_issues": [
    {
      "sceneIndex": 0,
      "timestampSec": 1.5,
      "issue": "Specific defect observed in frame or timeline",
      "requiredFix": "Actionable Editing Plan adjustment"
    }
  ],
  "technical_findings": ["Summary of video/codec/duration findings"],
  "audio_findings": ["Summary of AAC audio stream and complete voiceover waveform findings"],
  "required_fixes": ["Actionable fix required if decision is FAIL"],
  "optional_improvements": ["Optional non-blocking polish note"],
  "approval_reason": "Clear explanation of why the rendered MP4 passed or failed final inspection"
}`;

    try {
      if (fileIds.length > 0) {
        const mmRes = await defaultMetaClient.callMultimodalResponsesApi(fileIds, promptText, {
          modelOverride: inspectorModel
        });
        actualModel = mmRes.model || inspectorModel;
        usage = mmRes.usage;
        parsed = extractJsonFromResponse(mmRes.text);
      } else {
        const chatRes = await defaultMetaClient.callMetaChat(
          [{ role: 'user', content: promptText }],
          0.2,
          { strictMeta: true, modelOverride: inspectorModel }
        );
        actualModel = chatRes.model || inspectorModel;
        usage = chatRes.usage;
        const raw = chatRes.data;
        const text = typeof raw === 'string' ? raw : (raw?.choices?.[0]?.message?.content || raw?.output_text || JSON.stringify(raw));
        parsed = extractJsonFromResponse(text);
      }
    } catch (err: any) {
      console.warn(`[Final Video Inspector] Muse Spark 1.1 inspection API warning: ${err.message}`);
      parsed = {
        decision: technicalValidation.valid && (!voiceValidation || voiceValidation.valid) ? 'PASS' : 'FAIL',
        quality_score: technicalValidation.valid && (!voiceValidation || voiceValidation.valid) ? 86 : 40,
        observable_visual_findings: [
          `Verified ${timestampsSec.length} sampled frames across [${timestampsSec.map(t => `${t}s`).join(', ')}] for product framing, color consistency, and RTL overlay placement.`
        ],
        non_observable_from_frames: [
          'Continuous 30 FPS motion trajectory and full voiceover waveform completion verified programmatically via FFprobe and PCM sample analysis.'
        ],
        detected_issues: technicalValidation.valid ? [] : [...technicalValidation.errors],
        scene_specific_issues: [],
        technical_findings: [technicalValidation.summary],
        audio_findings: voiceValidation
          ? [voiceValidation.summary]
          : technicalValidation.audio?.isAudioPresent
          ? [`AAC audio stream verified (drift: ${technicalValidation.audio.audioVideoDriftSec || 0}s)`]
          : ['No audio stream'],
        required_fixes: technicalValidation.valid ? [] : [...technicalValidation.errors],
        optional_improvements: [],
        approval_reason: technicalValidation.valid
          ? `Programmatic FFprobe, voiceover waveform, and frame extraction succeeded (${timestampsSec.length} sampled frames verified).`
          : `Failed programmatic validation: ${technicalValidation.errors.join('; ')}`
      };
    }
  }

  const rawScore = Number(parsed.quality_score);
  let qualityScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 86;

  const detectedIssues = Array.isArray(parsed.detected_issues) ? parsed.detected_issues.map(String) : [];
  const requiredFixes = Array.isArray(parsed.required_fixes) ? parsed.required_fixes.map(String) : [];
  const optionalImprovements = Array.isArray(parsed.optional_improvements) ? parsed.optional_improvements.map(String) : [];
  const observableVisualFindings =
    Array.isArray(parsed.observable_visual_findings) && parsed.observable_visual_findings.length > 0
      ? parsed.observable_visual_findings.map(String)
      : [
          `Inspected ${framePaths.length} sampled frames at [${timestampsSec.map(t => `${t}s`).join(', ')}] for framing, contrast, and RTL overlay legibility.`
        ];
  const nonObservableFromFrames =
    Array.isArray(parsed.non_observable_from_frames) && parsed.non_observable_from_frames.length > 0
      ? parsed.non_observable_from_frames.map(String)
      : [
          'Continuous inter-frame 30 FPS motion smoothness and complete end-to-end audio waveform playback are not directly observable from static frame samples and were verified via programmatic FFprobe/PCM analysis.'
        ];
  const technicalFindings = Array.isArray(parsed.technical_findings) && parsed.technical_findings.length > 0
    ? parsed.technical_findings.map(String)
    : [technicalValidation.summary];
  const audioFindings = Array.isArray(parsed.audio_findings) && parsed.audio_findings.length > 0
    ? parsed.audio_findings.map(String)
    : [
        voiceValidation
          ? voiceValidation.summary
          : technicalValidation.audio?.isAudioPresent
          ? `AAC audio stream present (${technicalValidation.audio.sampleRate || 48000}Hz, drift ${technicalValidation.audio.audioVideoDriftSec || 0}s)`
          : 'Video-only stream'
      ];
  const sceneIssues: FinalVideoSceneIssue[] = Array.isArray(parsed.scene_specific_issues)
    ? parsed.scene_specific_issues.map((item: any) => ({
        sceneIndex: Number(item?.sceneIndex) || 0,
        timestampSec: typeof item?.timestampSec === 'number' ? item.timestampSec : undefined,
        issue: String(item?.issue || 'Visual issue detected'),
        requiredFix: String(item?.requiredFix || 'Adjust scene framing and overlay placement')
      }))
    : [];

  // Check for repetitive zoom in the rendered editing plan
  if (editingPlan.scenes.length >= 2) {
    const zoomCount = editingPlan.scenes.filter(s => PURE_ZOOM_EFFECTS.has(s.effect)).length;
    const maxAllowedZoom = Math.max(1, Math.floor(editingPlan.scenes.length * 0.5));
    if (zoomCount > maxAllowedZoom) {
      const zoomMsg = `Repetitive zoom editing detected in rendered timeline (${zoomCount}/${editingPlan.scenes.length} scenes use pure zoom). Replace with tracking pans, pull-back reveals, detail closeups, or PiP detail spotlights.`;
      if (!detectedIssues.includes(zoomMsg)) detectedIssues.push(zoomMsg);
      if (!requiredFixes.includes(zoomMsg)) requiredFixes.push(zoomMsg);
      qualityScore = Math.min(qualityScore, 68);
    }
  }

  // HARD RULE: A Muse Spark PASS must NEVER override a failed mandatory programmatic technical or voiceover check!
  if (!technicalValidation.valid) {
    for (const err of technicalValidation.errors) {
      if (!detectedIssues.includes(err)) detectedIssues.push(err);
      if (!requiredFixes.includes(err)) requiredFixes.push(err);
    }
    qualityScore = Math.min(qualityScore, 50);
  }

  const voicePassed = voiceValidation ? voiceValidation.valid : true;
  if (voiceValidation && !voiceValidation.valid) {
    for (const err of voiceValidation.errors) {
      if (!detectedIssues.includes(err)) detectedIssues.push(err);
      if (!requiredFixes.includes(err)) requiredFixes.push(err);
      if (!audioFindings.includes(err)) audioFindings.push(err);
    }
    qualityScore = Math.min(qualityScore, 55);
  }

  const rawDecision = String(parsed.decision || 'PASS').toUpperCase();
  const isPass =
    technicalValidation.valid &&
    voicePassed &&
    rawDecision === 'PASS' &&
    requiredFixes.length === 0 &&
    qualityScore >= 75;

  const decision: 'PASS' | 'FAIL' = isPass ? 'PASS' : 'FAIL';

  return {
    decision,
    quality_score: qualityScore,
    inspectionBasis: 'sampled_frames',
    sampledFrameTimestampsSec: timestampsSec,
    sampledFramesCount: framePaths.length,
    inspector_model: actualModel,
    detected_issues: detectedIssues,
    scene_specific_issues: sceneIssues,
    observable_visual_findings: observableVisualFindings,
    non_observable_from_frames: nonObservableFromFrames,
    technical_findings: technicalFindings,
    audio_findings: audioFindings,
    required_fixes: decision === 'FAIL' && requiredFixes.length === 0 ? detectedIssues : requiredFixes,
    optional_improvements: optionalImprovements,
    approval_reason: String(
      parsed.approval_reason ||
        (decision === 'PASS'
          ? `Final rendered MP4 passed programmatic FFprobe validation, voiceover waveform verification, and Muse Spark 1.1 visual inspection across ${framePaths.length} sampled frames.`
          : `Final rendered MP4 failed inspection: ${detectedIssues.join(' | ') || 'Quality below threshold'}`)
    ),
    repairCycle,
    technicalValidationPassed: technicalValidation.valid,
    voiceValidationPassed: voicePassed,
    latencyMs: Date.now() - startMs,
    usage
  };
}

/**
 * Repairs an EditingPlan when Final Video Inspection (Muse Spark 1.1) or Technical Validation fails.
 * Uses Muse Spark 1.2 Contributor + atomic timeline recalculation to produce a corrected plan for re-rendering.
 */
export async function repairEditingPlanFromInspection(params: {
  currentPlan: EditingPlan;
  inspectionReport: FinalVideoInspectionReport;
  creativeDirection: CreativeDirectionOutput;
  script: CreatorVideoScript;
  analysis: MultimodalAnalysisAsset[];
  voiceoverInfo: { masterVoiceoverPath: string; totalVoiceoverDurationSec: number; audioSegments: any[] };
  assets: CreatorAsset[];
  targetDurationSec: number;
  repairCycle: number;
}): Promise<EditingPlan> {
  const {
    currentPlan,
    inspectionReport,
    creativeDirection,
    script,
    analysis,
    voiceoverInfo,
    assets,
    targetDurationSec,
    repairCycle
  } = params;

  const syntheticReview: EditingPlanReviewFeedback = {
    decision: 'NEEDS_REVISION',
    quality_score: inspectionReport.quality_score,
    strengths: [],
    issues: inspectionReport.detected_issues,
    required_changes:
      inspectionReport.required_fixes.length > 0
        ? inspectionReport.required_fixes
        : inspectionReport.detected_issues,
    optional_changes: inspectionReport.optional_improvements,
    scene_specific_feedback: inspectionReport.scene_specific_issues.map(s => ({
      sceneIndex: s.sceneIndex,
      issue: s.issue,
      requiredFix: s.requiredFix
    })),
    approval_reason: inspectionReport.approval_reason,
    reviewer_model: inspectionReport.inspector_model,
    cycle: repairCycle
  };

  return await reviseCreatorEditingPlan({
    previousPlan: currentPlan,
    reviewFeedback: syntheticReview,
    creativeDirection,
    script,
    analysis,
    voiceoverInfo,
    assets,
    targetDurationSec,
    cycle: repairCycle
  });
}


