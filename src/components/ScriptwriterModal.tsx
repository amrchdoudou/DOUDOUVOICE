import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  SlidersHorizontal,
  FileCheck2,
  AlertCircle,
  Image as ImageIcon,
  Upload,
  Trash2,
  Check
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { getDialectFlag } from '../lib/utils';

export interface VerifiedProductFacts {
  productName: string;
  description: string;
  price?: string;
  discount?: string;
  warranty?: string;
  deliveryAreas?: string;
  deliveryTime?: string;
  ingredientsOrSpecs?: string;
  otherVerifiedClaims?: string;
}

interface FactViolation {
  type: string;
  description: string;
  detectedSnippet: string;
  source: 'hook' | 'script' | 'cta';
}

interface ScriptwriterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyToTts: (params: {
    text: string;
    dialect?: string;
    style?: string;
    emotion?: string;
    speed?: number;
  }) => void;
  currentDialect: string;
  initialText?: string;
  initialTone?: string;
}

const SUPPORTED_DIALECTS = [
  'American English (US)',
  'British English (UK)',
  'Algerian Arabic',
  'Algerian Kabyle (Taqbaylit)',
  'Saudi Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Egyptian Arabic',
  'Moroccan Arabic',
  'Tunisian Arabic',
  'Kuwaiti Arabic',
  'Qatari Arabic',
  'Omani Arabic',
  'Bahraini Arabic',
  'Syrian Arabic',
  'Iraqi Arabic',
  'Palestinian Arabic',
  'Neutral Middle Eastern Arabic'
];

const PLATFORMS = ['TikTok', 'Instagram Reels', 'Snapchat', 'Facebook / YouTube Shorts'];
const TONES = ['Friendly', 'Energetic sales', 'Professional business', 'Luxury brand voice', 'Storytelling', 'Presentation'];
const DURATIONS = ['15s', '30s', '60s'];

export default function ScriptwriterModal({
  isOpen,
  onClose,
  onApplyToTts,
  currentDialect,
  initialText,
  initialTone
}: ScriptwriterModalProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();

  // Form input state
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [warranty, setWarranty] = useState('');
  const [deliveryAreas, setDeliveryAreas] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [ingredientsOrSpecs, setIngredientsOrSpecs] = useState('');
  const [otherVerifiedClaims, setOtherVerifiedClaims] = useState('');

  // Campaign parameters
  const [dialect, setDialect] = useState(
    SUPPORTED_DIALECTS.includes(currentDialect) ? currentDialect : 'Algerian Arabic'
  );
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [duration, setDuration] = useState(DURATIONS[1]); // 30s
  const [targetAudience, setTargetAudience] = useState('');
  const [restrictions, setRestrictions] = useState('');

  // Product Image Input state
  const [productImage, setProductImage] = useState<{
    dataUrl: string;
    mimeType: string;
    name: string;
    size: number;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (file: File) => {
    setImageError(null);
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setImageError(t('image_type_error'));
      return;
    }
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setImageError(t('image_size_error'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setProductImage({
          dataUrl,
          mimeType: file.type,
          name: file.name,
          size: file.size
        });
      }
    };
    reader.onerror = () => {
      setImageError(language === 'ar' ? 'فشل قراءة ملف الصورة' : 'Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setProductImage(null);
    setImageError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleLoadKarakouDemo = async () => {
    setProductName('Karakou للأطفال');
    setDescription('كاراكو جزائري تقليدي فاخر للأطفال، قماش قطيفة راقية ومطرز بالفتلة والمجبود الذهبي الأصيل. متوفر بألوان الأسود، الأحمر، والأزرق لجميع المناسبات والأعياد.');
    setPrice('3500 DZD');
    setIngredientsOrSpecs('قطيفة حريرية فاخرة، طرز مجبود ذهبي، سروال مدور، متوفر مقاسات من 6 إلى 16 سنة (الألوان: أسود، أحمر، أزرق)');
    setDialect('Algerian Arabic');
    setPlatform('TikTok');
    setTone('Energetic sales');
    setDuration('30s');
    setShowOptionalFields(true);

    try {
      const res = await fetch('/karakou_sample.jpg');
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setProductImage({
          dataUrl,
          mimeType: 'image/jpeg',
          name: 'karakou_kids.jpg',
          size: blob.size
        });
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.warn('Could not load sample image:', e);
    }
  };

  // Generated state & validation
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // Editable generated output
  const [generatedHook, setGeneratedHook] = useState('');
  const [generatedScript, setGeneratedScript] = useState('');
  const [generatedCta, setGeneratedCta] = useState('');
  const [suggestedTts, setSuggestedTts] = useState<{ style: string; emotion: string; pace: string } | null>(null);
  const [productionNotes, setProductionNotes] = useState<string[]>([]);
  const [originalFacts, setOriginalFacts] = useState<VerifiedProductFacts | null>(null);
  const [validationResult, setValidationResult] = useState<{
    passed: boolean;
    violations: FactViolation[];
    warnings: string[];
    regenerationAttempted: boolean;
    notice?: string;
  } | null>(null);
  const [usageStats, setUsageStats] = useState<{ totalTokens: number; estimatedCostUsd?: number } | null>(null);

  // Preload sound script or text if opened from History with initialText
  useEffect(() => {
    if (isOpen && initialText) {
      if (/\[(sentence|pace|pause|sound):[^\]]+\]/i.test(initialText)) {
        setGeneratedScript(initialText);
        setGeneratedHook('');
        setGeneratedCta('');
        const cleanText = initialText.replace(/\[(sentence|pace|pause|sound):[^\]]+\]/gi, '').replace(/\s+/g, ' ').trim();
        setDescription(cleanText);
        setProductName(cleanText.slice(0, 40) || 'DoudouVoice Audio');
      } else {
        setDescription(initialText);
        const firstLine = initialText.trim().split(/[\n\.\?\!]/)[0] || 'DoudouVoice Audio';
        setProductName(firstLine.slice(0, 40));
      }
      if (initialTone && TONES.includes(initialTone)) {
        setTone(initialTone);
      }
    }
  }, [isOpen, initialText, initialTone]);

  if (!isOpen) return null;

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!productName.trim() || !description.trim()) {
      setError(language === 'ar' ? 'يرجى إدخال اسم المنتج ووصفه' : 'Product name and description are required.');
      return;
    }

    if (!user) {
      setError(
        language === 'ar'
          ? 'يجب تسجيل الدخول لاستخدام كاتب الإعلانات بالذكاء الاصطناعي.'
          : 'Please sign in to generate advertising scripts.'
      );
      return;
    }

    setIsGenerating(true);
    setError(null);

    const factsPayload: VerifiedProductFacts = {
      productName: productName.trim(),
      description: description.trim(),
      price: price.trim() || undefined,
      discount: discount.trim() || undefined,
      warranty: warranty.trim() || undefined,
      deliveryAreas: deliveryAreas.trim() || undefined,
      deliveryTime: deliveryTime.trim() || undefined,
      ingredientsOrSpecs: ingredientsOrSpecs.trim() || undefined,
      otherVerifiedClaims: otherVerifiedClaims.trim() || undefined
    };

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/scriptwriter/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          facts: factsPayload,
          dialect,
          platform,
          tone,
          duration,
          targetAudience: targetAudience.trim() || undefined,
          restrictions: restrictions.trim() || undefined,
          image: productImage ? {
            data: productImage.dataUrl,
            mimeType: productImage.mimeType,
            name: productImage.name
          } : undefined
        })
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text.slice(0, 200) || `Server returned error (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Failed to generate advertising script (${res.status})`);
      }

      const scriptData = data.data;
      setGeneratedHook(scriptData.hook || '');
      setGeneratedScript(scriptData.script || '');
      setGeneratedCta(scriptData.cta || '');
      setSuggestedTts(scriptData.tts || null);
      setProductionNotes(scriptData.notes || []);
      setOriginalFacts(data.originalFacts || factsPayload);
      setValidationResult(data.validation || null);
      setUsageStats(data.usage || null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Script generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyToStudio = () => {
    const combinedScript = [generatedHook, generatedScript, generatedCta]
      .map(s => s.trim())
      .filter(Boolean)
      .join('\n\n');

    let speedVal = 1.0;
    if (suggestedTts?.pace === 'fast') speedVal = 1.15;
    else if (suggestedTts?.pace === 'slow') speedVal = 0.85;

    onApplyToTts({
      text: combinedScript,
      dialect,
      style: suggestedTts?.style,
      emotion: suggestedTts?.emotion,
      speed: speedVal
    });

    onClose();
  };

  const hasGeneratedScript = Boolean(generatedScript || generatedHook);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-4xl bg-[#0c0c0d] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white"
        dir={language === 'ar' ? 'rtl' : 'ltr'}
      >
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  {t('scriptwriter_title')}
                </h2>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[#0866FF] text-white border border-blue-400/40 shadow-[0_0_10px_rgba(8,102,255,0.4)] font-bold flex items-center gap-1.5">
                  <svg className="w-3 h-2 text-white fill-current inline-block" viewBox="0 0 24 12" aria-hidden="true">
                    <path d="M11.996 3.125c-1.89-2.07-4.66-2.92-7.16-2.05-3.37 1.17-4.8 5.43-2.3 8.35 1.83 2.14 4.8 2.8 7.42 1.34l.04-.03.04.03c2.62 1.46 5.59.8 7.42-1.34 2.5-2.92 1.07-7.18-2.3-8.35-2.5-.87-5.27-.02-7.16 2.05z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Meta muse-spark-1.3
                </span>
              </div>
              <p className="text-xs text-white/50">{t('scriptwriter_desc')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle size={16} className="text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* If a script has been generated, show Review & Edit split layout */}
          {hasGeneratedScript ? (
            <div className="space-y-6">
              {/* Validation Status Banner */}
              {validationResult && (
                <div
                  className={`p-4 rounded-xl border text-xs flex flex-col gap-2 ${
                    validationResult.passed
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold">
                      {validationResult.passed ? (
                        <>
                          <ShieldCheck size={18} className="text-emerald-400" />
                          <span>{t('validation_passed_badge')}</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={18} className="text-amber-400" />
                          <span>{t('validation_warning_badge')}</span>
                        </>
                      )}
                    </div>
                    {validationResult.regenerationAttempted && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/70">
                        {language === 'ar' ? 'تمت إعادة التدقيق مرتين' : '2-Pass Grounding Verified'}
                      </span>
                    )}
                  </div>
                  {validationResult.notice && (
                    <p className="text-xs text-white/80">{validationResult.notice}</p>
                  )}
                  {validationResult.violations.length > 0 && (
                    <div className="pt-2 border-t border-white/10 space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        {language === 'ar' ? 'الادعاءات غير الموثقة المرصودة:' : 'Detected unverified claims:'}
                      </span>
                      {validationResult.violations.map((v, idx) => (
                        <div key={idx} className="text-[11px] text-white/70 font-mono">
                          • [{v.type.toUpperCase()}] &quot;{v.detectedSnippet}&quot; ({v.description})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Side-by-Side: Verified Facts Reference vs Editable Generated Script */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Column 1: Audited Facts Source of Truth */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-400 border-b border-white/10 pb-2">
                    <FileCheck2 size={14} />
                    <span>{t('original_facts_title')}</span>
                  </div>
                  {productImage && (
                    <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40 p-1 mb-1">
                      <img
                        src={productImage.dataUrl}
                        alt="Product visual context"
                        className="w-full h-28 object-cover rounded-md"
                      />
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[9px] text-brand-400 border border-brand-500/30 font-medium">
                        {language === 'ar' ? 'سياق بصري' : 'Visual Context'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-2 text-xs text-white/70">
                    <div>
                      <span className="text-white/40 block text-[10px] uppercase">{t('product_name')}</span>
                      <p className="font-semibold text-white">{originalFacts?.productName || productName}</p>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px] uppercase">{t('product_desc')}</span>
                      <p className="leading-relaxed">{originalFacts?.description || description}</p>
                    </div>
                    {originalFacts?.price && (
                      <div>
                        <span className="text-white/40 block text-[10px] uppercase">{t('price_field')}</span>
                        <p className="text-white">{originalFacts.price}</p>
                      </div>
                    )}
                    {originalFacts?.warranty && (
                      <div>
                        <span className="text-white/40 block text-[10px] uppercase">{t('warranty_field')}</span>
                        <p className="text-white">{originalFacts.warranty}</p>
                      </div>
                    )}
                    {originalFacts?.deliveryTime && (
                      <div>
                        <span className="text-white/40 block text-[10px] uppercase">{t('delivery_time_field')}</span>
                        <p className="text-white">{originalFacts.deliveryTime}</p>
                      </div>
                    )}
                    {originalFacts?.deliveryAreas && (
                      <div>
                        <span className="text-white/40 block text-[10px] uppercase">{t('delivery_areas_field')}</span>
                        <p className="text-white">{originalFacts.deliveryAreas}</p>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // Reset to re-edit facts
                      setGeneratedScript('');
                      setGeneratedHook('');
                      setGeneratedCta('');
                    }}
                    className="mt-auto pt-3 text-[11px] text-brand-400 hover:text-brand-300 flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw size={12} />
                    <span>{language === 'ar' ? 'تعديل الحقائق وإعادة التوليد' : 'Edit Facts & Regenerate'}</span>
                  </button>
                </div>

                {/* Column 2 & 3: Editable Hook, Body Script, and CTA */}
                <div className="md:col-span-2 space-y-4">
                  {/* Hook */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-white/60 uppercase tracking-wider block">
                      {t('hook_label')}
                    </label>
                    <textarea
                      value={generatedHook}
                      onChange={(e) => setGeneratedHook(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-sm text-white focus:border-brand-500 focus:outline-none resize-none"
                    />
                  </div>

                  {/* Body Script */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-white/60 uppercase tracking-wider block">
                      {t('script_label')}
                    </label>
                    <textarea
                      value={generatedScript}
                      onChange={(e) => setGeneratedScript(e.target.value)}
                      rows={5}
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-sm text-white focus:border-brand-500 focus:outline-none resize-none leading-relaxed"
                    />
                  </div>

                  {/* CTA */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-white/60 uppercase tracking-wider block">
                      {t('cta_label')}
                    </label>
                    <textarea
                      value={generatedCta}
                      onChange={(e) => setGeneratedCta(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl bg-black/50 border border-white/10 p-3 text-sm text-white focus:border-brand-500 focus:outline-none resize-none"
                    />
                  </div>

                  {/* Suggested TTS and Production Notes */}
                  {suggestedTts && (
                    <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-white/40 uppercase text-[10px]">{language === 'ar' ? 'الضبط الصوتي المقترح:' : 'Suggested TTS:'}</span>
                        <span className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 font-medium">
                          {suggestedTts.style}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white/10 text-white/70">
                          {suggestedTts.emotion}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white/10 text-white/70">
                          {suggestedTts.pace}
                        </span>
                      </div>
                      {usageStats && (
                        <span className="text-[10px] text-white/40 font-mono">
                          Meta Tokens: {usageStats.totalTokens} (~${usageStats.estimatedCostUsd})
                        </span>
                      )}
                    </div>
                  )}

                  {productionNotes.length > 0 && (
                    <div className="text-[11px] text-white/50 italic space-y-0.5">
                      <span className="font-semibold text-white/60 not-italic block">
                        {t('notes_label')}:
                      </span>
                      {productionNotes.map((note, i) => (
                        <p key={i}>• {note}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="px-4 py-2.5 rounded-lg border border-white/20 hover:bg-white/5 text-xs text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  <span>{language === 'ar' ? 'إعادة التوليد' : 'Regenerate'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleApplyToStudio}
                  className="px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-brand-500/20 transition-colors"
                >
                  <span>{t('apply_to_tts')}</span>
                  <ArrowRight size={14} className={language === 'ar' ? 'rotate-180' : ''} />
                </button>
              </div>
            </div>
          ) : (
            /* Input Form when no script is generated yet */
            <form onSubmit={handleGenerate} className="space-y-5">
              {/* Core Mandatory Product Facts */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-400">
                  <ShieldCheck size={16} />
                  <span>{t('verified_facts')}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[11px] text-white/70 font-medium block">
                      {t('product_name')} <span className="text-brand-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder={language === 'ar' ? 'مثال: زيت زيتون أفريد البكر' : 'e.g. Afridh Extra Virgin Olive Oil'}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-white/70 font-medium block">
                      {t('select_dialect')}
                    </label>
                    <select
                      value={dialect}
                      onChange={(e) => setDialect(e.target.value)}
                      className="w-full rounded-xl bg-black border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-brand-500 focus:outline-none"
                    >
                      {SUPPORTED_DIALECTS.map(d => (
                        <option key={d} value={d} className="bg-black">
                          {getDialectFlag(d)} {t(d)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Product Image Input (Optional) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-white/70 font-medium flex items-center gap-1.5">
                      <ImageIcon size={14} className="text-brand-400" />
                      <span>{t('product_image')}</span>
                    </label>
                    {productImage && (
                      <span className="text-[10px] text-white/40 font-mono">
                        {(productImage.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageSelect(file);
                    }}
                  />

                  {imageError && (
                    <div className="text-[11px] text-red-400 flex items-center gap-1">
                      <AlertCircle size={13} />
                      <span>{imageError}</span>
                    </div>
                  )}

                  {!productImage ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleImageSelect(file);
                      }}
                      className="cursor-pointer border border-dashed border-white/15 hover:border-brand-500/50 bg-white/[0.015] hover:bg-white/[0.035] rounded-xl p-3 text-center transition-all group"
                    >
                      <div className="flex items-center justify-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/50 group-hover:text-brand-400 group-hover:scale-105 transition-all shrink-0">
                          <Upload size={16} />
                        </div>
                        <div className="text-left rtl:text-right">
                          <p className="text-xs text-white/80 font-medium group-hover:text-white transition-colors">
                            {t('upload_image_btn')}
                          </p>
                          <p className="text-[10px] text-white/40">
                            {t('product_image_desc')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={productImage.dataUrl}
                          alt={productImage.name}
                          className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0 bg-black"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate max-w-[200px] sm:max-w-[320px]">
                            {productImage.name}
                          </p>
                          <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                            <Check size={11} />
                            {language === 'ar' ? 'جاهزة للتحليل البصري عبر Meta AI' : 'Ready for Meta visual analysis'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-[11px] text-white font-medium transition-colors"
                        >
                          {t('replace_image_btn')}
                        </button>
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          className="p-1.5 rounded-lg border border-white/10 hover:border-red-500/40 hover:bg-red-500/10 text-white/60 hover:text-red-400 transition-colors"
                          title={t('remove_image_btn')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleLoadKarakouDemo}
                      className="text-[11px] text-brand-400 hover:text-brand-300 flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles size={12} />
                      <span>{language === 'ar' ? 'تحميل بيانات وصورة كاراكو للأطفال تلقائياً' : 'Load Karakou Demo Data & Real Image'}</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-white/70 font-medium block">
                    {t('product_desc')} <span className="text-brand-400">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder={
                      language === 'ar'
                        ? 'اكتب الفوائد الحقيقية للمنتج بدقة. لن يقوم الذكاء الاصطناعي باختراع أي مواصفات خارج ما تدخله هنا.'
                        : 'Describe verified benefits and real features. Meta AI will only use facts provided here.'
                    }
                    className="w-full rounded-xl bg-white/5 border border-white/10 p-3.5 text-sm text-white focus:border-brand-500 focus:outline-none resize-none leading-relaxed"
                    required
                  />
                </div>
              </div>

              {/* Collapsible Optional Verified Claims */}
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowOptionalFields(!showOptionalFields)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/10 text-xs text-white/80 transition-colors"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <SlidersHorizontal size={14} className="text-brand-400" />
                    <span>{t('optional_verified_claims')}</span>
                  </span>
                  <span className="text-[11px] text-brand-400 font-mono">
                    {showOptionalFields ? (language === 'ar' ? 'إخفاء ▲' : 'Collapse ▲') : (language === 'ar' ? 'إظهار ▼' : 'Expand ▼')}
                  </span>
                </button>

                <AnimatePresence>
                  {showOptionalFields && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden"
                    >
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('price_field')}
                        </label>
                        <input
                          type="text"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                          placeholder={language === 'ar' ? 'اتركه فارغاً إن لم يكن محدداً' : 'Leave empty if unknown'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('discount_field')}
                        </label>
                        <input
                          type="text"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                          placeholder={language === 'ar' ? 'اتركه فارغاً إن لم يكن هناك تخفيض' : 'Leave empty if none'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('warranty_field')}
                        </label>
                        <input
                          type="text"
                          value={warranty}
                          onChange={(e) => setWarranty(e.target.value)}
                          placeholder={language === 'ar' ? 'مثال: ضمان رسمي 6 أشهر' : 'e.g. 6 months warranty'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('delivery_time_field')}
                        </label>
                        <input
                          type="text"
                          value={deliveryTime}
                          onChange={(e) => setDeliveryTime(e.target.value)}
                          placeholder={language === 'ar' ? 'مثال: خلال 24 ساعة' : 'e.g. Within 24 hours'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('delivery_areas_field')}
                        </label>
                        <input
                          type="text"
                          value={deliveryAreas}
                          onChange={(e) => setDeliveryAreas(e.target.value)}
                          placeholder={language === 'ar' ? 'مثال: 58 ولاية، الرياض' : 'e.g. 58 Wilayas, Riyadh'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('ingredients_field')}
                        </label>
                        <input
                          type="text"
                          value={ingredientsOrSpecs}
                          onChange={(e) => setIngredientsOrSpecs(e.target.value)}
                          placeholder={language === 'ar' ? 'مكونات أو مواصفات مؤكدة' : 'Verified specs or ingredients'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>

                      <div className="md:col-span-2 space-y-1">
                        <label className="text-[10px] uppercase text-white/60 tracking-wider block">
                          {t('restrictions_field')}
                        </label>
                        <input
                          type="text"
                          value={restrictions}
                          onChange={(e) => setRestrictions(e.target.value)}
                          placeholder={language === 'ar' ? 'عبارات يمنع ذكرها، ادعاءات ممنوعة...' : 'Do not claim cure, do not mention...'}
                          className="w-full rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Campaign Style & Platform Options */}
              <div className="pt-2 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-white/50 tracking-wider block">
                    {t('target_platform')}
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    className="w-full rounded-lg bg-black border border-white/10 px-2.5 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  >
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-white/50 tracking-wider block">
                    {t('voice_style')}
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full rounded-lg bg-black border border-white/10 px-2.5 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  >
                    {TONES.map(to => <option key={to} value={to}>{to}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-white/50 tracking-wider block">
                    {language === 'ar' ? 'المدة المستهدفة' : 'Duration'}
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full rounded-lg bg-black border border-white/10 px-2.5 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  >
                    {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-white/50 tracking-wider block">
                    {language === 'ar' ? 'الجمهور المستهدف' : 'Audience'}
                  </label>
                  <input
                    type="text"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder={language === 'ar' ? 'الشباب، العائلات...' : 'Youth, families...'}
                    className="w-full rounded-lg bg-black border border-white/10 px-2.5 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button
                  type="submit"
                  disabled={isGenerating || !productName.trim() || !description.trim()}
                  className="px-8 h-11 bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{t('generating_script')}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      <span>{t('generate_script_btn')}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
