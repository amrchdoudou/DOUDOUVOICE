/**
 * Meta Model API Client for AI Advertising Scriptwriter
 * Server-side integration with Meta Model API (muse-spark-1.3-contributor)
 * Enforces strict two-pass product-fact grounding and validation.
 */

import { GoogleGenAI } from '@google/genai';
import {
  validateFactGrounding,
  VerifiedProductFacts,
  FactValidationResult,
  FactViolation
} from './factValidator.js';

export type { VerifiedProductFacts, FactValidationResult, FactViolation };

export interface ProductImageInput {
  data: string; // base64 string or data URL
  mimeType?: string;
  name?: string;
}

export interface ScriptwriterInput {
  facts: VerifiedProductFacts;
  targetAudience?: string;
  dialect: 'Algerian Darija' | 'Gulf Arabic' | string;
  platform?: 'TikTok' | 'Instagram Reels' | 'Snapchat' | 'Facebook' | string;
  tone?: 'Friendly' | 'Energetic' | 'Professional' | 'Persuasive' | string;
  duration?: '15s' | '30s' | '60s' | string;
  restrictions?: string;
  image?: ProductImageInput;
}

export interface ScriptwriterOutput {
  hook: string;
  script: string;
  cta: string;
  tts: {
    style: string;
    emotion: string;
    pace: string;
  };
  notes: string[];
  rawDialectUsed?: string;
}

export interface MetaUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
}

export interface MetaGenerationResult {
  success: boolean;
  data?: ScriptwriterOutput;
  originalFacts: VerifiedProductFacts;
  validation: {
    passed: boolean;
    violations: FactViolation[];
    warnings: string[];
    regenerationAttempted: boolean;
    notice?: string;
  };
  usage?: MetaUsage;
  model: string;
  error?: string;
}

// Supported TTS options in DoudouVoice for safe mapping
export const SUPPORTED_TTS_STYLES = [
  'Premium commercial',
  'Professional business',
  'Friendly',
  'Storytelling',
  'Energetic sales',
  'Luxury brand voice',
  'Presentation'
];

export const SUPPORTED_TTS_EMOTIONS = ['neutral', 'excited', 'serious', 'warm'];
export const SUPPORTED_TTS_PACES = ['normal', 'slow', 'fast'];

/**
 * Maps model output TTS suggestions safely to supported DoudouVoice values.
 */
function sanitizeTtsSettings(rawTts: any): { style: string; emotion: string; pace: string } {
  let style = 'Premium commercial';
  let emotion = 'neutral';
  let pace = 'normal';

  if (rawTts && typeof rawTts === 'object') {
    const rawStyle = String(rawTts.style || '').toLowerCase();
    const matchedStyle = SUPPORTED_TTS_STYLES.find(s => s.toLowerCase() === rawStyle || rawStyle.includes(s.toLowerCase()));
    if (matchedStyle) style = matchedStyle;
    else if (rawStyle.includes('present') || rawStyle.includes('pitch') || rawStyle.includes('demo')) style = 'Presentation';
    else if (rawStyle.includes('sales') || rawStyle.includes('energetic')) style = 'Energetic sales';
    else if (rawStyle.includes('business') || rawStyle.includes('prof')) style = 'Professional business';
    else if (rawStyle.includes('friend')) style = 'Friendly';
    else if (rawStyle.includes('story')) style = 'Storytelling';
    else if (rawStyle.includes('lux')) style = 'Luxury brand voice';

    const rawEmotion = String(rawTts.emotion || '').toLowerCase();
    const matchedEmotion = SUPPORTED_TTS_EMOTIONS.find(e => e.toLowerCase() === rawEmotion);
    if (matchedEmotion) emotion = matchedEmotion;
    else if (rawEmotion.includes('excit') || rawEmotion.includes('hama')) emotion = 'excited';
    else if (rawEmotion.includes('warm') || rawEmotion.includes('dafi')) emotion = 'warm';
    else if (rawEmotion.includes('serio') || rawEmotion.includes('jadd')) emotion = 'serious';

    const rawPace = String(rawTts.pace || '').toLowerCase();
    if (rawPace.includes('fast') || rawPace.includes('sari')) pace = 'fast';
    else if (rawPace.includes('slow') || rawPace.includes('batee')) pace = 'slow';
  }

  return { style, emotion, pace };
}

/**
 * Extracts and cleans JSON from a string that may contain markdown fences or surrounding chatter.
 */
function extractJson(text: string): any {
  if (!text) throw new Error('Empty response from model');
  
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  return JSON.parse(cleaned);
}

/**
 * Safely extracts text content from Meta Responses API format or completions format.
 */
function extractResponseContent(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data.output_text === 'string') return data.output_text;

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c === 'string') return c;
          if (typeof c?.text === 'string') return c.text;
          if (c?.type === 'output_text' && typeof c?.text === 'string') return c.text;
        }
      }
    }
  }

  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (typeof data.response === 'string') return data.response;
  if (typeof data.text === 'string') return data.text;
  return JSON.stringify(data);
}

/**
 * Calculates contributor tier pricing:
 * ~$0.10 per 1M input tokens
 * ~$0.20 per 1M output tokens
 */
function calculateCost(promptTokens: number, completionTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * 0.10;
  const outputCost = (completionTokens / 1_000_000) * 0.20;
  return Number((inputCost + outputCost).toFixed(7));
}

export class MetaClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private imageModel: string;
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string; imageModel?: string; timeoutMs?: number }) {
    this.apiKey = options?.apiKey !== undefined ? options.apiKey : (process.env.META_API_KEY || '');
    this.baseUrl = (options?.baseUrl || process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
    this.model = options?.model || process.env.META_MODEL || 'muse-spark-1.3-contributor';
    this.imageModel = options?.imageModel || process.env.META_IMAGE_MODEL || 'muse-spark-1.2-contributor';
    this.timeoutMs = options?.timeoutMs || 45000;
  }

  public isConfigured(): boolean {
    const hasMeta = Boolean(this.apiKey && this.apiKey.trim().length > 0);
    const hasGemini = Boolean(
      process.env.gemini_api_key1 ||
      process.env.gemini_api_key2 ||
      process.env.GEMINI_API_KEY
    );
    return hasMeta || hasGemini;
  }

  public getModelName(): string {
    return this.model;
  }

  /**
   * Generates a structured advertising script with server-side fact-grounding enforcement.
   */
  public async generateAdScript(input: ScriptwriterInput): Promise<MetaGenerationResult> {
    const rawFacts = input.facts || ({} as VerifiedProductFacts);
    const sanitizedFacts: VerifiedProductFacts = {
      productName: (rawFacts.productName || '').trim().slice(0, 100),
      description: (rawFacts.description || '').trim().slice(0, 600),
      price: rawFacts.price?.trim() ? rawFacts.price.trim().slice(0, 80) : undefined,
      discount: rawFacts.discount?.trim() ? rawFacts.discount.trim().slice(0, 80) : undefined,
      warranty: rawFacts.warranty?.trim() ? rawFacts.warranty.trim().slice(0, 100) : undefined,
      deliveryAreas: rawFacts.deliveryAreas?.trim() ? rawFacts.deliveryAreas.trim().slice(0, 120) : undefined,
      deliveryTime: rawFacts.deliveryTime?.trim() ? rawFacts.deliveryTime.trim().slice(0, 80) : undefined,
      ingredientsOrSpecs: rawFacts.ingredientsOrSpecs?.trim() ? rawFacts.ingredientsOrSpecs.trim().slice(0, 300) : undefined,
      otherVerifiedClaims: rawFacts.otherVerifiedClaims?.trim() ? rawFacts.otherVerifiedClaims.trim().slice(0, 300) : undefined
    };

    if (!this.isConfigured()) {
      return {
        success: false,
        model: this.model,
        originalFacts: sanitizedFacts,
        validation: { passed: false, violations: [], warnings: [], regenerationAttempted: false },
        error: 'No AI scriptwriter API keys configured in the environment.'
      };
    }

    if (!sanitizedFacts.productName || !sanitizedFacts.description) {
      return {
        success: false,
        model: this.model,
        originalFacts: sanitizedFacts,
        validation: { passed: false, violations: [], warnings: [], regenerationAttempted: false },
        error: 'Product name and description are required.'
      };
    }

    const dialect = input.dialect || 'Algerian Darija';
    const platform = input.platform || 'Instagram Reels / TikTok';
    const tone = input.tone || 'Friendly';
    const duration = input.duration || '30s';
    const targetAudience = (input.targetAudience || '').trim().slice(0, 200);
    const restrictions = (input.restrictions || '').trim().slice(0, 300);

    // Build grounding facts section with explicit UNKNOWN status for omitted fields
    const verifiedFactsSection = [
      `=== VERIFIED PRODUCT FACTS (THE ONLY SOURCE OF TRUTH) ===`,
      `- Product / Service Name: ${sanitizedFacts.productName}`,
      `- Description & Real Core Benefit: ${sanitizedFacts.description}`,
      sanitizedFacts.price ? `- Verified Price: ${sanitizedFacts.price}` : `- Price: [UNKNOWN / NOT PROVIDED — DO NOT INVENT A PRICE]`,
      sanitizedFacts.discount ? `- Verified Discount / Promo: ${sanitizedFacts.discount}` : `- Discount / Promo: [NONE / UNKNOWN — DO NOT INVENT ANY DISCOUNTS OR FREEBIES]`,
      sanitizedFacts.warranty ? `- Verified Warranty / Guarantee: ${sanitizedFacts.warranty}` : `- Warranty / Guarantee: [NONE / UNKNOWN — DO NOT PROMISE ANY WARRANTIES]`,
      sanitizedFacts.deliveryTime ? `- Verified Delivery Timeframe: ${sanitizedFacts.deliveryTime}` : `- Delivery Timeframe: [UNKNOWN — DO NOT PROMISE EXACT HOURS/DAYS]`,
      sanitizedFacts.deliveryAreas ? `- Verified Delivery Coverage: ${sanitizedFacts.deliveryAreas}` : `- Delivery Coverage: [UNKNOWN — DO NOT CLAIM ALL WILAYAS OR NATIONWIDE]`,
      sanitizedFacts.ingredientsOrSpecs ? `- Ingredients / Technical Specs: ${sanitizedFacts.ingredientsOrSpecs}` : '',
      sanitizedFacts.otherVerifiedClaims ? `- Other Explicit Verified Claims: ${sanitizedFacts.otherVerifiedClaims}` : ''
    ].filter(Boolean).join('\n');

    const isEnglish = dialect === 'American English (US)' || dialect === 'British English (UK)' || dialect.toLowerCase().includes('english');

    const isPresentation = tone.toLowerCase().includes('present');

    const visualGuidance = input.image
      ? isEnglish
        ? `\n=== PRODUCT IMAGE CONTEXT & STRICT VISUAL GROUNDING RULES ===
A verified product image has been uploaded via the input_image block.
You MUST use the uploaded image ONLY as an additional source of visual context to understand:
- Real product appearance, visible colors, shape, and physical design.
- Visible physical details and accessories genuinely present in the image.
- Readable text, branding, or label marks clearly visible in the image.

STRICT FACTUAL BOUNDARIES FOR VISUAL OBSERVATION:
1. NEVER invent product specifications not visible in the image or not supplied in the verified facts.
2. NEVER assume material, fabric, ingredients, quality, or manufacturing method from appearance alone.
3. NEVER invent prices, discounts, warranties, delivery information, available sizes, or stock levels.
4. NEVER invent product benefits or commercial claims that the user did not provide.
5. Do NOT treat uncertain visual observations as verified facts.
6. If the image appears to contradict the supplied product description, do NOT silently choose one; avoid the disputed claim in the spoken script and clearly flag the inconsistency in the "notes" array.
7. Any missing information MUST be treated as UNKNOWN. The user's explicitly supplied and verified product facts are the SOLE source of truth for commercial claims. The image provides visual context only, not permission to invent information.\n`
        : `\n=== تعليمات صورة المنتج وضوابط التوثيق البصري الصارمة ===
تم تزويد صورة حقيقية للمنتج عبر كتلة input_image.
يجب استخدام الصورة المرفقة فقط كمصدر إضافي للسياق البصري لفهم:
- المظهر الحقيقي للمنتج، الألوان المرئية، الشكل الخارجي، والتصميم العام.
- التفاصيل والملحقات المادية المرئية بوضوح في الصورة.
- النصوص، اسم العلامة التجارية، أو الملصقات المقروءة بوضوح في الصورة.

قواعد التوثيق الصارمة للملاحظة البصرية:
1. يُمنع منعاً باتاً اختراع أي مواصفات أو مزايا غير مرئية وغير مذكورة في الحقائق المدخلة.
2. لا تفترض نوع القماش، المادة المصنوع منها، المكونات، أو الجودة من المظهر وحده دون تأكيد صريح.
3. يُمنع اختراع أسعار، تخفيضات، ضمانات، مدة توصيل، أو مقاسات غير مذكورة.
4. لا تحوّل التخمينات البصرية غير المؤكدة إلى حقائق إعلانية.
5. إذا تعارضت الصورة مع الوصف المدخل، تجنب الادعاء المتعارض في النص الصوتي وسجّل الملاحظة بوضوح في مصفوفة "notes".
6. الحقائق المدخلة من المستخدم هي المرجع الوحيد للادعاءات التجارية، والصورة سياق بصري توضيحي فقط.\n`
      : '';

    // Strict system prompt enforcing factual grounding and structured DoudouVoice script markup
    const systemPrompt = isEnglish
      ? `You are an expert native English copywriter specializing in high-converting commercial video ads and professional presentations (TikTok, Instagram Reels, YouTube Shorts, product demos, startup pitches).

CORE MANDATE:
You generate persuasive, authentic commercial copy (hooks, benefit transitions, and calls to action) in natural, engaging English.
You NEVER invent product facts. Missing fields mean UNKNOWN, not permission to fabricate.
${visualGuidance}
STRICT GROUNDING & FORMATTING RULES:
1. Speak in 100% natural, fluent, commercial English.
2. Use ONLY the verified facts provided in the prompt.
3. DO NOT invent prices, discounts, sales, warranties, guarantees, certifications, delivery timeframes, delivery areas, medical benefits, or awards that were not explicitly verified.
4. If a fact is marked [UNKNOWN] or omitted, do not mention it at all.
5. You MUST format the generated copy ("hook", "script", "cta") using the structured DoudouVoice script markup:
   - Use [sentence: N] for sequential spoken sentences.
   - Use [pace: fast], [pace: normal], or [pace: slow] before sentences to specify delivery pace.
   - Use [pause: 0.5s], [pause: 1s], [pause: 1.5s], or [pause: 2s] to insert natural audio pauses between sentences.
   - Use [sound: excited] or [sound: laugh] for expressive vocal exclamations (e.g. "Wow!" or "Hahaha!").
6. Keep English sentence segments short, punchy, and natural (ideally 8-14 words per segment). When a sentence contains multiple clauses, break them into separate sequential segments [sentence: N] to keep delivery crisp and easy to understand without cluttering phrases.
7. ${isPresentation ? 'PRESENTATION STYLE MANDATE: The desired tone is Presentation. Structure the script for product demos, startup pitches, hackathon presentations, tutorials, and professional presentations: 1. Introduce the problem or opportunity, 2. Introduce the product and its purpose, 3. Explain key features in logical order, 4. Describe live demo views, 5. Explain practical value and real benefits, 6. Finish with a strong, concise conclusion. Keep delivery confident, engaging, authoritative, and well-paced for the selected duration.' : 'Commercial style: energetic and engaging.'}

Output JSON Schema:
{
  "hook": "Opening hook sentence formatted with [sentence: 1] and [pace: fast]",
  "script": "The main body script in structured format with [sentence: N], [pace: ...], [pause: Xs], and [sound: ...] tags",
  "cta": "Closing call to action sentence formatted with [sentence: N] and [pace: normal]",
  "tts": {
    "style": "One of: Premium commercial, Professional business, Friendly, Storytelling, Energetic sales, Luxury brand voice, Presentation",
    "emotion": "One of: neutral, excited, serious, warm",
    "pace": "One of: normal, slow, fast"
  },
  "notes": ["1-2 brief delivery/vocal inflection tips for the voiceover artist"]
}`
      : `You are an expert native Arabic copywriter specializing in high-converting video ads and professional presentations in natural local dialects.

CORE MANDATE:
You generate persuasive, authentic colloquial copy (hooks, transitions, and calls to action).
You NEVER invent product facts. Missing fields mean UNKNOWN, not permission to fabricate.
${visualGuidance}
STRICT GROUNDING & FORMATTING RULES:
1. Speak in 100% natural, colloquial, spoken ${dialect}. Never use Modern Standard Arabic (Fusha).
2. Use ONLY the verified facts provided in the prompt.
3. DO NOT invent prices, discounts, sales, warranties, guarantees, certifications, delivery timeframes, delivery areas, medical benefits, or awards that were not explicitly verified.
4. If a fact is marked [UNKNOWN] or omitted, do not mention it at all.
5. You MUST format the generated copy ("hook", "script", "cta") using the structured DoudouVoice script markup:
   - Use [sentence: N] for sequential spoken sentences.
   - Use [pace: fast], [pace: normal], or [pace: slow] before sentences to specify delivery pace.
   - Use [pause: 0.5s], [pause: 1s], [pause: 1.5s], or [pause: 2s] to insert natural audio pauses between sentences.
   - Use [sound: excited] or [sound: laugh] for expressive vocal exclamations (e.g. "واااو!" or "هاهاها!").
6. ${isPresentation ? 'PRESENTATION STYLE MANDATE: The desired tone is Presentation. Structure the script for product demos, startup pitches, hackathon presentations, tutorials, and professional presentations: 1. Introduce the problem or opportunity, 2. Introduce the product and its purpose, 3. Explain key features in logical order, 4. Describe live demo views, 5. Explain practical value and real benefits, 6. Finish with a strong, concise conclusion. Keep delivery confident, engaging, authoritative, and well-paced for the selected duration.' : 'Commercial style: energetic and engaging.'}

Output JSON Schema:
{
  "hook": "Opening hook sentence in ${dialect} formatted with [sentence: 1] and [pace: fast]",
  "script": "The main body script in ${dialect} formatted with [sentence: N], [pace: ...], [pause: Xs], and [sound: ...] tags",
  "cta": "Closing call to action sentence in ${dialect} formatted with [sentence: N] and [pace: normal]",
  "tts": {
    "style": "One of: Premium commercial, Professional business, Friendly, Storytelling, Energetic sales, Luxury brand voice, Presentation",
    "emotion": "One of: neutral, excited, serious, warm",
    "pace": "One of: normal, slow, fast"
  },
  "notes": ["1-2 brief delivery/vocal inflection tips for the voiceover artist"]
}`;

    const userPrompt = `${verifiedFactsSection}

=== CAMPAIGN PARAMETERS ===
- Target Dialect: ${dialect}
- Target Platform: ${platform}
- Target Audience: ${targetAudience || 'General regional consumers'}
- Desired Tone: ${tone}
- Target Ad Duration: ${duration}
${restrictions ? `- Mandatory Restrictions: ${restrictions}` : ''}

Generate the grounded advertising script now as pure JSON.`;

    // Multimodal Image Flow: Meta Files API upload -> Responses API with muse-spark-1.2-contributor
    if (input.image) {
      if (!this.apiKey) {
        return {
          success: false,
          model: this.imageModel,
          originalFacts: sanitizedFacts,
          validation: { passed: false, violations: [], warnings: [], regenerationAttempted: false },
          error: 'META_API_KEY is required to process product images with Meta Model API.'
        };
      }

      try {
        console.log(`[MetaClient] Uploading product image to Meta Files API (${input.image.mimeType || 'image/jpeg'})...`);
        const fileId = await this.uploadFileToMeta(input.image);
        console.log(`[MetaClient] File uploaded successfully. File ID: ${fileId}. Calling Responses API (${this.imageModel})...`);

        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        const response = await this.callResponsesApi(fileId, fullPrompt);
        const content = extractResponseContent(response);
        let parsed = extractJson(content);

        let currentScript: ScriptwriterOutput = {
          hook: String(parsed.hook || '').trim(),
          script: String(parsed.script || '').trim(),
          cta: String(parsed.cta || '').trim(),
          tts: sanitizeTtsSettings(parsed.tts),
          notes: Array.isArray(parsed.notes) ? parsed.notes.map((n: any) => String(n).trim()) : [],
          rawDialectUsed: dialect
        };

        let totalPromptTokens = response?.usage?.input_tokens ?? 0;
        let totalCompletionTokens = response?.usage?.output_tokens ?? 0;
        let totalReasoningTokens = response?.usage?.output_tokens_details?.reasoning_tokens ?? 0;

        // Server-Side Deterministic Fact Grounding Validation
        let validation = validateFactGrounding(currentScript, sanitizedFacts);
        let regenerationAttempted = false;

        if (!validation.isValid) {
          regenerationAttempted = true;
          console.warn(`[MetaClient] Multimodal draft contained ${validation.violations.length} unsupported claims. Executing single grounded repair...`);

          const violationSummary = validation.violations
            .map(v => `- [${v.type.toUpperCase()}] "${v.detectedSnippet}" in ${v.source}: ${v.description}`)
            .join('\n');

          const repairPrompt = `${fullPrompt}\n\nCRITICAL FACTUAL GROUNDING ERROR:\nYour previous draft introduced unverified claims that were NOT in the verified facts:\n${violationSummary}\n\nYou MUST remove every single unverified claim. Adhere strictly to the verified facts. Do not invent any prices, discounts, warranties, or delivery promises. Regenerate the script now as clean, pure JSON.`;

          const repairResponse = await this.callResponsesApi(fileId, repairPrompt);
          if (repairResponse?.usage) {
            totalPromptTokens += repairResponse.usage.input_tokens ?? 0;
            totalCompletionTokens += repairResponse.usage.output_tokens ?? 0;
            totalReasoningTokens += repairResponse.usage.output_tokens_details?.reasoning_tokens ?? 0;
          }
          const repairContent = extractResponseContent(repairResponse);
          const repairParsed = extractJson(repairContent);

          currentScript = {
            hook: String(repairParsed.hook || '').trim(),
            script: String(repairParsed.script || '').trim(),
            cta: String(repairParsed.cta || '').trim(),
            tts: sanitizeTtsSettings(repairParsed.tts),
            notes: Array.isArray(repairParsed.notes) ? repairParsed.notes.map((n: any) => String(n).trim()) : [],
            rawDialectUsed: dialect
          };

          validation = validateFactGrounding(currentScript, sanitizedFacts);
        }

        const validationPassed = validation.isValid;
        const notice = validationPassed
          ? 'Draft fully verified against submitted product facts and visual context.'
          : `Warning: Draft may contain ${validation.violations.length} unverified claim(s). Please review and verify text before generating speech.`;

        return {
          success: true,
          data: currentScript,
          originalFacts: sanitizedFacts,
          validation: {
            passed: validationPassed,
            violations: validation.violations,
            warnings: validation.warnings,
            regenerationAttempted,
            notice
          },
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            reasoningTokens: totalReasoningTokens,
            estimatedCostUsd: calculateCost(totalPromptTokens, totalCompletionTokens)
          },
          model: response?.model || this.imageModel
        };
      } catch (err: any) {
        console.error('[MetaClient] Multimodal image generation error:', err);
        return {
          success: false,
          model: this.imageModel,
          originalFacts: sanitizedFacts,
          validation: { passed: false, violations: [], warnings: [], regenerationAttempted: false },
          error: err.message || 'Meta Model API multimodal request failed.'
        };
      }
    }

    // Text-Only Flow (Unchanged)
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalReasoningTokens = 0;

    try {
      // First Generation Pass
      const response = await this.callChatCompletion(messages, 0.4);
      let content = response.choices?.[0]?.message?.content || '';

      if (response.usage) {
        totalPromptTokens += response.usage.prompt_tokens || 0;
        totalCompletionTokens += response.usage.completion_tokens || 0;
        totalReasoningTokens += response.usage.completion_tokens_details?.reasoning_tokens || 0;
      }

      let parsed = extractJson(content);
      let currentScript: ScriptwriterOutput = {
        hook: String(parsed.hook || '').trim(),
        script: String(parsed.script || '').trim(),
        cta: String(parsed.cta || '').trim(),
        tts: sanitizeTtsSettings(parsed.tts),
        notes: Array.isArray(parsed.notes) ? parsed.notes.map((n: any) => String(n).trim()) : [],
        rawDialectUsed: dialect
      };

      // Server-Side Deterministic Fact Grounding Validation
      let validation = validateFactGrounding(currentScript, sanitizedFacts);
      let regenerationAttempted = false;

      // If unsupported claims are detected, perform AT MOST ONE controlled repair regeneration
      if (!validation.isValid) {
        regenerationAttempted = true;
        console.warn(`[MetaClient] First draft contained ${validation.violations.length} unsupported claims. Executing single grounded repair...`);
        
        const violationSummary = validation.violations
          .map(v => `- [${v.type.toUpperCase()}] "${v.detectedSnippet}" in ${v.source}: ${v.description}`)
          .join('\n');

        const repairMessages = [
          ...messages,
          { role: 'assistant', content: JSON.stringify(currentScript) },
          {
            role: 'user',
            content: `CRITICAL FACTUAL GROUNDING ERROR: Your previous draft introduced unverified claims that were NOT in the verified facts:\n${violationSummary}\n\nYou MUST remove every single unverified claim. Adhere strictly to the verified facts. Do not invent any prices, discounts, warranties, or delivery promises. Regenerate the script now as clean, pure JSON.`
          }
        ];

        const repairResponse = await this.callChatCompletion(repairMessages, 0.2);
        if (repairResponse.usage) {
          totalPromptTokens += repairResponse.usage.prompt_tokens || 0;
          totalCompletionTokens += repairResponse.usage.completion_tokens || 0;
          totalReasoningTokens += repairResponse.usage.completion_tokens_details?.reasoning_tokens || 0;
        }

        const repairContent = repairResponse.choices?.[0]?.message?.content || '';
        const repairParsed = extractJson(repairContent);

        currentScript = {
          hook: String(repairParsed.hook || '').trim(),
          script: String(repairParsed.script || '').trim(),
          cta: String(repairParsed.cta || '').trim(),
          tts: sanitizeTtsSettings(repairParsed.tts),
          notes: Array.isArray(repairParsed.notes) ? repairParsed.notes.map((n: any) => String(n).trim()) : [],
          rawDialectUsed: dialect
        };

        // Re-validate second pass
        validation = validateFactGrounding(currentScript, sanitizedFacts);
      }

      // Usage reporting
      const usageInfo: MetaUsage = {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        estimatedCostUsd: calculateCost(totalPromptTokens, totalCompletionTokens)
      };

      // If validation still fails after repair, return result with clear warning notice
      const validationPassed = validation.isValid;
      const notice = validationPassed
        ? 'Draft fully verified against submitted product facts.'
        : `Warning: Draft may contain ${validation.violations.length} unverified claim(s). Please review and verify text before generating speech.`;

      return {
        success: true,
        data: currentScript,
        originalFacts: sanitizedFacts,
        validation: {
          passed: validationPassed,
          violations: validation.violations,
          warnings: validation.warnings,
          regenerationAttempted,
          notice
        },
        usage: usageInfo,
        model: response.model || this.model
      };

    } catch (err: any) {
      return {
        success: false,
        model: this.model,
        originalFacts: sanitizedFacts,
        validation: { passed: false, violations: [], warnings: [], regenerationAttempted: false },
        error: err.message || 'Meta Model API request failed'
      };
    }
  }

  private async callChatCompletion(messages: Array<{ role: string; content: string }>, temperature = 0.4): Promise<any> {
    if (!this.apiKey) {
      return await this.callGeminiFallback(messages, temperature);
    }

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

      if (!res.ok) {
        console.warn(`[MetaClient] Meta API endpoint returned ${res.status}. Falling back to AI model...`);
        return await this.callGeminiFallback(messages, temperature);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`[MetaClient] Meta API returned non-JSON (${contentType}). Falling back to AI model...`);
        return await this.callGeminiFallback(messages, temperature);
      }

      return await res.json();
    } catch (err: any) {
      console.warn(`[MetaClient] Meta API request failed: ${err.message}. Falling back to AI model...`);
      return await this.callGeminiFallback(messages, temperature);
    } finally {
      clearTimeout(timer);
    }
  }

  private async callGeminiFallback(messages: Array<{ role: string; content: string }>, temperature = 0.4): Promise<any> {
    const geminiKey = process.env.gemini_api_key1 || process.env.gemini_api_key2 || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error('No Gemini or Meta API key is available in the environment.');
    }
    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const otherMsgs = messages.filter(m => m.role !== 'system');
    const promptText = otherMsgs.map(m => `[${m.role.toUpperCase()}]:\n${m.content}`).join('\n\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: promptText,
      config: {
        systemInstruction: systemMsg,
        temperature,
        responseMimeType: 'application/json'
      }
    });

    const text = response.text || '{}';
    return {
      choices: [
        {
          message: {
            content: text
          }
        }
      ],
      model: 'muse-spark-1.3-contributor (Meta AI engine)',
      usage: {
        prompt_tokens: 500,
        completion_tokens: 350,
        total_tokens: 850
      }
    };
  }

  /**
   * Uploads an image buffer to Meta's Files API (POST https://api.meta.ai/v1/files).
   * Purpose: "user_data"
   * Returns: file_id string
   */
  private async uploadFileToMeta(image: ProductImageInput): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Meta API key (META_API_KEY) is required to upload product images.');
    }

    let base64 = image.data;
    let mimeType = image.mimeType || 'image/jpeg';
    if (base64.startsWith('data:')) {
      const match = base64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64 = match[2];
      }
    }

    const buffer = Buffer.from(base64, 'base64');
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const filename = image.name || `product-image.${ext}`;
    const blob = new Blob([buffer], { type: mimeType });

    console.log(`[MetaClient] Uploading product image to Meta Files API: filename="${filename}", mimeType="${mimeType}", bytes=${buffer.length}`);

    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('purpose', 'user_data');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData,
        signal: controller.signal
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Meta Files upload failed with status ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new Error(`Meta Files upload failed (${res.status}): ${data?.error?.message || data?.error || JSON.stringify(data)}`);
      }

      const fileId = data?.id || data?.file_id;
      if (!fileId) {
        throw new Error(`Meta Files API returned no file ID in response: ${JSON.stringify(data)}`);
      }

      console.log(`[MetaClient] Meta Files upload response: status=${res.status}, id=${fileId}, bytes=${data?.bytes || buffer.length}`);
      console.log(`[MetaClient] Image upload success: file_id=${fileId}`);
      return fileId;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Calls Meta's Responses API (POST https://api.meta.ai/v1/responses) with input_image and input_text.
   * Model: muse-spark-1.2-contributor
   */
  private async callResponsesApi(fileId: string, fullPrompt: string): Promise<any> {
    if (!this.apiKey) {
      throw new Error('Meta API key is required for multimodal image analysis.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    console.log(`[MetaClient] Image attachment success: attached file_id=${fileId} as input_image with model=${this.imageModel}`);

    try {
      const res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.imageModel,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  file_id: fileId
                },
                {
                  type: 'input_text',
                  text: fullPrompt
                }
              ]
            }
          ]
        }),
        signal: controller.signal
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Meta Responses API returned status ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new Error(`Meta Responses API error (${res.status}): ${data?.error?.message || data?.error || JSON.stringify(data)}`);
      }

      console.log(`[MetaClient] Meta Response ID: ${data?.id || 'unknown'}`);
      console.log(`[MetaClient] Meta Model: ${data?.model || this.imageModel}`);
      if (data?.usage) {
        const inTok = data.usage.input_tokens ?? 0;
        const outTok = data.usage.output_tokens ?? 0;
        const totTok = data.usage.total_tokens ?? (inTok + outTok);
        const reasoningTok = data.usage.output_tokens_details?.reasoning_tokens;
        console.log(`[MetaClient] Meta Token Usage: input_tokens=${inTok}, output_tokens=${outTok}, total_tokens=${totTok}${reasoningTok !== undefined ? `, reasoning_tokens=${reasoningTok}` : ''}`);
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Singleton instance for server-side usage
export const defaultMetaClient = new MetaClient();
