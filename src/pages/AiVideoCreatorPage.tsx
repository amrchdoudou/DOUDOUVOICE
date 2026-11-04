import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { getDialectFlag } from '../lib/utils';
import { KABYLE_REGIONS, VALID_KABYLE_REGIONS } from '../lib/kabyle';
import {
  Sparkles,
  Upload,
  Video,
  Image as ImageIcon,
  Play,
  Pause,
  Download,
  Loader2,
  CheckCircle2,
  Layers,
  FileText,
  Sliders,
  Film,
  Bot,
  ArrowRight,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Cpu,
  Clapperboard,
  Volume2,
  Tag,
  Palette,
  Compass,
  Music,
  RotateCcw,
  User,
  Mic2,
  Info
} from 'lucide-react';

export const STUDIO_DIALECTS = [
  'American English (US)',
  'British English (UK)',
  'Saudi Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Omani Arabic',
  'Kuwaiti Arabic',
  'Qatari Arabic',
  'Bahraini Arabic',
  'Egyptian Arabic',
  'Algerian Arabic',
  'Algerian Kabyle (Taqbaylit)',
  'Tunisian Arabic',
  'Libyan Arabic',
  'Moroccan Arabic',
  'Syrian Arabic',
  'Iraqi Arabic',
  'Palestinian Arabic',
  'Neutral Middle Eastern Arabic'
];

export const STUDIO_STYLES = [
  'Premium commercial',
  'Professional business',
  'Friendly',
  'Storytelling',
  'Energetic sales',
  'Luxury brand voice',
  'Presentation'
];

export const STUDIO_VOICES: Record<'male' | 'female', string[]> = {
  male: ['Puck', 'Fenrir', 'Zephyr'],
  female: ['Kore', 'Charon', 'Aoede']
};

export const STUDIO_VOICE_DESCRIPTIONS: Record<string, { labelEn: string; labelAr: string; tag: string }> = {
  Puck: { labelEn: 'Dynamic commercial voice with crisp, upbeat articulation', labelAr: 'صوت إعلاني ديناميكي بإيقاع حيوي وواضح', tag: 'High-Energy' },
  Fenrir: { labelEn: 'Authoritative, resonant voice with commanding presence', labelAr: 'صوت جهوري وقوي بحضور قيادي', tag: 'Authoritative' },
  Zephyr: { labelEn: 'Calm, smooth voice with natural conversational charm', labelAr: 'صوت هادئ وسلس بجاذبية طبيعية', tag: 'Smooth & Calm' },
  Kore: { labelEn: 'Bright, vibrant commercial voice with engaging clarity', labelAr: 'صوت مشرق وحيوي بنقاء جذاب', tag: 'Vibrant & Clear' },
  Charon: { labelEn: 'Sophisticated, elegant voice with luxurious warmth', labelAr: 'صوت راقٍ وأنيق بنبرة فخمة ودافئة', tag: 'Luxury Warmth' },
  Aoede: { labelEn: 'Melodic, expressive voice with compelling emotional range', labelAr: 'صوت تعبيري متناغم بتدرج عاطفي مميز', tag: 'Expressive' }
};

export const STUDIO_EMOTIONS = [
  { id: 'neutral', labelEn: 'Neutral & Natural', labelAr: 'طبيعي ومحايد' },
  { id: 'excited', labelEn: 'Excited & High-Energy', labelAr: 'متحمس وعالي الطاقة' },
  { id: 'serious', labelEn: 'Serious & Authoritative', labelAr: 'جدي وواثق' },
  { id: 'warm', labelEn: 'Warm & Inviting', labelAr: 'دافئ وجذاب' }
];

interface UploadedAsset {
  id: string;
  type: 'image' | 'video';
  filePath: string;
  originalName: string;
  mimeType: string;
  previewUrl?: string;
  durationSec?: number;
  file?: File;
}

interface PersistedCreatorDraft {
  assets: Array<{
    id: string;
    type: 'image' | 'video';
    filePath: string;
    originalName: string;
    mimeType: string;
    durationSec?: number;
    file?: File;
  }>;
  dialect: string;
  voice: string;
  gender?: 'male' | 'female';
  style?: string;
  emotion?: string;
  speed?: number;
  pitch?: number;
  kabyleRegion?: string;
  targetDuration: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  userPrompt: string;
  autoResumePipeline?: boolean;
  activeProjectId?: string;
  serverAssets?: UploadedAsset[];
  savedAt: number;
}

const CREATOR_IDB_NAME = 'doudou_creator_draft_db';
const CREATOR_IDB_STORE = 'drafts';
const CREATOR_IDB_KEY = 'active_creator_draft';

function openCreatorDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CREATOR_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CREATOR_IDB_STORE)) {
        db.createObjectStore(CREATOR_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveCreatorDraftToIdb(draft: PersistedCreatorDraft): Promise<void> {
  try {
    const db = await openCreatorDraftDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CREATOR_IDB_STORE, 'readwrite');
      tx.objectStore(CREATOR_IDB_STORE).put(draft, CREATOR_IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('Could not persist creator draft to IndexedDB:', e);
  }
}

async function loadCreatorDraftFromIdb(): Promise<PersistedCreatorDraft | null> {
  try {
    const db = await openCreatorDraftDb();
    const res = await new Promise<PersistedCreatorDraft | null>((resolve, reject) => {
      const tx = db.transaction(CREATOR_IDB_STORE, 'readonly');
      const getReq = tx.objectStore(CREATOR_IDB_STORE).get(CREATOR_IDB_KEY);
      getReq.onsuccess = () => resolve((getReq.result as PersistedCreatorDraft) || null);
      getReq.onerror = () => reject(getReq.error);
    });
    db.close();
    return res;
  } catch (e) {
    console.warn('Could not load creator draft from IndexedDB:', e);
    return null;
  }
}

async function clearCreatorDraftAutoResumeInIdb(): Promise<void> {
  try {
    const existing = await loadCreatorDraftFromIdb();
    if (existing) {
      await saveCreatorDraftToIdb({
        ...existing,
        autoResumePipeline: false
      });
    }
  } catch (_) {}
}

/**
 * Attempts an in-place hidden-iframe handshake with the AI Studio preview proxy
 * so a stale session cookie ("Cookie check") is refreshed without losing page state.
 */
async function recoverPreviewSessionInPlace(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let iframe: HTMLIFrameElement | null = null;

    const onMessage = (event: MessageEvent) => {
      try {
        if (iframe && event.source === iframe.contentWindow && window.parent && window.parent !== window) {
          window.parent.postMessage(event.data, '*');
        } else if (iframe && iframe.contentWindow && event.source === window.parent) {
          iframe.contentWindow.postMessage(event.data, '*');
        }
      } catch (_) {}
    };

    const cleanup = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      resolve(ok);
    };

    window.addEventListener('message', onMessage);

    try {
      iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `/api/creator/ping?_ais_handshake=${Date.now()}`;
      document.body.appendChild(iframe);
    } catch (_) {
      cleanup(false);
      return;
    }

    setTimeout(async () => {
      try {
        const pingRes = await fetch(`/api/creator/ping?_t=${Date.now()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        const ct = pingRes.headers.get('content-type') || '';
        cleanup(pingRes.ok && ct.includes('application/json'));
      } catch (_) {
        cleanup(false);
      }
    }, 2200);
  });
}

export default function AiVideoCreatorPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const draftRestoredRef = useRef<boolean>(false);
  const autoResumeTriggeredRef = useRef<boolean>(false);
  const isRunningRef = useRef<boolean>(false);
  const activeJobCheckedRef = useRef<boolean>(false);
  
  // Pipeline Settings
  const [dialect, setDialect] = useState<string>('Algerian Arabic');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [voice, setVoice] = useState<string>('Puck');
  const [style, setStyle] = useState<string>('Premium commercial');
  const [emotion, setEmotion] = useState<string>('neutral');
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitch, setPitch] = useState<number>(0);
  const [kabyleRegion, setKabyleRegion] = useState<string>('default');
  const [targetDuration, setTargetDuration] = useState<number>(15);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [userPrompt, setUserPrompt] = useState<string>('');

  // Voice Preview State
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [showFineTuning, setShowFineTuning] = useState<boolean>(false);

  // Status Stepper
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentStage, setCurrentStage] = useState<number>(0); // 0: Idle, 1: Upload, 2: Analysis, 3: Creative Dir, 4: Plan & Director Review, 5: Script & Voice, 6: Render, 7: Final AI Inspection, 8: Released
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Execution Results
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [creativeDirection, setCreativeDirection] = useState<any>(null);
  const [scriptData, setScriptData] = useState<any>(null);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [editingPlanReviewSummary, setEditingPlanReviewSummary] = useState<any>(null);
  const [selectedPlanVersionIndex, setSelectedPlanVersionIndex] = useState<number | null>(null);
  const [finalInspection, setFinalInspection] = useState<any>(null);
  const [voiceValidation, setVoiceValidation] = useState<any>(null);
  const [validationData, setValidationData] = useState<any>(null);
  const [repairHistory, setRepairHistory] = useState<any[]>([]);
  const [finalReleaseStatus, setFinalReleaseStatus] = useState<'VERIFIED_AND_RELEASED' | 'UNAPPROVED_BEST_AVAILABLE' | ''>('');
  const [modelsUsed, setModelsUsed] = useState<{ contributor?: string; reviewer?: string; inspector?: string; tts?: string } | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [renderedVia, setRenderedVia] = useState<string>('');
  const [isModalFallback, setIsModalFallback] = useState<boolean>(false);
  const [modalAppInfo, setModalAppInfo] = useState<any>(null);
  const [modalStatus, setModalStatus] = useState<{
    configured: boolean;
    connected?: boolean;
    appName: string;
    workspace: string;
    environment: string;
    functionName: string;
    expectedAppId: string;
    resolvedAppId?: string;
    functionId?: string;
    requiredSecrets?: string[];
    error?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamToken, setStreamToken] = useState<string>('');
  const [streamTokenExp, setStreamTokenExp] = useState<number>(0);
  const [activeProvider, setActiveProvider] = useState<'meta' | 'gemini-fallback'>('meta');
  const [activeModel, setActiveModel] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // Accordion Toggles
  const [showAnalysisJson, setShowAnalysisJson] = useState<boolean>(false);
  const [showScriptJson, setShowScriptJson] = useState<boolean>(false);
  const [showPlanJson, setShowPlanJson] = useState<boolean>(false);
  const [showReviewDrawer, setShowReviewDrawer] = useState<boolean>(true);
  const [showInspectionDrawer, setShowInspectionDrawer] = useState<boolean>(true);

  const handlePreviewVoice = async (targetVoice: string) => {
    if (previewingVoice === targetVoice && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setPreviewingVoice(null);
      return;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }

    setIsPreviewLoading(true);
    setPreviewingVoice(targetVoice);

    try {
      const idToken = user ? await user.getIdToken() : '';
      const res = await fetch('/api/creator/voice-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        },
        body: JSON.stringify({
          voice: targetVoice,
          dialect,
          gender,
          style,
          emotion,
          speed,
          pitch,
          kabyleRegion: dialect === 'Algerian Kabyle (Taqbaylit)' ? kabyleRegion : undefined
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to preview voice');
      }

      const data = await res.json();
      if (data.audioUrl) {
        if (!previewAudioRef.current) {
          previewAudioRef.current = new Audio();
        }
        previewAudioRef.current.src = data.audioUrl;
        previewAudioRef.current.onended = () => setPreviewingVoice(null);
        previewAudioRef.current.onerror = () => setPreviewingVoice(null);
        await previewAudioRef.current.play();
      }
    } catch (err: any) {
      console.warn('Voice preview error:', err);
      setPreviewingVoice(null);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Keep AI Studio preview proxy cookie warm while page is open
  useEffect(() => {
    const pingSession = async () => {
      try {
        const res = await fetch(`/api/creator/ping?_t=${Date.now()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          const text = await res.text();
          if (text.includes('Cookie check')) {
            await recoverPreviewSessionInPlace();
          }
        }
      } catch (_) {}
    };

    const checkModalStatus = async () => {
      try {
        const res = await fetch('/api/creator/modal-status?verify=true', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') && res.ok) {
          const data = await res.json();
          if (data && data.appName) {
            setModalStatus(data);
          }
        }
      } catch (_) {}
    };

    pingSession();
    checkModalStatus();
    const interval = setInterval(pingSession, 90 * 1000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        pingSession();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  // Restore saved assets & settings (and auto-resume if reloaded for Cookie check handshake)
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    (async () => {
      const draft = await loadCreatorDraftFromIdb();
      if (!draft) return;

      // Only restore drafts from the last 2 hours
      if (Date.now() - draft.savedAt > 2 * 60 * 60 * 1000) return;

      if (draft.dialect) {
        const mappedDialect = draft.dialect === 'Algerian Darija' ? 'Algerian Arabic'
          : draft.dialect === 'Gulf Arabic' ? 'Emirati Arabic (Dubai / UAE)'
          : draft.dialect === 'English' ? 'American English (US)'
          : draft.dialect;
        if (STUDIO_DIALECTS.includes(mappedDialect)) {
          setDialect(mappedDialect);
        }
      }
      if (draft.gender && (draft.gender === 'male' || draft.gender === 'female')) {
        setGender(draft.gender);
      }
      if (draft.voice) {
        const resolvedVoice = STUDIO_VOICES.female.includes(draft.voice) || draft.voice === 'ar-DZ-Meriem' || draft.voice === 'ar-AE-Fatima'
          ? (STUDIO_VOICES.female.includes(draft.voice) ? draft.voice : 'Aoede')
          : (STUDIO_VOICES.male.includes(draft.voice) ? draft.voice : 'Puck');
        setVoice(resolvedVoice);
        if (STUDIO_VOICES.female.includes(resolvedVoice)) {
          setGender('female');
        } else {
          setGender('male');
        }
      }
      if (draft.style && STUDIO_STYLES.includes(draft.style)) setStyle(draft.style);
      if (draft.emotion && STUDIO_EMOTIONS.some(e => e.id === draft.emotion)) setEmotion(draft.emotion);
      if (typeof draft.speed === 'number' && draft.speed >= 0.7 && draft.speed <= 1.5) setSpeed(draft.speed);
      if (typeof draft.pitch === 'number' && draft.pitch >= -5 && draft.pitch <= 5) setPitch(draft.pitch);
      if (draft.kabyleRegion && VALID_KABYLE_REGIONS.includes(draft.kabyleRegion)) setKabyleRegion(draft.kabyleRegion);
      if (draft.targetDuration) setTargetDuration(draft.targetDuration);
      if (draft.aspectRatio) setAspectRatio(draft.aspectRatio);
      if (typeof draft.userPrompt === 'string') setUserPrompt(draft.userPrompt);
      if (draft.activeProjectId) setProjectId(draft.activeProjectId);

      if (Array.isArray(draft.assets) && draft.assets.length > 0) {
        const hydrated: UploadedAsset[] = draft.assets.map((a) => ({
          ...a,
          previewUrl: a.file ? URL.createObjectURL(a.file) : undefined
        }));
        setUploadedAssets(hydrated);

        if (
          draft.autoResumePipeline &&
          !autoResumeTriggeredRef.current &&
          Date.now() - draft.savedAt < 5 * 60 * 1000
        ) {
          autoResumeTriggeredRef.current = true;
          await clearCreatorDraftAutoResumeInIdb();
          setTimeout(() => {
            executePipelineInternal(hydrated, {
              dialect: draft.dialect || 'Algerian Arabic',
              voice: draft.voice || 'Puck',
              gender: draft.gender || 'male',
              style: draft.style || 'Premium commercial',
              emotion: draft.emotion || 'neutral',
              speed: draft.speed ?? 1.0,
              pitch: draft.pitch ?? 0,
              kabyleRegion: draft.kabyleRegion || 'default',
              targetDuration: draft.targetDuration || 15,
              aspectRatio: draft.aspectRatio || '9:16',
              userPrompt: draft.userPrompt || '',
              resumeProjectId: draft.activeProjectId || '',
              resumeServerAssets: draft.serverAssets || []
            });
          }, 400);
        }
      }
    })();
  }, []);

  // Persist current draft to IndexedDB whenever files or settings change
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const strippedAssets = uploadedAssets.map(({ previewUrl, ...rest }) => rest);
    saveCreatorDraftToIdb({
      assets: strippedAssets,
      dialect,
      voice,
      gender,
      style,
      emotion,
      speed,
      pitch,
      kabyleRegion,
      targetDuration,
      aspectRatio,
      userPrompt,
      savedAt: Date.now()
    });
  }, [uploadedAssets, dialect, voice, gender, style, emotion, speed, pitch, kabyleRegion, targetDuration, aspectRatio, userPrompt]);

  const fetchStreamTokenForProject = async (targetProjectId: string): Promise<string> => {
    if (!targetProjectId || !user) return '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/video/${targetProjectId}/stream-token`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          credentials: 'include'
        });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') && res.ok) {
          const data = await res.json();
          if (data.token) {
            setStreamToken(data.token);
            if (data.exp) setStreamTokenExp(data.exp);
            return data.token;
          }
        } else {
          const text = await res.text();
          if (text.includes('Cookie check') && attempt === 1) {
            await recoverPreviewSessionInPlace();
            continue;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch creator stream token:', e);
      }
    }
    return '';
  };

  const handleDownloadVideo = async () => {
    if (!finalVideoUrl || isDownloading) return;
    setIsDownloading(true);
    setErrorMessage(null);
    try {
      let freshStreamTok = streamToken;
      if (projectId) {
        const refreshed = await fetchStreamTokenForProject(projectId);
        if (refreshed) freshStreamTok = refreshed;
      }

      const idToken = user ? await user.getIdToken() : '';
      const sep = finalVideoUrl.includes('?') ? '&' : '?';
      const downloadUrl = `${finalVideoUrl}${sep}download=true${freshStreamTok ? `&t=${encodeURIComponent(freshStreamTok)}` : ''}`;

      let response: Response | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
          },
          credentials: 'include'
        });

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (res.ok && ct.includes('video/mp4')) {
          response = res;
          break;
        }

        const text = await res.text();
        if (text.includes('Cookie check') && attempt === 1) {
          await recoverPreviewSessionInPlace();
          continue;
        }

        let errMsg = `Failed to download video (HTTP ${res.status}).`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error) errMsg = parsed.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      if (!response) {
        throw new Error('Could not download video file. Please try again.');
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 10_000) {
        throw new Error('Downloaded video file was incomplete. Please try again.');
      }

      const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `doudouvoice_ai_creator_${projectId ? projectId.slice(0, 8) : 'video'}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err: any) {
      console.error('Download Error:', err);
      setErrorMessage(err?.message || 'Failed to download MP4 video.');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (!projectId || !user || !streamTokenExp) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const delayMs = Math.max(60, streamTokenExp - nowSec - 60) * 1000;
    const timer = setTimeout(() => {
      fetchStreamTokenForProject(projectId);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [projectId, user, streamTokenExp]);

  const hydrateCompletedJobResult = async (targetProjectId: string, finalResult: any, partial?: any) => {
    await clearCreatorDraftAutoResumeInIdb();
    setProjectId(targetProjectId);
    await fetchStreamTokenForProject(targetProjectId);

    const analysis = finalResult?.analysis || partial?.analysis;
    const direction = finalResult?.creativeDirection || partial?.creativeDirection;
    const script = finalResult?.script || partial?.script;
    const plan = finalResult?.editingPlan || partial?.editingPlan;
    const reviewSummary = finalResult?.editingPlanReviewSummary || partial?.editingPlanReviewSummary;
    const inspection = finalResult?.finalInspection || partial?.finalInspection;
    const voiceVal = finalResult?.voiceValidation || partial?.voiceValidation;
    const validation = finalResult?.validation || partial?.validation;
    const repairs = finalResult?.repairHistory || partial?.repairHistory || [];
    const releaseStatus = finalResult?.finalReleaseStatus ||
      (finalResult?.technicalValidationPassed !== false &&
       (voiceVal ? voiceVal.valid !== false : true) &&
       (inspection ? inspection.decision === 'PASS' : true) &&
       (reviewSummary ? reviewSummary.finalDecision === 'APPROVED' : true)
        ? 'VERIFIED_AND_RELEASED'
        : 'UNAPPROVED_BEST_AVAILABLE');

    setActiveProvider(finalResult?.provider || script?.provider || 'meta');
    setActiveModel(finalResult?.model || script?.model || '');
    if (finalResult?.modelsUsed) setModelsUsed(finalResult.modelsUsed);
    if (analysis) setAnalysisData(analysis);
    if (direction) setCreativeDirection(direction);
    if (script) setScriptData(script);
    if (plan) setEditingPlan(plan);
    if (reviewSummary) {
      setEditingPlanReviewSummary(reviewSummary);
      setSelectedPlanVersionIndex(null);
    }
    if (inspection) setFinalInspection(inspection);
    if (voiceVal) setVoiceValidation(voiceVal);
    if (validation) setValidationData(validation);
    if (Array.isArray(repairs)) setRepairHistory(repairs);
    setFinalReleaseStatus(releaseStatus);
    setFinalVideoUrl(finalResult?.finalVideoUrl || `/api/creator/stream/${targetProjectId}/final`);
    setRenderedVia(finalResult?.renderedVia || 'Modal Cloud');
    setIsModalFallback(Boolean(finalResult?.isModalFallback));
    if (finalResult?.modalAppInfo) setModalAppInfo(finalResult.modalAppInfo);
    setCurrentStage(9);
    setErrorMessage(null);
    if (releaseStatus === 'VERIFIED_AND_RELEASED') {
      setStatusMessage('Video successfully created and verified!');
    } else if (inspection && inspection.decision !== 'PASS') {
      setStatusMessage('Render completed (Technical validation passed; Final AI inspection reported unresolved issues — best valid render preserved)');
    } else {
      setStatusMessage('Video rendered and passed final inspection (Editing Plan used best available version)');
    }
  };

  // Check for an active running job or recently completed job
  const checkAndRestoreActiveJob = async () => {
    if (!user) return false;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/creator/active-job', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        credentials: 'include'
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json') || !res.ok) return false;

      const data = await res.json();
      if (data?.hasActiveJob && data.job?.projectId) {
        // Reconnect to actively running job
        if (!isRunningRef.current) {
          executePipelineInternal([], {
            dialect,
            voice,
            targetDuration,
            aspectRatio,
            userPrompt,
            reconnectJob: data.job
          });
        }
        return true;
      } else if (data?.latestJob?.status === 'completed' && data.latestJob?.projectId) {
        // Restore the user's most recent completed video automatically
        await hydrateCompletedJobResult(
          data.latestJob.projectId,
          data.latestJob.result || { finalVideoUrl: `/api/creator/stream/${data.latestJob.projectId}/final` },
          data.latestJob.partial
        );
        return true;
      }
    } catch (e) {
      console.warn('[Creator] Failed to check active job:', e);
    }
    return false;
  };

  // Check on mount when user authenticates
  useEffect(() => {
    if (!user || activeJobCheckedRef.current) return;
    activeJobCheckedRef.current = true;
    checkAndRestoreActiveJob();
  }, [user]);

  const withStreamToken = (url?: string | null) => {
    if (!url || !streamToken) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}t=${encodeURIComponent(streamToken)}`;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      const previews: UploadedAsset[] = filesArray.map((f: File) => {
        const lowerName = f.name.toLowerCase();
        const isVideo = f.type.startsWith('video/') || ['.mp4', '.mov', '.webm', '.m4v'].some(ext => lowerName.endsWith(ext));
        return {
          id: `temp_${Math.random().toString(36).slice(2, 9)}`,
          type: isVideo ? 'video' : 'image',
          filePath: '',
          originalName: f.name,
          mimeType: f.type || (lowerName.endsWith('.mov') ? 'video/quicktime' : isVideo ? 'video/mp4' : 'image/jpeg'),
          previewUrl: URL.createObjectURL(f),
          file: f
        };
      });

      setUploadedAssets(prev => [...prev, ...previews]);
      e.target.value = '';
    }
  };

  const removeAsset = (id: string) => {
    setUploadedAssets(prev => prev.filter(a => a.id !== id));
  };

  const executePipelineInternal = async (
    assetsToProcess: UploadedAsset[],
    overrides?: {
      dialect?: string;
      voice?: string;
      gender?: 'male' | 'female';
      style?: string;
      emotion?: string;
      speed?: number;
      pitch?: number;
      kabyleRegion?: string;
      targetDuration?: number;
      aspectRatio?: '9:16' | '16:9' | '1:1';
      userPrompt?: string;
      resumeProjectId?: string;
      resumeServerAssets?: UploadedAsset[];
      reconnectJob?: any;
    }
  ) => {
    if (isRunningRef.current) {
      return;
    }

    const activeDialect = overrides?.dialect ?? dialect;
    const activeVoice = overrides?.voice ?? voice;
    const activeGender = overrides?.gender ?? gender;
    const activeStyle = overrides?.style ?? style;
    const activeEmotion = overrides?.emotion ?? emotion;
    const activeSpeed = overrides?.speed ?? speed;
    const activePitch = overrides?.pitch ?? pitch;
    const activeKabyleRegion = overrides?.kabyleRegion ?? kabyleRegion;
    const activeDuration = overrides?.targetDuration ?? targetDuration;
    const activeAspectRatio = overrides?.aspectRatio ?? aspectRatio;
    const activePrompt = overrides?.userPrompt ?? userPrompt;
    let reconnectedJob = overrides?.reconnectJob || null;

    if (!reconnectedJob) {
      if (assetsToProcess.length === 0) {
        setErrorMessage('Please upload at least one image or video clip.');
        return;
      }

      if (assetsToProcess.length > 10) {
        setErrorMessage('Maximum 10 media files allowed per video project.');
        return;
      }
    }

    isRunningRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);

    let activeProjectId = reconnectedJob?.projectId || overrides?.resumeProjectId || '';
    const serverAssets: UploadedAsset[] = overrides?.resumeServerAssets ? [...overrides.resumeServerAssets] : [];

    try {
      const getFreshToken = async () => (user ? await user.getIdToken() : '');
      let token = await getFreshToken();

      // Pre-warm proxy session before sending multipart uploads
      try {
        const prePing = await fetch(`/api/creator/ping?_t=${Date.now()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
          cache: 'no-store'
        });
        const preCt = prePing.headers.get('content-type') || '';
        if (!preCt.includes('application/json')) {
          const preText = await prePing.text();
          if (preText.includes('Cookie check')) {
            setStatusMessage('Refreshing preview session cookie...');
            await recoverPreviewSessionInPlace();
          }
        }
      } catch (_) {}

      // Resilient fetch + JSON parser that automatically handles AI Studio "Cookie check" challenges
      const fetchJsonWithRecovery = async (
        url: string,
        buildOptions: (authToken: string) => RequestInit,
        endpointName: string
      ) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const res = await fetch(url, {
            ...buildOptions(token),
            credentials: 'include'
          });

          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json();
            if (!res.ok) {
              throw new Error(data?.error || `Request to ${endpointName} failed with status ${res.status}`);
            }
            return data;
          }

          const text = await res.text();
          if (res.status === 413) {
            throw new Error('Upload payload too large (413). Each file must be 50MB or smaller.');
          }

          if (res.status === 429 || text.includes('Rate exceeded') || text.includes('Too Many Requests')) {
            const retryHeader = res.headers.get('Retry-After');
            const retrySec = retryHeader ? parseInt(retryHeader, 10) : 0;
            // For status and active-job queries, return structured throttled response immediately
            // so the outer polling loop can handle exponential backoff without burning retries in an inner loop
            if (endpointName.includes('/api/creator/status') || endpointName.includes('/api/creator/active-job')) {
              return {
                isThrottled: true,
                status: 429,
                retryAfterSec: retrySec > 0 ? retrySec : 6
              };
            }
            console.warn(`[Creator] Ingress proxy rate limit (429) on ${endpointName} (attempt ${attempt}/3). Backing off...`);
            setStatusMessage(`Waiting for proxy rate-limit window (${attempt}/3)...`);
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, (retrySec > 0 ? retrySec * 1000 : 3000 * attempt)));
              continue;
            }
          }

          if (text.includes('Cookie check')) {
            console.warn(`[Creator] Cookie check challenge on ${endpointName} (attempt ${attempt}/3). Attempting recovery...`);
            setStatusMessage(`Refreshing preview session (attempt ${attempt}/3)...`);
            const recovered = await recoverPreviewSessionInPlace();
            token = await getFreshToken();
            if (recovered || attempt < 3) {
              await new Promise(r => setTimeout(r, 800 * attempt));
              continue;
            }

            // All in-place attempts still got Cookie check: persist state & reload top-level iframe once
            const strippedAssets = assetsToProcess.map(({ previewUrl, ...rest }) => rest);
            await saveCreatorDraftToIdb({
              assets: strippedAssets,
              dialect: activeDialect,
              voice: activeVoice,
              targetDuration: activeDuration,
              aspectRatio: activeAspectRatio,
              userPrompt: activePrompt,
              autoResumePipeline: true,
              activeProjectId,
              serverAssets,
              savedAt: Date.now()
            });
            setStatusMessage('Reconnecting AI Studio session — your files are saved and will resume automatically...');
            setTimeout(() => {
              window.location.reload();
            }, 350);
            throw new Error('Reconnecting preview session cookies — reloading and resuming automatically...');
          }

          const cleanText = text.replace(/<[^>]*>/g, '').trim().slice(0, 150);
          throw new Error(`Server returned non-JSON response from ${endpointName} (${res.status}): ${cleanText || 'Unexpected format'}`);
        }
      };

      // Before uploading any new files, check if this user already has an active job running on the server
      if (!reconnectedJob) {
        try {
          const activeCheck = await fetchJsonWithRecovery(
            '/api/creator/active-job',
            (authToken) => ({
              method: 'GET',
              headers: {
                Accept: 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              }
            }),
            '/api/creator/active-job'
          );
          if (activeCheck?.hasActiveJob && activeCheck.job?.projectId) {
            reconnectedJob = activeCheck.job;
            activeProjectId = activeCheck.job.projectId;
          }
        } catch (_) {}
      }

      let finalResult: any = null;

      if (reconnectedJob && activeProjectId) {
        setProjectId(activeProjectId);
        const initialStage =
          typeof reconnectedJob.stage === 'number' && reconnectedJob.stage >= 2 && reconnectedJob.stage <= 8
            ? reconnectedJob.stage
            : 2;
        setCurrentStage(initialStage);
        setStatusMessage(reconnectedJob.statusMessage || 'Reconnected to active pipeline run...');
        if (reconnectedJob.partial) {
          if (reconnectedJob.partial.analysis) setAnalysisData(reconnectedJob.partial.analysis);
          if (reconnectedJob.partial.creativeDirection) setCreativeDirection(reconnectedJob.partial.creativeDirection);
          if (reconnectedJob.partial.script) setScriptData(reconnectedJob.partial.script);
          if (reconnectedJob.partial.editingPlan) setEditingPlan(reconnectedJob.partial.editingPlan);
          if (reconnectedJob.partial.editingPlanReviewSummary) setEditingPlanReviewSummary(reconnectedJob.partial.editingPlanReviewSummary);
          if (reconnectedJob.partial.finalInspection) setFinalInspection(reconnectedJob.partial.finalInspection);
          if (reconnectedJob.partial.repairHistory) setRepairHistory(reconnectedJob.partial.repairHistory);
        }
        if (reconnectedJob.status === 'completed' && reconnectedJob.result) {
          finalResult = reconnectedJob.result;
        }
      } else {
        setFinalVideoUrl(null);
        setCurrentStage(1);
        setStatusMessage('Uploading media assets...');

        // Step 1: Upload assets sequentially in 4MB chunks so requests pass cleanly through Cloud Run proxy
        const CHUNK_THRESHOLD_BYTES = 4 * 1024 * 1024;
        const CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

        for (let i = serverAssets.length; i < assetsToProcess.length; i++) {
          const item = assetsToProcess[i];
          const file = item.file;
          if (!file) {
            if (item.filePath) {
              serverAssets.push(item);
            }
            continue;
          }

          if (file.size > 50 * 1024 * 1024) {
            throw new Error(`File "${file.name}" exceeds the 50MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
          }

          setStatusMessage(`Uploading media asset ${i + 1} of ${assetsToProcess.length} (${file.name})...`);

          if (file.size > CHUNK_THRESHOLD_BYTES) {
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
            const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

            for (let c = 0; c < totalChunks; c++) {
              const start = c * CHUNK_SIZE_BYTES;
              const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
              const slice = file.slice(start, end);

              setStatusMessage(`Uploading ${file.name} (part ${c + 1}/${totalChunks})...`);

              const chunkData = await fetchJsonWithRecovery(
                '/api/creator/upload-chunk',
                (authToken) => {
                  const chunkForm = new FormData();
                  if (activeProjectId) chunkForm.append('projectId', activeProjectId);
                  chunkForm.append('uploadId', uploadId);
                  chunkForm.append('chunkIndex', String(c));
                  chunkForm.append('totalChunks', String(totalChunks));
                  chunkForm.append('originalName', file.name);
                  chunkForm.append('mimeType', item.mimeType || file.type || 'video/mp4');
                  chunkForm.append('chunk', slice, file.name);
                  return {
                    method: 'POST',
                    headers: {
                      Accept: 'application/json',
                      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
                    },
                    body: chunkForm
                  };
                },
                '/api/creator/upload-chunk'
              );

              if (chunkData.projectId) {
                activeProjectId = chunkData.projectId;
              }
              if (chunkData.completed && chunkData.asset) {
                serverAssets.push(chunkData.asset);
              }
            }
          } else {
            const uploadData = await fetchJsonWithRecovery(
              '/api/creator/upload-assets',
              (authToken) => {
                const formData = new FormData();
                if (activeProjectId) {
                  formData.append('projectId', activeProjectId);
                }
                formData.append('mediaFiles', file);
                return {
                  method: 'POST',
                  headers: {
                    Accept: 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
                  },
                  body: formData
                };
              },
              '/api/creator/upload-assets'
            );

            if (uploadData.projectId) {
              activeProjectId = uploadData.projectId;
            }
            if (Array.isArray(uploadData.assets)) {
              serverAssets.push(...uploadData.assets);
            }
          }
        }

        if (!activeProjectId || serverAssets.length === 0) {
          throw new Error('No valid media assets were uploaded.');
        }

        setProjectId(activeProjectId);

        // Step 2-6: Execute Full Meta + FFmpeg Pipeline via Async Job + Status Polling
        setCurrentStage(2);
        setStatusMessage('Stage A: Meta AI multimodal vision analysis & subject focus...');

        try {
          const startResponse = await fetchJsonWithRecovery(
            '/api/creator/pipeline-all',
            (authToken) => ({
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              },
              body: JSON.stringify({
                projectId: activeProjectId,
                assets: serverAssets,
                dialect: activeDialect,
                voice: activeVoice,
                gender: activeGender,
                style: activeStyle,
                emotion: activeEmotion,
                speed: activeSpeed,
                pitch: activePitch,
                kabyleRegion: activeDialect === 'Algerian Kabyle (Taqbaylit)' ? activeKabyleRegion : undefined,
                durationSec: activeDuration,
                aspectRatio: activeAspectRatio,
                userPrompt: activePrompt,
                async: true
              })
            }),
            '/api/creator/pipeline-all'
          );

          if (startResponse?.finalVideoUrl) {
            finalResult = startResponse;
          }
        } catch (startErr: any) {
          const msg = String(startErr?.message || '');
          if (
            !msg.includes('non-JSON response') &&
            !msg.includes('Failed to fetch') &&
            !msg.includes('NetworkError')
          ) {
            throw startErr;
          }
          console.warn('Initial pipeline-all connection interrupted; falling back to status polling...', msg);
        }
      }

      // Poll /api/creator/status/:projectId until completed or failed
      let consecutivePollErrors = 0;
      const maxWaitMs = 15 * 60 * 1000; // 15 minutes max render wait
      let pollStartTime = Date.now();
      let lastPartial: any = reconnectedJob?.partial || null;
      let pollCount = 0;

      while (!finalResult && Date.now() - pollStartTime < maxWaitMs) {
        pollCount++;
        // Progressive polling intervals:
        // 5.0s during analysis/script stages, 7.5s during video render
        // When throttled, back off progressively (up to 18s) to let ingress proxy rate limit reset
        const baseInterval = currentStage >= 6 ? 7500 : 5000;
        const pollInterval = consecutivePollErrors > 0
          ? Math.min(18000, 6000 + consecutivePollErrors * 2500)
          : baseInterval;

        await new Promise(r => setTimeout(r, pollInterval));

        try {
          token = await getFreshToken();
          const statusData = await fetchJsonWithRecovery(
            `/api/creator/status/${encodeURIComponent(activeProjectId)}`,
            (authToken) => ({
              method: 'GET',
              headers: {
                Accept: 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              }
            }),
            `/api/creator/status/${activeProjectId}`
          );

          if (statusData?.isThrottled) {
            consecutivePollErrors++;
            const backoffSec = Math.max(statusData.retryAfterSec || 6, Math.min(20, 6 + consecutivePollErrors * 3));
            console.warn(`[Creator] Ingress proxy throttled status check (${consecutivePollErrors}). Backing off for ${backoffSec}s...`);
            setStatusMessage(`Video is rendering safely on server — waiting ${backoffSec}s for status window...`);
            await new Promise(r => setTimeout(r, backoffSec * 1000));
            continue;
          }

          consecutivePollErrors = 0;

          if (typeof statusData.stage === 'number' && statusData.stage >= 2 && statusData.stage <= 8) {
            setCurrentStage(statusData.stage);
          }
          if (statusData.statusMessage) {
            setStatusMessage(statusData.statusMessage);
          }
          if (statusData.partial) {
            lastPartial = statusData.partial;
            if (statusData.partial.analysis) setAnalysisData(statusData.partial.analysis);
            if (statusData.partial.creativeDirection) setCreativeDirection(statusData.partial.creativeDirection);
            if (statusData.partial.script) setScriptData(statusData.partial.script);
            if (statusData.partial.editingPlan) setEditingPlan(statusData.partial.editingPlan);
            if (statusData.partial.editingPlanReviewSummary) setEditingPlanReviewSummary(statusData.partial.editingPlanReviewSummary);
            if (statusData.partial.voiceValidation) setVoiceValidation(statusData.partial.voiceValidation);
            if (statusData.partial.finalInspection) setFinalInspection(statusData.partial.finalInspection);
            if (statusData.partial.repairHistory) setRepairHistory(statusData.partial.repairHistory);
          }

          if (statusData.status === 'completed' && statusData.result) {
            finalResult = statusData.result;
            break;
          }

          if (statusData.status === 'failed') {
            throw new Error(statusData.error || statusData.result?.error || 'Pipeline execution failed');
          }

          // If backend job is still actively running and nearing the 15m window, extend window so active FFmpeg renders are not cut off
          if (statusData.status === 'running' && Date.now() - pollStartTime > maxWaitMs - 15_000) {
            pollStartTime = Date.now() - (maxWaitMs - 120_000);
          }
        } catch (pollErr: any) {
          const pMsg = String(pollErr?.message || '');
          const isTransient =
            pMsg.includes('non-JSON response') ||
            pMsg.includes('Failed to fetch') ||
            pMsg.includes('NetworkError') ||
            pMsg.includes('Load failed') ||
            pMsg.includes('Rate exceeded') ||
            pMsg.includes('429');

          if (!isTransient) {
            throw pollErr;
          }

          consecutivePollErrors++;
          console.warn(`Transient status poll warning (${consecutivePollErrors}):`, pMsg);
          setStatusMessage(`Checking video render progress (${consecutivePollErrors})...`);

          // Check /api/creator/active-job fallback every 2nd transient warning
          if (consecutivePollErrors % 2 === 0) {
            try {
              const checkIdTok = await getFreshToken();
              const ajRes = await fetch('/api/creator/active-job', {
                method: 'GET',
                headers: {
                  Accept: 'application/json',
                  ...(checkIdTok ? { Authorization: `Bearer ${checkIdTok}` } : {})
                },
                credentials: 'include'
              });
              if (ajRes.ok) {
                const ajData = await ajRes.json();
                if (ajData?.latestJob?.status === 'completed' && ajData.latestJob?.projectId === activeProjectId) {
                  finalResult = ajData.latestJob.result;
                  lastPartial = ajData.latestJob.partial || lastPartial;
                  break;
                }
              }
            } catch (_) {}
          }

          if (consecutivePollErrors >= 25) {
            throw new Error('Connection temporarily paused by server rate limit. Your video is rendering in the background — click "Check Status & Restore Video" or refresh to view it.');
          }
        }
      }

      if (!finalResult) {
        throw new Error('Video rendering timed out waiting for completion.');
      }

      await hydrateCompletedJobResult(activeProjectId, finalResult, lastPartial);
    } catch (err: any) {
      console.error('Pipeline Error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during pipeline execution');
    } finally {
      isRunningRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleStartPipeline = async () => {
    await executePipelineInternal(uploadedAssets);
  };

  const stages = [
    { title: 'Upload Assets', desc: 'Preparing original media' },
    { title: 'Asset Analysis', desc: 'Muse Spark 1.2 Contributor vision & focus' },
    { title: 'Creative Direction', desc: 'Campaign concept & visual rhythm' },
    { title: 'Editing Plan & Review', desc: '1.2 Contributor ↔ 1.1 Reviewer (max 5x)' },
    { title: 'Script & Voice', desc: 'DoudouVoice Studio TTS narration' },
    { title: 'Modal / FFmpeg Render', desc: 'Timeline execution & technical check' },
    { title: 'Final AI Inspection', desc: 'Muse Spark 1.1 frame inspection & repair' },
    { title: 'Final Video Release', desc: 'Verified commercial MP4 delivery' }
  ];

  return (
    <div className="min-h-screen w-full bg-[#050505] text-[#e0e0e0] p-6 lg:p-10 flex flex-col gap-8">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-widest flex items-center gap-1.5 ${
                activeProvider === 'gemini-fallback'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-brand-500/20 text-brand-400 border-brand-500/30'
              }`}
              title={activeModel || undefined}
            >
              <Sparkles size={13} />
              {activeProvider === 'gemini-fallback' ? 'Gemini fallback' : 'Meta Muse Spark'}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 uppercase tracking-widest">
              BETA
            </span>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold border flex items-center gap-1.5 ${
                modalStatus?.configured
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}
              title={`Modal App: ${modalStatus?.appName || 'doudouvoice-media-edit'} • Function: ${modalStatus?.functionName || 'edit_media'} • Workspace: ${modalStatus?.workspace || 'abdelwadoudamirouche7'} (${modalStatus?.environment || 'main'}) • App ID: ${modalStatus?.expectedAppId || 'ap-PNNq10tlmnZUC85lShUIiM'}`}
            >
              <Cpu size={12} />
              Modal: {modalStatus?.appName || 'doudouvoice-media-edit'}.{modalStatus?.functionName || 'edit_media'}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white mt-2 flex items-center gap-3 tracking-tight">
            AI Video Creator
          </h1>
          <p className="text-sm text-white/50 mt-1 max-w-2xl">
            Autonomous end-to-end video ad creation powered by multimodal intelligence, subject focus (LLM-estimated), expressive DoudouVoice dialect TTS, and Modal Cloud FFmpeg rendering (<code className="text-white/70 font-mono text-xs">doudouvoice-media-edit / edit_media</code>).
          </p>
        </div>

        {finalVideoUrl && (
          <button
            type="button"
            onClick={handleDownloadVideo}
            disabled={isDownloading}
            className="px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-brand-500/25 transition-all self-start lg:self-auto cursor-pointer"
          >
            {isDownloading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Preparing Mac MP4...
              </>
            ) : (
              <>
                <Download size={18} />
                Download Final MP4
              </>
            )}
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldAlert size={20} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              const restored = await checkAndRestoreActiveJob();
              if (!restored && projectId) {
                try {
                  const idTok = user ? await user.getIdToken() : '';
                  const stRes = await fetch(`/api/creator/status/${encodeURIComponent(projectId)}`, {
                    headers: { Accept: 'application/json', ...(idTok ? { Authorization: `Bearer ${idTok}` } : {}) },
                    credentials: 'include'
                  });
                  if (stRes.ok) {
                    const stData = await stRes.json();
                    if (stData.status === 'completed' && stData.result) {
                      await hydrateCompletedJobResult(projectId, stData.result, stData.partial);
                    }
                  }
                } catch (_) {}
              }
            }}
            className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs shrink-0 transition-colors shadow self-start sm:self-auto cursor-pointer"
          >
            Check Status &amp; Restore Video
          </button>
        </div>
      )}

      {/* Grid Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Media Uploads & Settings (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Asset Upload Box */}
          <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/10 flex flex-col gap-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <Upload size={16} className="text-brand-400" />
              1. Upload Media Assets (Images & Videos)
            </h2>

            <label className="border-2 border-dashed border-white/15 hover:border-brand-500/50 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-white/[0.02] hover:bg-white/[0.04]">
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={handleFileSelect}
                className="hidden"
                disabled={isProcessing}
              />
              <div className="p-3 rounded-full bg-brand-500/10 text-brand-400 mb-2">
                <Clapperboard size={24} />
              </div>
              <span className="text-sm font-semibold text-white">Click to select photos or video clips</span>
              <span className="text-xs text-white/40 mt-1">Supports PNG, JPG, MP4, MOV (Multiple assets)</span>
            </label>

            {/* Uploaded Asset Thumbnails */}
            {uploadedAssets.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                {uploadedAssets.map(asset => (
                  <div key={asset.id} className="relative group rounded-lg overflow-hidden bg-white/5 border border-white/10 aspect-video flex items-center justify-center">
                    {asset.type === 'video' ? (
                      <video src={asset.previewUrl} className="w-full h-full object-cover" />
                    ) : (
                      <img src={asset.previewUrl} alt={asset.originalName} className="w-full h-full object-cover" />
                    )}
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] text-white/80 font-mono flex items-center gap-1 uppercase">
                      {asset.type === 'video' ? <Video size={10} /> : <ImageIcon size={10} />}
                      {asset.type}
                    </span>
                    {!isProcessing && (
                      <button
                        onClick={() => removeAsset(asset.id)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Target Parameters Box */}
          <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/10 flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white/80 flex items-center gap-2">
                <Sliders size={16} className="text-brand-400" />
                2. Campaign &amp; Studio Voice Configuration
              </h2>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 font-bold flex items-center gap-1">
                <Mic2 size={11} /> DoudouVoice Studio Engine
              </span>
            </div>

            {/* A. Language & Dialect */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white/70 flex items-center gap-1.5">
                  <span>Language / Dialect</span>
                  <span className="text-brand-400 text-[10px] font-mono">({STUDIO_DIALECTS.length} available)</span>
                </label>
                <span className="text-xs">{getDialectFlag(dialect)}</span>
              </div>
              <select
                value={dialect}
                onChange={e => {
                  const newDialect = e.target.value;
                  setDialect(newDialect);
                }}
                disabled={isProcessing}
                className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-medium text-white focus:outline-none focus:border-brand-500 transition-colors cursor-pointer"
              >
                {STUDIO_DIALECTS.map(d => (
                  <option key={d} value={d} className="bg-black text-white">
                    {getDialectFlag(d)} {d}
                  </option>
                ))}
              </select>
            </div>

            {/* Kabyle Regional Variant (Visible when Taqbaylit is selected) */}
            {dialect === 'Algerian Kabyle (Taqbaylit)' && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold">
                  <Info size={14} className="shrink-0" />
                  <span>Kabyle Regional Variant / Taqbaylit Accent</span>
                </div>
                <select
                  value={kabyleRegion}
                  onChange={e => setKabyleRegion(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-black/60 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-100 focus:outline-none focus:border-amber-400"
                >
                  {VALID_KABYLE_REGIONS.map(regId => {
                    const info = KABYLE_REGIONS[regId];
                    return (
                      <option key={regId} value={regId} className="bg-black text-white">
                        {info.labelEn} ({info.labelAr})
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-amber-200/70 leading-relaxed">
                  {KABYLE_REGIONS[kabyleRegion]?.hint || 'Balanced Taqbaylit phonology with native phonemes and regional cadence.'}
                </p>
              </div>
            )}

            {/* B & C. Voice Profile & Selection */}
            <div className="flex flex-col gap-3 pt-1 border-t border-white/5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-white/70 flex items-center gap-1.5">
                  <User size={13} className="text-brand-400" />
                  <span>Voice Gender &amp; Persona</span>
                </label>

                {/* Gender Toggle */}
                <div className="inline-flex rounded-lg bg-black/60 p-0.5 border border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      if (gender !== 'male') {
                        setGender('male');
                        setVoice(STUDIO_VOICES.male[0]);
                      }
                    }}
                    disabled={isProcessing}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      gender === 'male'
                        ? 'bg-brand-500 text-black shadow-sm font-bold'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Male
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (gender !== 'female') {
                        setGender('female');
                        setVoice(STUDIO_VOICES.female[0]);
                      }
                    }}
                    disabled={isProcessing}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      gender === 'female'
                        ? 'bg-brand-500 text-black shadow-sm font-bold'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    Female
                  </button>
                </div>
              </div>

              {/* Voice Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {STUDIO_VOICES[gender].map(v => {
                  const isSelected = voice === v;
                  const isPreviewing = previewingVoice === v;
                  const desc = STUDIO_VOICE_DESCRIPTIONS[v];

                  return (
                    <div
                      key={v}
                      onClick={() => setVoice(v)}
                      className={`relative p-3 rounded-xl border flex flex-col justify-between gap-2 text-left cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-brand-500/10 border-brand-500 shadow-[0_0_15px_rgba(245,158,11,0.15)] ring-1 ring-brand-500/50'
                          : 'bg-[#121212] border-white/10 hover:border-white/20 text-white/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              isSelected ? 'bg-brand-500 text-black' : 'bg-white/10 text-white/70'
                            }`}
                          >
                            {v[0]}
                          </div>
                          <span className="text-xs font-bold text-white tracking-wide">{v}</span>
                        </div>
                        {desc?.tag && (
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold ${
                              isSelected
                                ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                                : 'bg-white/5 text-white/50 border border-white/5'
                            }`}
                          >
                            {desc.tag}
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] text-white/50 line-clamp-2 leading-relaxed">
                        {desc?.labelEn || 'Expressive studio voice'}
                      </p>

                      <div className="flex items-center justify-between pt-1 border-t border-white/5">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            isSelected ? 'text-brand-400' : 'text-white/30'
                          }`}
                        >
                          {isSelected ? 'Active Voice' : 'Select'}
                        </span>

                        {/* Inline Audio Preview Button */}
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handlePreviewVoice(v);
                          }}
                          disabled={isPreviewLoading && previewingVoice === v}
                          className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center gap-1 text-[10px] ${
                            isPreviewing
                              ? 'bg-brand-500 text-black border-brand-500 font-bold'
                              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/80 hover:text-white'
                          }`}
                          title={`Preview ${v} voice in ${dialect}`}
                        >
                          {isPreviewLoading && previewingVoice === v ? (
                            <Loader2 size={12} className="animate-spin text-brand-400" />
                          ) : isPreviewing ? (
                            <>
                              <Pause size={12} />
                              <span>Playing</span>
                            </>
                          ) : (
                            <>
                              <Play size={12} />
                              <span>Sample</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* D & E. Voice Style & Emotion Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-white/5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-white/70 block">Voice Delivery Style</label>
                <select
                  value={style}
                  onChange={e => setStyle(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500 cursor-pointer"
                >
                  {STUDIO_STYLES.map(s => (
                    <option key={s} value={s} className="bg-black text-white">
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-white/70 block">Emotional Delivery / Intensity</label>
                <select
                  value={emotion}
                  onChange={e => setEmotion(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500 cursor-pointer"
                >
                  {STUDIO_EMOTIONS.map(emo => (
                    <option key={emo.id} value={emo.id} className="bg-black text-white">
                      {emo.labelEn} ({emo.labelAr})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* F. Fine-Tuning Controls (Speed & Pitch Sliders) */}
            <div className="rounded-xl bg-[#121212] border border-white/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFineTuning(!showFineTuning)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Sliders size={13} className="text-brand-400" />
                  <span>Voice Fine-Tuning Controls</span>
                  {(speed !== 1 || pitch !== 0) && (
                    <span className="px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 text-[10px] font-mono">
                      {speed.toFixed(2)}x / {pitch > 0 ? `+${pitch}` : pitch}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-white/50">
                  <span>{showFineTuning ? 'Hide Sliders' : 'Fine-Tune Speed & Pitch'}</span>
                  {showFineTuning ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>

              {showFineTuning && (
                <div className="p-4 border-t border-white/5 flex flex-col gap-4 bg-black/30">
                  {/* Speed Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/70 font-medium">Speaking Pace / Speed</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-brand-400 font-bold text-xs">{speed.toFixed(2)}x</span>
                        {speed !== 1.0 && (
                          <button
                            type="button"
                            onClick={() => setSpeed(1.0)}
                            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                            title="Reset speed to 1.0x"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0.8}
                      max={1.25}
                      step={0.05}
                      value={speed}
                      onChange={e => setSpeed(parseFloat(e.target.value))}
                      disabled={isProcessing}
                      className="w-full accent-brand-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-white/40 font-mono">
                      <span>0.80x (Calm)</span>
                      <span>1.00x (Natural)</span>
                      <span>1.25x (Energetic)</span>
                    </div>
                  </div>

                  {/* Pitch Slider */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/70 font-medium">Vocal Pitch Adjustment</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-brand-400 font-bold text-xs">
                          {pitch > 0 ? `+${pitch}` : pitch === 0 ? '0 (Natural)' : pitch}
                        </span>
                        {pitch !== 0 && (
                          <button
                            type="button"
                            onClick={() => setPitch(0)}
                            className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                            title="Reset pitch to 0"
                          >
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-5}
                      max={5}
                      step={1}
                      value={pitch}
                      onChange={e => setPitch(parseInt(e.target.value, 10))}
                      disabled={isProcessing}
                      className="w-full accent-brand-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-white/40 font-mono">
                      <span>-5 (Deeper Resonance)</span>
                      <span>0 (Natural)</span>
                      <span>+5 (Lighter / Brighter)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Target Duration & Aspect Ratio */}
            <div className="grid grid-cols-2 gap-4 pt-1 border-t border-white/5">
              <div>
                <label className="text-xs font-semibold text-white/70 mb-1.5 block">Target Duration</label>
                <select
                  value={targetDuration}
                  onChange={e => setTargetDuration(Number(e.target.value))}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500 cursor-pointer"
                >
                  <option value={10}>10 Seconds (Quick Hook)</option>
                  <option value={15}>15 Seconds (TikTok / Reel)</option>
                  <option value={30}>30 Seconds (Commercial Ad)</option>
                  <option value={60}>60 Seconds (Full Showcase)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/70 mb-1.5 block">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={e => setAspectRatio(e.target.value as any)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500 cursor-pointer"
                >
                  <option value="9:16">9:16 Vertical (Reels / TikTok)</option>
                  <option value="16:9">16:9 Horizontal (YouTube)</option>
                  <option value="1:1">1:1 Square (Feed)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-white/60 mb-1.5 block">Creative Brief / Notes (Optional)</label>
              <textarea
                value={userPrompt}
                onChange={e => setUserPrompt(e.target.value)}
                placeholder="e.g. Focus on product durability, water resistance, fast shipping, and promo discount..."
                disabled={isProcessing}
                rows={3}
                className="w-full bg-[#121212] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-white/30 focus:outline-none focus:border-brand-500 resize-none"
              />
            </div>

            <button
              onClick={handleStartPipeline}
              disabled={isProcessing || uploadedAssets.length === 0}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 font-bold text-sm text-white flex items-center justify-center gap-2 shadow-lg shadow-brand-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Generating AI Video...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Generate AI Video with Meta & Modal
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Pipeline Stepper, JSON Previews & Video Player (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Stepper Status Box */}
          <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/10 flex flex-col gap-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <Cpu size={16} className="text-brand-400" />
              Pipeline Execution Status
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {stages.map((st, idx) => {
                const stageNum = idx + 1;
                const isDone = currentStage > stageNum;
                const isCurrent = currentStage === stageNum;

                return (
                  <div
                    key={st.title}
                    className={`p-3 rounded-xl border flex flex-col gap-1 transition-colors ${
                      isDone
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : isCurrent
                        ? 'bg-brand-500/15 border-brand-500/50 text-brand-300'
                        : 'bg-white/[0.02] border-white/10 text-white/40'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span>Step {stageNum}</span>
                      {isDone ? (
                        <CheckCircle2 size={14} />
                      ) : isCurrent ? (
                        <Loader2 size={14} className="animate-spin text-brand-400" />
                      ) : null}
                    </div>
                    <span className="text-xs font-semibold leading-tight">{st.title}</span>
                    <span className="text-[10px] opacity-70 leading-tight">{st.desc}</span>
                  </div>
                );
              })}
            </div>

            {statusMessage && (
              <p className="text-xs font-mono text-brand-400 bg-brand-500/10 border border-brand-500/20 px-3 py-2 rounded-lg">
                &gt; {statusMessage}
              </p>
            )}
          </div>

          {/* Final Video Render Player */}
          {finalVideoUrl && (
            <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-brand-500/40 flex flex-col gap-4 shadow-xl shadow-brand-500/10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-brand-400 flex items-center gap-2">
                    <Film size={18} />
                    Final Rendered Commercial Video
                  </h2>
                  {finalReleaseStatus === 'VERIFIED_AND_RELEASED' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Verified &amp; Released
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                      <ShieldAlert size={12} /> Best Available (Unapproved)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white/80 bg-white/5 px-2.5 py-1 rounded border border-white/10">
                    Engine: {renderedVia === 'Modal Cloud' ? `☁️ Modal Cloud (${modalAppInfo?.appName || 'doudouvoice-media-edit'}.${modalAppInfo?.functionName || 'edit_media'})` : isModalFallback ? '⚙️ Local Server FFmpeg (Modal Fallback)' : '⚙️ Local Server FFmpeg (Dedicated Engine)'}
                  </span>
                </div>
              </div>

              {/* 5 Distinct Pipeline Verification Statuses */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                <div
                  className={`p-2 rounded-lg border flex items-center justify-between ${
                    voiceValidation?.valid !== false
                      ? 'bg-emerald-500/10 border-emerald-500/25'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}
                >
                  <span className="text-white/70 font-medium">Voice Validation</span>
                  <span
                    className={`font-mono font-bold ${
                      voiceValidation?.valid !== false ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {voiceValidation?.valid !== false ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
                  <span className="text-white/70 font-medium">Render Completion</span>
                  <span className="font-mono font-bold text-emerald-400">YES</span>
                </div>
                <div
                  className={`p-2 rounded-lg border flex items-center justify-between ${
                    validationData?.valid !== false
                      ? 'bg-emerald-500/10 border-emerald-500/25'
                      : 'bg-red-500/10 border-red-500/30'
                  }`}
                >
                  <span className="text-white/70 font-medium">Tech Validation</span>
                  <span
                    className={`font-mono font-bold ${
                      validationData?.valid !== false ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {validationData?.valid !== false ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div
                  className={`p-2 rounded-lg border flex items-center justify-between ${
                    finalInspection?.decision === 'PASS'
                      ? 'bg-emerald-500/10 border-emerald-500/25'
                      : 'bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  <span className="text-white/70 font-medium">AI Visual Inspect</span>
                  <span
                    className={`font-mono font-bold ${
                      finalInspection?.decision === 'PASS' ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {finalInspection?.decision || 'PASS'}
                  </span>
                </div>
                <div
                  className={`p-2 rounded-lg border flex items-center justify-between ${
                    finalReleaseStatus === 'VERIFIED_AND_RELEASED'
                      ? 'bg-emerald-500/10 border-emerald-500/25'
                      : 'bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  <span className="text-white/70 font-medium">Final Release</span>
                  <span
                    className={`font-mono font-bold ${
                      finalReleaseStatus === 'VERIFIED_AND_RELEASED' ? 'text-emerald-400' : 'text-amber-300'
                    }`}
                  >
                    {finalReleaseStatus === 'VERIFIED_AND_RELEASED' ? 'VERIFIED' : 'UNAPPROVED'}
                  </span>
                </div>
              </div>

              {finalReleaseStatus === 'UNAPPROVED_BEST_AVAILABLE' && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
                  <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-bold text-amber-300 block">Unapproved / Best Available Render Notice</strong>
                    <span>
                      This video passed mandatory programmatic FFmpeg technical validation, but either the Editing Plan review loop (max 5 cycles) or post-render AI inspection (max 2 repair cycles) did not reach full approval. The highest-scoring technically valid version is preserved below.
                    </span>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-white/50 bg-white/[0.02] border border-white/5 px-3 py-1.5 rounded-lg">
                {renderedVia === 'Modal Cloud'
                  ? '☁️ Rendered using Modal Cloud serverless GPU worker.'
                  : isModalFallback
                  ? '⚙️ Rendered with local multi-threaded FFmpeg pipeline following Modal Cloud fallback. QuickTime H.264/AAC compatibility verified.'
                  : '⚙️ Rendered with local multi-threaded FFmpeg pipeline. QuickTime H.264/AAC compatibility verified.'}
              </p>

              <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-white/10">
                {streamToken && (
                  <video
                    src={withStreamToken(finalVideoUrl)}
                    controls
                    autoPlay
                    className="w-full h-full object-contain"
                  />
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/10">
                <div className="text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Format: <strong className="text-white font-mono">{aspectRatio} QuickTime MP4</strong></span>
                  <span>Video: <strong className="text-emerald-400 font-mono">H.264 (yuv420p)</strong></span>
                  <span>Audio: <strong className="text-emerald-400 font-mono">AAC (48kHz)</strong></span>
                  {validationData?.durationSec && (
                    <span>Duration: <strong className="text-emerald-400 font-mono">{Number(validationData.durationSec).toFixed(2)}s</strong></span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleDownloadVideo}
                  disabled={isDownloading}
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20 transition-all cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Preparing Mac MP4...
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      {finalReleaseStatus === 'VERIFIED_AND_RELEASED' ? 'Download Verified MP4' : 'Download Best Available MP4'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Interactive Inspection Drawers */}
          <div className="flex flex-col gap-3">
            {/* Stage B: Creative Direction Summary Card */}
            {creativeDirection && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-400 flex items-center gap-2">
                    <Compass size={15} />
                    Stage B: Meta Creative Direction Strategy
                  </span>
                  <span className="text-[11px] font-semibold text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20 uppercase">
                    {creativeDirection.campaignCategory || 'commercial'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px] uppercase font-bold mb-1">Visual Rhythm</span>
                    <span className="font-semibold text-white capitalize">{creativeDirection.visualRhythm || 'dynamic'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px] uppercase font-bold mb-1">Color Grading Theme</span>
                    <span className="font-semibold text-amber-300 capitalize">{creativeDirection.colorGradingTheme || 'vibrant'}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px] uppercase font-bold mb-1">Emotional Delivery</span>
                    <span className="font-semibold text-emerald-300">{creativeDirection.emotionalTone || 'Energetic'}</span>
                  </div>
                </div>

                <div className="text-xs text-white/70 bg-black/40 p-3 rounded-lg border border-white/5 flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-white/90">Creative Concept:</span>
                  <p>{creativeDirection.creativeConcept}</p>
                </div>
              </div>
            )}

            {/* Stage C: Expressive Voiceover Script Timeline with Audio Previews */}
            {scriptData && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowScriptJson(!showScriptJson)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/80 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <FileText size={15} className="text-brand-400" />
                    Step 5: Script &amp; Studio Voice Direction ({getDialectFlag(scriptData.dialect || dialect)} {scriptData.dialect || dialect} • {scriptData.voice || voice} • {scriptData.gender || gender})
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-brand-300 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">
                      {scriptData.segments?.length || 0} Segments
                    </span>
                    {showScriptJson ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {showScriptJson && (
                  <div className="p-4 bg-black/50 border-t border-white/10 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-white/5 text-[11px]">
                      <span className="text-white/50 text-[10px] uppercase font-bold tracking-wider">Voice Profile:</span>
                      <span className="px-2 py-0.5 rounded bg-white/5 text-white/90 font-medium flex items-center gap-1.5">
                        <span>{getDialectFlag(scriptData.dialect || dialect)}</span>
                        <span>{scriptData.dialect || dialect}</span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 font-medium border border-brand-500/20">
                        {scriptData.voice || voice} ({scriptData.gender || gender})
                      </span>
                      {scriptData.style && (
                        <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 font-medium border border-purple-500/20">
                          {scriptData.style}
                        </span>
                      )}
                      {scriptData.emotion && (
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 font-medium border border-blue-500/20">
                          Emotion: {scriptData.emotion}
                        </span>
                      )}
                      {scriptData.speed && (
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono">
                          Speed: {scriptData.speed}x
                        </span>
                      )}
                      {scriptData.pitch !== undefined && scriptData.pitch !== 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono">
                          Pitch: {scriptData.pitch > 0 ? `+${scriptData.pitch}` : scriptData.pitch}
                        </span>
                      )}
                      {scriptData.kabyleRegion && scriptData.kabyleRegion !== 'default' && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 font-medium border border-amber-500/20">
                          Region: {KABYLE_REGIONS[scriptData.kabyleRegion]?.labelEn || scriptData.kabyleRegion}
                        </span>
                      )}
                    </div>

                    {scriptData.segments && scriptData.segments.length > 0 ? (
                      <div className="flex flex-col gap-2.5">
                        {scriptData.segments.map((seg: any, idx: number) => {
                          const isRtl = /[\u0600-\u06FF]/.test(seg.text);
                          const emotionBadgeColor =
                            seg.emotion === 'excited' ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' :
                            seg.emotion === 'persuasive' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                            seg.emotion === 'friendly' || seg.emotion === 'warm' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                            'bg-blue-500/15 text-blue-300 border-blue-500/30';

                          return (
                            <div
                              key={seg.id || idx}
                              className="p-3.5 rounded-xl bg-[#111] border border-white/10 flex flex-col gap-2 transition-all hover:border-brand-500/30"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold text-white/60 bg-white/5 px-2 py-0.5 rounded">
                                    Segment {idx + 1}
                                  </span>
                                  {seg.role && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">
                                      {seg.role.replace('_', ' ')}
                                    </span>
                                  )}
                                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${emotionBadgeColor}`}>
                                    {seg.emotion || 'Standard'}
                                  </span>
                                  {seg.pace && (
                                    <span className="text-[10px] font-mono text-white/50 bg-white/5 px-1.5 py-0.5 rounded">
                                      Pace: {seg.pace}
                                    </span>
                                  )}
                                </div>

                                {seg.actualDurationSec && (
                                  <span className="text-[11px] font-mono text-emerald-400">
                                    {seg.actualDurationSec.toFixed(2)}s
                                  </span>
                                )}
                              </div>

                              <p className={`text-sm font-semibold text-white/95 leading-relaxed pt-1 ${isRtl ? 'text-right' : 'text-left'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                                {seg.text}
                              </p>

                              {seg.deliveryInstruction && (
                                <p className="text-[11px] text-white/40 italic">
                                  &gt; Voice Direction: {seg.deliveryInstruction}
                                </p>
                              )}

                              {seg.audioUrl && streamToken && (
                                <div className="pt-1 flex items-center gap-2">
                                  <audio
                                    src={withStreamToken(seg.audioUrl)}
                                    controls
                                    className="h-7 w-full max-w-xs rounded"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <pre className="text-xs font-mono text-purple-300 max-h-60 overflow-y-auto">
                        {JSON.stringify(scriptData, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Step 7: Post-Render Final AI Quality Inspection (muse-spark-1.1) & Repair Loop */}
            {finalInspection && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowInspectionDrawer(!showInspectionDrawer)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/85 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={15} className={finalInspection.decision === 'PASS' ? 'text-emerald-400' : 'text-amber-400'} />
                    Step 7: Post-Render AI Quality Inspection ({finalInspection.inspector_model || finalInspection.inspectorModel || modelsUsed?.inspector || 'muse-spark-1.1'})
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                        finalInspection.decision === 'PASS'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {finalInspection.decision} • {finalInspection.quality_score}/100
                    </span>
                    {repairHistory.length > 1 && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                        Repairs: {repairHistory.length - 1}/2
                      </span>
                    )}
                    {showInspectionDrawer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {showInspectionDrawer && (
                  <div className="p-4 bg-black/50 border-t border-white/10 flex flex-col gap-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/80 font-mono">
                          Inspector: {finalInspection.inspector_model || finalInspection.inspectorModel || 'muse-spark-1.1'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                          Basis: {finalInspection.inspectionBasis || 'sampled_frames'} ({finalInspection.sampledFramesCount ?? finalInspection.sampledFrameCount ?? 0} frames)
                        </span>
                        {Array.isArray(finalInspection.sampledFrameTimestampsSec) && finalInspection.sampledFrameTimestampsSec.length > 0 && (
                          <span className="text-white/50 font-mono text-[10px]">
                            Timestamps: [{finalInspection.sampledFrameTimestampsSec.map((t: number) => `${Number(t).toFixed(1)}s`).join(', ')}]
                          </span>
                        )}
                      </div>
                      <span className="text-white/50 font-mono text-[10px]">
                        Visual review is performed on representative sampled frames + programmatic FFmpeg stream analysis
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-[#111] border border-white/10 flex flex-col gap-1.5">
                        <span className="text-[10px] uppercase font-bold text-white/50">Observable Visual Findings (Sampled Frames)</span>
                        {Array.isArray(finalInspection.observable_visual_findings) && finalInspection.observable_visual_findings.length > 0 ? (
                          <ul className="list-disc list-inside text-white/80 space-y-0.5 text-[11px]">
                            {finalInspection.observable_visual_findings.map((f: string, idx: number) => (
                              <li key={idx}>{f}</li>
                            ))}
                          </ul>
                        ) : Array.isArray(finalInspection.technical_findings) ? (
                          <ul className="list-disc list-inside text-white/80 space-y-0.5 text-[11px]">
                            {finalInspection.technical_findings.map((f: string, idx: number) => (
                              <li key={idx}>{f}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-white/70 text-[11px]">{validationData?.summary || 'Technical stream check verified'}</p>
                        )}
                      </div>

                      <div className="p-3 rounded-lg bg-[#111] border border-white/10 flex flex-col gap-1.5">
                        <span className="text-[10px] uppercase font-bold text-white/50">Audio &amp; Non-Observable Stream Verification</span>
                        {Array.isArray(finalInspection.audio_findings) ? (
                          <ul className="list-disc list-inside text-white/80 space-y-0.5 text-[11px]">
                            {finalInspection.audio_findings.map((f: string, idx: number) => (
                              <li key={idx}>{f}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-white/70 text-[11px]">{voiceValidation?.summary || 'AAC narration stream synchronized'}</p>
                        )}
                        {Array.isArray(finalInspection.non_observable_from_frames) && finalInspection.non_observable_from_frames.length > 0 && (
                          <div className="mt-1 pt-1.5 border-t border-white/5 text-[10px] text-white/45">
                            <span className="font-semibold text-white/60">Verified via FFprobe/PCM (not frame-observable): </span>
                            {finalInspection.non_observable_from_frames.join(' • ')}
                          </div>
                        )}
                      </div>
                    </div>

                    {finalInspection.approval_reason && (
                      <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-white/80">
                        <strong className="text-white/95">Inspector Verdict: </strong>
                        {finalInspection.approval_reason}
                      </div>
                    )}

                    {Array.isArray(finalInspection.detected_issues) && finalInspection.detected_issues.length > 0 && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase text-amber-300">Detected Issues</span>
                        <ul className="list-disc list-inside text-amber-200/90 space-y-0.5">
                          {finalInspection.detected_issues.map((iss: string, i: number) => (
                            <li key={i}>{iss}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {repairHistory.length > 1 && (
                      <div className="p-3 rounded-lg bg-[#111] border border-white/10 flex flex-col gap-2">
                        <span className="text-[10px] font-bold uppercase text-purple-300">Post-Render Repair Loop History (Max 2 Repairs)</span>
                        <div className="flex flex-col gap-1.5">
                          {repairHistory.map((item: any, idx: number) => (
                            <div key={idx} className="p-2 rounded bg-black/50 border border-white/5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span className="font-mono text-white/80">
                                {item.repairCycle === 0 ? 'Initial Render' : `Repair Cycle #${item.repairCycle}`} ({item.renderedVia})
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${item.inspectionDecision === 'PASS' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                  {item.inspectionDecision} ({item.qualityScore}/100)
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Stage E: Multi-Model Editing Plan Review Loop (muse-spark-1.2-contributor ↔ muse-spark-1.1) */}
            {editingPlanReviewSummary && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowReviewDrawer(!showReviewDrawer)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/85 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles size={15} className="text-brand-400" />
                    Step 4: Editing Plan &amp; Senior Director Review ({editingPlanReviewSummary.contributorModel || 'muse-spark-1.2-contributor'} ↔ {editingPlanReviewSummary.reviewerModel || 'muse-spark-1.1'})
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-white/80 border border-white/10">
                      Cycles: {editingPlanReviewSummary.totalCyclesRun ?? editingPlanReviewSummary.cyclesRun ?? 1}/{editingPlanReviewSummary.maxCyclesAllowed || 5}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                        editingPlanReviewSummary.finalDecision === 'APPROVED'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}
                    >
                      {editingPlanReviewSummary.finalDecision === 'APPROVED' ? 'APPROVED' : 'BEST_AVAILABLE_UNAPPROVED'} • {editingPlanReviewSummary.finalQualityScore ?? editingPlanReviewSummary.finalScore ?? 0}/100
                    </span>
                    {showReviewDrawer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {showReviewDrawer && (
                  <div className="p-4 bg-black/50 border-t border-white/10 flex flex-col gap-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/5 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 border border-brand-500/20 font-mono">
                          Planner: {editingPlanReviewSummary.contributorModel || 'muse-spark-1.2-contributor'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
                          Reviewer: {editingPlanReviewSummary.reviewerModel || 'muse-spark-1.1'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white/5 text-white/70 font-mono">
                          Selected Version: v{editingPlanReviewSummary.selectedVersion}
                        </span>
                      </div>

                      {Array.isArray(editingPlanReviewSummary.versions) && editingPlanReviewSummary.versions.length > 1 && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-white/50 mr-1">Inspect Cycle:</span>
                          {editingPlanReviewSummary.versions.map((ver: any, idx: number) => {
                            const isSelected = (selectedPlanVersionIndex ?? (editingPlanReviewSummary.versions.length - 1)) === idx;
                            return (
                              <button
                                key={ver.version || idx}
                                type="button"
                                onClick={() => setSelectedPlanVersionIndex(idx)}
                                className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-brand-500 text-black font-bold border-brand-400'
                                    : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                                }`}
                              >
                                v{ver.version} ({ver.review?.quality_score ?? ver.review?.score ?? 0})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {(() => {
                      const versions = Array.isArray(editingPlanReviewSummary.versions) ? editingPlanReviewSummary.versions : [];
                      const activeVer = versions[selectedPlanVersionIndex ?? (versions.length - 1)] || versions[0];
                      const rev = activeVer?.review;
                      if (!rev) return null;
                      const scoreVal = rev.quality_score ?? rev.score ?? 0;
                      const issuesList = rev.issues || rev.issues_found || [];
                      const constraintsOk = activeVer.technicalConstraintValidation?.valid ?? activeVer.constraintValidation?.valid ?? true;

                      return (
                        <div className="flex flex-col gap-2.5">
                          <div className="p-2.5 rounded-lg bg-[#111] border border-white/10 flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white/90">
                                Cycle v{activeVer.version} Verdict ({rev.decision} • Score {scoreVal}/100)
                              </span>
                              <span className="text-[10px] font-mono text-white/50">
                                Technical Constraint Check: {constraintsOk ? 'VALID' : 'VIOLATION'}
                              </span>
                            </div>
                            <p className="text-white/70 text-[11px]">{rev.approval_reason}</p>
                          </div>

                          {Array.isArray(rev.strengths) && rev.strengths.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                              <span className="text-[10px] font-bold uppercase text-emerald-300 block mb-1">Strengths</span>
                              <ul className="list-disc list-inside text-emerald-200/90 space-y-0.5 text-[11px]">
                                {rev.strengths.map((s: string, i: number) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {Array.isArray(issuesList) && issuesList.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                              <span className="text-[10px] font-bold uppercase text-amber-300 block mb-1">Issues Found by Muse Spark 1.1</span>
                              <ul className="list-disc list-inside text-amber-200/90 space-y-0.5 text-[11px]">
                                {issuesList.map((iss: string, i: number) => (
                                  <li key={i}>{iss}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {Array.isArray(rev.required_changes) && rev.required_changes.length > 0 && (
                            <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                              <span className="text-[10px] font-bold uppercase text-purple-300 block mb-1">Required Revisions Sent to 1.2 Contributor</span>
                              <ul className="list-disc list-inside text-purple-200/90 space-y-0.5 text-[11px]">
                                {rev.required_changes.map((chg: string, i: number) => (
                                  <li key={i}>{chg}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Stage E: Meta Executable Editing Plan Drawer */}
            {editingPlan && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowPlanJson(!showPlanJson)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/80 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Layers size={15} className="text-brand-400" />
                    Step 4: Locked Video Director Timeline Plan ({editingPlan.scenes?.length || 0} Scenes)
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      Total {editingPlan.totalDurationSec}s
                    </span>
                    {showPlanJson ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {showPlanJson && (
                  <div className="p-4 bg-black/50 border-t border-white/10 flex flex-col gap-3">
                    {editingPlan.scenes && editingPlan.scenes.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {editingPlan.scenes.map((sc: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-3 rounded-lg bg-[#111] border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white/60">Scene {idx + 1}</span>
                              {sc.sceneRole && (
                                <span className="text-[10px] font-mono uppercase text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                  {sc.sceneRole.replace('_', ' ')}
                                </span>
                              )}
                              {sc.shotType && (
                                <span className="text-[10px] font-mono text-sky-300 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/20">
                                  {sc.shotType.replace('_', ' ')}
                                </span>
                              )}
                              <span className="font-mono text-brand-300 bg-brand-500/10 px-1.5 py-0.5 rounded border border-brand-500/20">
                                {sc.timelineStartTimeSec.toFixed(1)}s - {(sc.timelineStartTimeSec + sc.durationSec).toFixed(1)}s
                              </span>
                              <span className="text-white/70 capitalize font-medium">
                                Camera: {sc.effect?.replace(/_/g, ' ')}
                              </span>
                              {sc.samFocusBox && (
                                <span className="text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                  Subject Focus (LLM-estimated)
                                </span>
                              )}
                              {sc.colorGrading && (
                                <span className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  Grade: {sc.colorGrading}
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-white/50">
                              Duration: <span className="text-white font-mono">{sc.durationSec.toFixed(1)}s</span> | Transition: <span className="text-white font-mono">{sc.transitionOut}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="text-xs font-mono text-amber-300 max-h-60 overflow-y-auto">
                        {JSON.stringify(editingPlan, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Stage A: Multimodal Vision Analysis Drawer */}
            {analysisData && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowAnalysisJson(!showAnalysisJson)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Bot size={15} className="text-brand-400" />
                    Stage A: Multimodal Vision & Subject Focus (LLM-estimated) Raw Analysis
                  </span>
                  {showAnalysisJson ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showAnalysisJson && (
                  <div className="p-4 bg-black/60 border-t border-white/10 text-xs font-mono text-emerald-400 max-h-60 overflow-y-auto">
                    <pre>{JSON.stringify(analysisData, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
