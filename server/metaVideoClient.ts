import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import { AiProviderType, MetaChatResponse } from './metaClient.js';
import { getMetaModel, getMetaImageModel, isMetaStrict, GEMINI_FALLBACK_MODEL } from './metaConfig.js';
import { ExtractedFrame } from './videoService.js';

export interface SceneAnalysis {
  id: string;
  startTimeSec: number;
  endTimeSec: number;
  description: string;
  visualText?: string;
  productsDetected?: string[];
  cameraMotion?: string;
  hookPotential: 'high' | 'medium' | 'low';
}

export interface VideoUnderstandingResult {
  success: boolean;
  provider?: AiProviderType;
  model: string;
  durationSec: number;
  scenes: SceneAnalysis[];
  summary: string;
  detectedVisualTags: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface VoiceoverSegment {
  id: string;
  sceneId?: string;
  startTimeSec: number;
  endTimeSec: number;
  text: string;
  dialect: string;
  voice: string;
  emotion?: string;
  pace?: string;
  audioUrl?: string;
}

export interface DubbingGenerationResult {
  success: boolean;
  provider?: AiProviderType;
  model: string;
  segments: VoiceoverSegment[];
  suggestedTtsSettings: {
    style: string;
    emotion: string;
    pace: string;
  };
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface VideoLocalizationResult {
  success: boolean;
  provider?: AiProviderType;
  model?: string;
  originalTranscript: Array<{ startTimeSec: number; endTimeSec: number; speaker?: string; text: string }>;
  localizedSegments: VoiceoverSegment[];
  error?: string;
}

function extractJson(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {}

  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (_) {}
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  return {};
}

export class MetaVideoClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor() {
    this.baseUrl = (process.env.META_API_URL || process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
    this.timeoutMs = 45000;
  }

  private get apiKey(): string {
    return process.env.META_API_KEY || '';
  }

  private get model(): string {
    return getMetaModel();
  }

  private get imageModel(): string {
    return getMetaImageModel();
  }

  /**
   * Helper to call Meta Model API (POST /chat/completions) with timeout and honest provider reporting.
   */
  async callMetaChat(messages: Array<{ role: string; content: string }>, temperature = 0.4): Promise<MetaChatResponse> {
    if (this.apiKey) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature
          }),
          signal: controller.signal
        });

        const contentType = res.headers.get('content-type') || '';
        let data: any = null;
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const text = await res.text();
          throw new Error(`Meta API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
        }

        if (!res.ok) {
          throw new Error(`Meta API error (${res.status}): ${data?.error?.message || data?.error || JSON.stringify(data)}`);
        }

        return {
          data,
          provider: 'meta',
          model: this.model
        };
      } catch (metaErr: any) {
        if (isMetaStrict()) {
          throw new Error(`META_STRICT is enabled: Meta API failed (${metaErr.message}) and Gemini fallback is disabled.`);
        }
        console.warn(`[MetaVideo] Meta API call failed (${metaErr.message}), falling back to Gemini...`);
      } finally {
        clearTimeout(timer);
      }
    } else if (isMetaStrict()) {
      throw new Error('META_STRICT is enabled and META_API_KEY is not configured. Gemini fallback is disabled.');
    }

    const geminiKey = process.env.gemini_api_key1 || process.env.gemini_api_key2 || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error('Neither META_API_KEY nor GEMINI_API_KEY is configured.');
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userPrompt = messages.filter(m => m.role !== 'system').map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');

    const response = await ai.models.generateContent({
      model: GEMINI_FALLBACK_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemMsg || undefined,
        temperature
      }
    });

    const text = response.text || '{}';
    return {
      data: {
        choices: [{ message: { content: text } }],
        output_text: text,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount || 0
        }
      },
      provider: 'gemini-fallback',
      model: GEMINI_FALLBACK_MODEL
    };
  }

  /**
   * Mode A: Analyzes extracted video frames using Meta Muse Spark multimodal intelligence.
   * Uploads sampled keyframes to Meta Files API and prompts the model to decompose the video
   * into structured time-coded scenes, detecting products, visual text, and hook potential.
   */
  async analyzeVideoScenes(params: {
    frames: ExtractedFrame[];
    durationSec: number;
    userContext?: string;
  }): Promise<VideoUnderstandingResult> {
    const { frames, durationSec, userContext } = params;

    if (frames.length === 0) {
      return {
        success: false,
        provider: 'meta',
        model: this.imageModel,
        durationSec,
        scenes: [],
        summary: 'No video frames were extracted.',
        detectedVisualTags: [],
        error: 'No frames available for analysis'
      };
    }

    const selectedFrames: ExtractedFrame[] = [];
    if (frames.length <= 4) {
      selectedFrames.push(...frames);
    } else {
      const step = (frames.length - 1) / 3;
      selectedFrames.push(
        frames[0],
        frames[Math.round(step)],
        frames[Math.round(step * 2)],
        frames[frames.length - 1]
      );
    }

    console.log(`[MetaVideo] Analyzing video (${durationSec}s) with ${selectedFrames.length} sampled keyframes...`);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usedProvider: AiProviderType = 'meta';
    let usedModel: string = this.imageModel;

    try {
      const fileIds: string[] = [];
      if (this.apiKey) {
        for (const frame of selectedFrames) {
          try {
            const buffer = await fs.promises.readFile(frame.filePath);
            const formData = new FormData();
            formData.append('file', new Blob([buffer], { type: 'image/jpeg' }), frame.filename);
            formData.append('purpose', 'user_data');

            const res = await fetch(`${this.baseUrl}/files`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${this.apiKey}` },
              body: formData
            });

            if (res.ok) {
              const data = await res.json();
              const fid = data?.id || data?.file_id;
              if (fid) fileIds.push(fid);
            }
          } catch (e) {
            console.warn('[MetaVideo] Frame upload warning:', e);
          }
        }
      }

      const promptInstructions = `You are an elite video advertising intelligence analyst.
Analyze the provided sequence of video frames from a product video (total duration: ${Math.round(durationSec)}s).
${userContext ? `User context: "${userContext}"` : ''}

Decompose the video into distinct chronological scenes from 0s to ${Math.round(durationSec)}s.
For each scene:
1. Provide accurate start and end seconds.
2. Describe what happens visually, what products or actions appear.
3. Transcribe any on-screen text or logos (OCR).
4. Identify if this scene is an ideal advertising hook (high, medium, or low hook potential).

Respond ONLY with valid JSON in this exact structure:
{
  "summary": "Brief 1-2 sentence overview of the video content",
  "detectedVisualTags": ["tag1", "tag2", "tag3"],
  "scenes": [
    {
      "id": "scene-1",
      "startTimeSec": 0,
      "endTimeSec": 4,
      "description": "Visual description of what happens in scene 1",
      "visualText": "Any on-screen text detected or empty string",
      "productsDetected": ["Product Name", "Detail"],
      "cameraMotion": "Static close-up / Pan / Zoom",
      "hookPotential": "high"
    }
  ]
}`;

      let jsonContent = '';

      if (this.apiKey && fileIds.length > 0) {
        const inputContent: any[] = fileIds.map(fid => ({
          type: 'input_image',
          file_id: fid
        }));
        inputContent.push({
          type: 'input_text',
          text: promptInstructions
        });

        const res = await fetch(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.imageModel,
            input: [{ role: 'user', content: inputContent }]
          })
        });

        if (res.ok) {
          const data = await res.json();
          totalInputTokens += data?.usage?.input_tokens || 0;
          totalOutputTokens += data?.usage?.output_tokens || 0;

          const messagePart = data.output?.find((o: any) => o.type === 'message')?.content?.find((c: any) => c.type === 'output_text');
          jsonContent = messagePart?.text || '';
          usedProvider = 'meta';
          usedModel = this.imageModel;
          console.log(`[MetaVideo] Meta Responses API success. Tokens: in=${totalInputTokens}, out=${totalOutputTokens}`);
        }
      }

      if (!jsonContent) {
        if (isMetaStrict()) {
          throw new Error('META_STRICT is enabled: Meta Vision analysis failed or META_API_KEY is missing, and Gemini fallback is disabled.');
        }

        console.log('[MetaVideo] Calling Gemini Vision fallback for video scene analysis...');
        const geminiKey = process.env.gemini_api_key1 || process.env.gemini_api_key2 || process.env.GEMINI_API_KEY;
        if (!geminiKey) throw new Error('No AI API key available for video analysis.');

        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const parts: any[] = [];

        for (const frame of selectedFrames) {
          const buffer = await fs.promises.readFile(frame.filePath);
          parts.push({
            inlineData: {
              data: buffer.toString('base64'),
              mimeType: 'image/jpeg'
            }
          });
        }
        parts.push({ text: promptInstructions });

        const geminiRes = await ai.models.generateContent({
          model: GEMINI_FALLBACK_MODEL,
          contents: parts,
          config: { responseMimeType: 'application/json' }
        });
        jsonContent = geminiRes.text || '{}';
        usedProvider = 'gemini-fallback';
        usedModel = GEMINI_FALLBACK_MODEL;
      }

      const parsed = extractJson(jsonContent);

      const scenes: SceneAnalysis[] = Array.isArray(parsed.scenes)
        ? parsed.scenes.map((s: any, idx: number) => ({
            id: s.id || `scene-${idx + 1}`,
            startTimeSec: typeof s.startTimeSec === 'number' ? s.startTimeSec : idx * 3,
            endTimeSec: typeof s.endTimeSec === 'number' ? s.endTimeSec : (idx + 1) * 3,
            description: String(s.description || '').trim(),
            visualText: s.visualText ? String(s.visualText).trim() : undefined,
            productsDetected: Array.isArray(s.productsDetected) ? s.productsDetected.map(String) : [],
            cameraMotion: s.cameraMotion ? String(s.cameraMotion) : undefined,
            hookPotential: ['high', 'medium', 'low'].includes(s.hookPotential) ? s.hookPotential : 'medium'
          }))
        : [
            {
              id: 'scene-1',
              startTimeSec: 0,
              endTimeSec: durationSec,
              description: parsed.summary || 'Full video presentation',
              hookPotential: 'high'
            }
          ];

      return {
        success: true,
        provider: usedProvider,
        model: usedModel,
        durationSec,
        scenes,
        summary: parsed.summary || 'Video decomposed into scenes successfully.',
        detectedVisualTags: Array.isArray(parsed.detectedVisualTags) ? parsed.detectedVisualTags : [],
        tokenUsage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens
        }
      };
    } catch (err: any) {
      console.error('[MetaVideo] analyzeVideoScenes error:', err);
      return {
        success: false,
        provider: usedProvider,
        model: usedModel,
        durationSec,
        scenes: [],
        summary: '',
        detectedVisualTags: [],
        error: err.message || 'Failed to analyze video scenes'
      };
    }
  }

  /**
   * Mode B: Generates dialect-authentic advertising voiceover segments synchronized with video scenes
   * using Meta Muse Spark (or Gemini fallback when META_STRICT is not enabled).
   */
  async generateAdvertisingVoiceover(params: {
    scenes: SceneAnalysis[];
    durationSec: number;
    dialect: string;
    platform: string;
    tone: string;
    voice: string;
    userBrief?: string;
  }): Promise<DubbingGenerationResult> {
    const { scenes, durationSec, dialect, platform, tone, voice, userBrief } = params;

    console.log(`[MetaVideo] Script generation started. Model: ${this.model}, Dialect: ${dialect}, Platform: ${platform}, Duration: ${Math.round(durationSec)}s, Scenes count: ${scenes.length}`);

    if (!this.apiKey && isMetaStrict()) {
      console.error('[MetaVideo] Script generation failed: META_STRICT is enabled and META_API_KEY is not configured.');
      return {
        success: false,
        provider: 'meta',
        model: this.model,
        segments: [],
        suggestedTtsSettings: { style: tone, emotion: 'neutral', pace: 'normal' },
        error: 'META_STRICT is enabled and META_API_KEY is not configured.'
      };
    }

    const scenesSummary = scenes.map((s, idx) =>
      `[Scene ${idx + 1} | id: "${s.id}"] (${s.startTimeSec.toFixed(1)}s - ${s.endTimeSec.toFixed(1)}s, duration: ${(s.endTimeSec - s.startTimeSec).toFixed(1)}s):
- Visual description: ${s.description}
- Visual on-screen text: "${s.visualText || 'None'}"
- Products/Features: ${s.productsDetected && s.productsDetected.length > 0 ? s.productsDetected.join(', ') : 'None'}
- Hook potential: ${s.hookPotential}
- Camera/Motion: ${s.cameraMotion || 'Standard'}`
    ).join('\n\n');

    const targetDialect = dialect || 'Algerian Arabic';
    let dialectInstruction = '';
    if (targetDialect === 'Algerian Arabic' || targetDialect.toLowerCase().includes('algerian') || targetDialect.toLowerCase().includes('darija')) {
      dialectInstruction = `DIALECT MANDATE: Algerian Arabic (الدارجة الجزائرية).
- MUST use authentic, conversational Algerian Darija terms (e.g. "شوفي يا لالة", "جبنالك اليوم", "باش تستفادي", "ما تراطيش هاد الفرصة", "ديري la commande تاعك", "سلعة طوب ومضمونة", "التوصيل متوفر حتى لباب دارك").
- NEVER use stiff Modern Standard Arabic (فصحى) or robotic literal translations.
- Maintain natural Algerian phrasing, expressions, and commercial cadence.`;
    } else {
      dialectInstruction = `DIALECT MANDATE: ${dialect}.
- Use natural spoken vocabulary and authentic colloquial idioms for commercial voiceover in ${dialect}.
- Avoid stiff, formal classical Arabic unless the brief explicitly calls for it.`;
    }

    const systemPrompt = `You are a world-class advertising creative director and commercial voice-over scriptwriter.
Your goal is to write an authentic, high-converting video voiceover script in "${dialect}" for ${platform} (Total duration: ${Math.round(durationSec)}s).
Desired Tone: "${tone}".

${dialectInstruction}

CRITICAL RULES:
1. Divide the voiceover into segments that map cleanly to the scene timestamps.
2. In the first 1-3 seconds, deliver a high-energy, captivating HOOK matching the visual action.
3. Keep the pace comfortable so each segment can be spoken within its time window (approx. 2.0 to 2.5 words per second). Do NOT cram too many words into short scenes.
4. Natural pacing: You do NOT have to put speech on every single scene if it makes the ad feel crowded; visual pauses are effective.
5. Factual Grounding: STRICTLY base your claims ONLY on what is visually shown in the video scenes or explicitly provided in the user brief. DO NOT invent fake prices, discounts, warranty periods, delivery promises, or technical certifications that are not mentioned.
6. The final segment must be an action-oriented Call to Action (CTA).
7. All segment timestamps must be non-negative and fit within 0s to ${Math.round(durationSec)}s.

Respond ONLY with valid, parseable JSON in this exact structure:
{
  "suggestedTtsSettings": {
    "style": "${tone}",
    "emotion": "excited",
    "pace": "energetic"
  },
  "segments": [
    {
      "id": "seg-1",
      "sceneId": "scene-1",
      "startTimeSec": 0.0,
      "endTimeSec": 3.5,
      "text": "السطر الإعلاني المنطوق هنا بالدارجة",
      "emotion": "excited",
      "pace": "fast"
    }
  ]
}`;

    const userPrompt = `SCENE BREAKDOWN (FROM VISUAL ANALYSIS):
${scenesSummary}

${userBrief ? `USER CAMPAIGN BRIEF & PRODUCT DETAILS:\n${userBrief}\n` : ''}

Generate the complete, timestamp-synchronized advertising voiceover script now in ${dialect} as pure JSON.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let usedProvider: AiProviderType = 'meta';
    let usedModel: string = this.model;

    try {
      const chatRes = await this.callMetaChat(messages, 0.4);
      usedProvider = chatRes.provider;
      usedModel = chatRes.model;
      const data = chatRes.data;
      const content = data?.choices?.[0]?.message?.content || '';

      if (data?.usage) {
        totalInputTokens += data.usage.prompt_tokens || 0;
        totalOutputTokens += data.usage.completion_tokens || 0;
      }

      let parsed = extractJson(content);

      if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        console.warn('[MetaVideo] Initial output did not parse cleanly. Executing repair pass...');
        const repairMessages = [
          ...messages,
          { role: 'assistant', content: content || '{}' },
          {
            role: 'user',
            content: `CRITICAL FORMAT ERROR: Your previous response was not valid JSON or was missing the "segments" array.
Respond ONLY with valid JSON in this exact format:
{
  "suggestedTtsSettings": { "style": "${tone}", "emotion": "excited", "pace": "energetic" },
  "segments": [
    { "id": "seg-1", "sceneId": "scene-1", "startTimeSec": 0, "endTimeSec": 3, "text": "...", "emotion": "excited", "pace": "fast" }
  ]
}`
          }
        ];

        const repairRes = await this.callMetaChat(repairMessages, 0.2);
        usedProvider = repairRes.provider;
        usedModel = repairRes.model;
        const repairData = repairRes.data;
        if (repairData?.usage) {
          totalInputTokens += repairData.usage.prompt_tokens || 0;
          totalOutputTokens += repairData.usage.completion_tokens || 0;
        }
        const repairContent = repairData?.choices?.[0]?.message?.content || '';
        parsed = extractJson(repairContent);
      }

      if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
        throw new Error('Model returned no usable voiceover segments.');
      }

      const validSegments: VoiceoverSegment[] = [];
      let previousEnd = 0;
      const safeDuration = Math.max(10, durationSec || 0);

      for (let i = 0; i < parsed.segments.length; i++) {
        const raw = parsed.segments[i];
        const rawText = raw.text || raw.line || raw.spokenText || raw.script || raw.content || '';
        const text = String(rawText).trim();
        if (!text) continue;

        let startTimeSec = typeof raw.startTimeSec === 'number' && !isNaN(raw.startTimeSec) ? raw.startTimeSec
          : typeof raw.startTime === 'number' && !isNaN(raw.startTime) ? raw.startTime
          : typeof raw.start === 'number' && !isNaN(raw.start) ? raw.start
          : previousEnd;

        let endTimeSec = typeof raw.endTimeSec === 'number' && !isNaN(raw.endTimeSec) ? raw.endTimeSec
          : typeof raw.endTime === 'number' && !isNaN(raw.endTime) ? raw.endTime
          : typeof raw.end === 'number' && !isNaN(raw.end) ? raw.end
          : startTimeSec + 3;

        startTimeSec = Math.max(0, startTimeSec);
        if (startTimeSec >= safeDuration) {
          startTimeSec = Math.max(0, previousEnd);
          endTimeSec = Math.min(safeDuration, startTimeSec + 2.5);
        }
        if (endTimeSec > safeDuration) {
          endTimeSec = safeDuration;
        }

        if (startTimeSec < previousEnd) {
          startTimeSec = previousEnd;
        }
        if (endTimeSec <= startTimeSec) {
          endTimeSec = Math.min(safeDuration, startTimeSec + 1.5);
        }

        previousEnd = endTimeSec;

        validSegments.push({
          id: raw.id || `seg-${i + 1}`,
          sceneId: raw.sceneId || (scenes[i]?.id || `scene-${i + 1}`),
          startTimeSec: Number(startTimeSec.toFixed(2)),
          endTimeSec: Number(endTimeSec.toFixed(2)),
          text,
          dialect,
          voice,
          emotion: raw.emotion || 'excited',
          pace: raw.pace || 'fast'
        });
      }

      if (validSegments.length === 0) {
        throw new Error('No valid voiceover segments could be extracted within the video timeline.');
      }

      console.log(`[MetaVideo] Script generation succeeded via ${usedProvider} (${usedModel}). Generated ${validSegments.length} segments.`);

      return {
        success: true,
        provider: usedProvider,
        model: usedModel,
        segments: validSegments,
        suggestedTtsSettings: parsed.suggestedTtsSettings || {
          style: tone,
          emotion: 'excited',
          pace: 'energetic'
        },
        tokenUsage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens
        }
      };
    } catch (err: any) {
      console.error(`[MetaVideo] Script generation failed: ${err.message}`);
      return {
        success: false,
        provider: usedProvider,
        model: usedModel,
        segments: [],
        suggestedTtsSettings: { style: tone, emotion: 'neutral', pace: 'normal' },
        error: `Script generation failed: ${err.message}`
      };
    }
  }

  /**
   * Rewrites/regenerates text for a single voiceover segment.
   */
  async regenerateSingleSegmentText(params: {
    segmentId: string;
    sceneDescription?: string;
    currentText?: string;
    dialect: string;
    tone: string;
    userBrief?: string;
  }): Promise<{ success: boolean; text: string; provider?: AiProviderType; model?: string; error?: string }> {
    const { sceneDescription, currentText, dialect, tone, userBrief } = params;

    if (!this.apiKey && isMetaStrict()) {
      return {
        success: false,
        text: '',
        provider: 'meta',
        model: this.model,
        error: 'META_STRICT is enabled and META_API_KEY is not configured.'
      };
    }

    const prompt = `You are a world-class advertising scriptwriter specializing in commercial voiceovers.
Rewrite a single compelling voiceover line for a video segment in spoken "${dialect}".
Tone: "${tone}".

Context:
${sceneDescription ? `- Visual Scene Description: ${sceneDescription}` : ''}
${currentText ? `- Previous line: "${currentText}"` : ''}
${userBrief ? `- Campaign Brief: ${userBrief}` : ''}

Rules:
1. Return ONLY the new spoken line in natural, conversational ${dialect}.
2. Keep it punchy, short, and suited for a 2-4 second video clip.
3. No quotes, no markdown, no json headers, just the spoken line text.`;

    try {
      const messages = [{ role: 'user', content: prompt }];
      const chatRes = await this.callMetaChat(messages, 0.5);
      const text = String(chatRes.data?.choices?.[0]?.message?.content || '').replace(/^["']|["']$/g, '').trim();

      if (!text) throw new Error('Model returned empty response.');
      return {
        success: true,
        text,
        provider: chatRes.provider,
        model: chatRes.model
      };
    } catch (err: any) {
      console.error('[MetaVideo] regenerateSingleSegmentText error:', err);
      return {
        success: false,
        text: '',
        provider: 'meta',
        model: this.model,
        error: err.message || 'Failed to regenerate segment text.'
      };
    }
  }

  /**
   * Mode C: Transcribes audio speech and localizes/adapts it into target dialect.
   */
  async localizeExistingAudio(params: {
    audioWavPath: string;
    targetDialect: string;
    targetVoice: string;
    durationSec: number;
  }): Promise<VideoLocalizationResult> {
    const { audioWavPath, targetDialect, targetVoice } = params;

    try {
      if (isMetaStrict() && !this.apiKey) {
        throw new Error('META_STRICT is enabled and META_API_KEY is not configured.');
      }

      const tempCompressedPath = path.join(path.dirname(audioWavPath), `compressed_transcribe_${Date.now()}.wav`);
      try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', audioWavPath,
          '-ar', '16000',
          '-ac', '1',
          '-b:a', '32k',
          tempCompressedPath
        ]);
      } catch (convErr) {
        console.warn('[MetaVideo] Audio compression warning, falling back to original WAV:', convErr);
      }

      const activeAudioPath = fs.existsSync(tempCompressedPath) ? tempCompressedPath : audioWavPath;
      const buffer = await fs.promises.readFile(activeAudioPath);
      const base64Audio = buffer.toString('base64');

      if (fs.existsSync(tempCompressedPath)) {
        fs.promises.unlink(tempCompressedPath).catch(() => {});
      }

      const geminiKey = process.env.gemini_api_key1 || process.env.gemini_api_key2 || process.env.GEMINI_API_KEY;
      if (!geminiKey) throw new Error('No Gemini API key available.');

      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const prompt = `Listen to the audio track from a video.
1. Transcribe the original speech into text with approximate start and end timestamps (seconds).
2. Translate and localize the speech content into spoken "${targetDialect}". Keep the translation natural and faithful to the original emotional intensity.
3. Make sure the translated segments fit within the original time slots.

Respond ONLY with valid JSON:
{
  "originalTranscript": [
    { "startTimeSec": 0, "endTimeSec": 3, "speaker": "Speaker 1", "text": "Original transcript" }
  ],
  "localizedSegments": [
    {
      "id": "loc-1",
      "startTimeSec": 0,
      "endTimeSec": 3,
      "text": "Localized speech in ${targetDialect}",
      "emotion": "neutral",
      "pace": "normal"
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: GEMINI_FALLBACK_MODEL,
        contents: [
          {
            inlineData: {
              data: base64Audio,
              mimeType: 'audio/wav'
            }
          },
          { text: prompt }
        ],
        config: { responseMimeType: 'application/json' }
      });

      const parsed = extractJson(response.text || '{}');

      const localizedSegments: VoiceoverSegment[] = Array.isArray(parsed.localizedSegments)
        ? parsed.localizedSegments.map((s: any, idx: number) => ({
            id: s.id || `loc-${idx + 1}`,
            sceneId: s.sceneId,
            startTimeSec: typeof s.startTimeSec === 'number' ? s.startTimeSec : idx * 3,
            endTimeSec: typeof s.endTimeSec === 'number' ? s.endTimeSec : (idx + 1) * 3,
            text: String(s.text || '').trim(),
            dialect: targetDialect,
            voice: targetVoice,
            emotion: s.emotion || 'neutral',
            pace: s.pace || 'normal'
          }))
        : [];

      return {
        success: true,
        provider: 'gemini-fallback',
        model: GEMINI_FALLBACK_MODEL,
        originalTranscript: Array.isArray(parsed.originalTranscript) ? parsed.originalTranscript : [],
        localizedSegments
      };
    } catch (err: any) {
      console.error('[MetaVideo] localizeExistingAudio error:', err);
      return {
        success: false,
        provider: 'gemini-fallback',
        model: GEMINI_FALLBACK_MODEL,
        originalTranscript: [],
        localizedSegments: [],
        error: err.message || 'Audio localization failed'
      };
    }
  }
}

export const defaultMetaVideoClient = new MetaVideoClient();
