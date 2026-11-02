import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Video,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Sliders,
  Sparkles,
  Download,
  Trash2,
  Check,
  AlertCircle,
  Clock,
  Layers,
  FileText,
  Volume1,
  Languages,
  CheckCircle2,
  Loader2,
  Subtitles,
  ExternalLink,
  ChevronRight,
  Info
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { getDialectFlag } from '../lib/utils';

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

export interface SoundEffectCue {
  id: string;
  description: string;
  sceneId?: string;
  startTimeSec: number;
  endTimeSec: number;
  volume: number;
  source: 'original_audio' | 'generated_effect';
  audioPath?: string;
}

export interface VideoProject {
  id: string;
  title: string;
  videoUrl: string;
  durationSec: number;
  status: 'uploaded' | 'analyzing' | 'analyzed' | 'generating' | 'completed' | 'failed';
  mode: 'understand' | 'dub_ad' | 'localize';
  analysisData?: string;
  scriptData?: string;
  sfxData?: string;
  audioMixMode: 'ducking' | 'replace' | 'replace_speech' | 'full_original';
  finalVideoUrl?: string;
  errorMessage?: string;
  createdAt: string;
}

const SUPPORTED_DIALECTS = [
  'Algerian Arabic',
  'Algerian Kabyle (Taqbaylit)',
  'Saudi Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Egyptian Arabic',
  'Moroccan Arabic',
  'Tunisian Arabic',
  'American English (US)',
  'British English (UK)'
];

const VOICES = [
  { name: 'Puck', desc: 'Energetic & friendly commercial voice' },
  { name: 'Fenrir', desc: 'Confident, authoritative presenter' },
  { name: 'Zephyr', desc: 'Warm, clear, and trustworthy' },
  { name: 'Kore', desc: 'Engaging, expressive female voice' },
  { name: 'Charon', desc: 'Deep, luxury, and premium tone' },
  { name: 'Aoede', desc: 'Smooth, informative narrator' }
];

const PLATFORMS = ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'Snapchat Ads'];
const TONES = ['Energetic sales', 'Friendly', 'Presentation', 'Luxury brand voice', 'Storytelling'];

export default function VideoStudio() {
  const { user } = useAuth();
  const { language, t } = useLanguage();

  // Project state
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [pastProjects, setPastProjects] = useState<VideoProject[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingDub, setIsGeneratingDub] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Studio configuration form
  const [mode, setMode] = useState<'understand' | 'dub_ad' | 'localize'>('dub_ad');
  const [dialect, setDialect] = useState('Algerian Arabic');
  const [voice, setVoice] = useState('Puck');
  const [platform, setPlatform] = useState('TikTok');
  const [tone, setTone] = useState('Energetic sales');
  const [userBrief, setUserBrief] = useState('');
  const [audioMixMode, setAudioMixMode] = useState<'replace_speech' | 'ducking' | 'full_original'>('replace_speech');
  const [duckingVolume, setDuckingVolume] = useState(0.15);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);

  // Aspect ratio, resolution & video fitting configuration
  const [targetAspectRatio, setTargetAspectRatio] = useState<'9:16' | '1:1' | '16:9' | 'original'>('9:16');
  const [fitMode, setFitMode] = useState<'crop' | 'fit' | 'blur_bg'>('crop');

  // Preview Blob, Stream Token & Authenticated Download State
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [isDownloadingFinal, setIsDownloadingFinal] = useState(false);
  const [streamToken, setStreamToken] = useState<string>('');
  const [activeProvider, setActiveProvider] = useState<'meta' | 'gemini-fallback'>('meta');
  const [activeModel, setActiveModel] = useState<string>('');

  // Separate loading states for script generation, voiceover generation, text rewrite, and rendering
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [regeneratingTextSegmentId, setRegeneratingTextSegmentId] = useState<string | null>(null);
  const [savingScript, setSavingScript] = useState(false);

  // Parsed project items
  const [scenes, setScenes] = useState<SceneAnalysis[]>([]);
  const [segments, setSegments] = useState<VoiceoverSegment[]>([]);
  const [sfxCues, setSfxCues] = useState<SoundEffectCue[]>([]);
  const [savingSfx, setSavingSfx] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState('');
  const [detectedTags, setDetectedTags] = useState<string[]>([]);

  // Video player & timeline state
  const videoRef = useRef<HTMLVideoElement>(null);
  const segmentAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);

  // Load user projects
  const fetchProjects = async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/video/projects', {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setPastProjects(data);
      }
    } catch (e) {
      console.warn('Failed to load past projects:', e);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [user]);

  // Fetch and auto-refresh short-lived HMAC stream token for the active project
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const fetchToken = async () => {
      if (!currentProject?.id || !user) {
        setStreamToken('');
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(`/api/video/${currentProject.id}/stream-token`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.token) {
            setStreamToken(data.token);
            const nowSec = Math.floor(Date.now() / 1000);
            const ttlSec = Math.max(60, (data.exp || nowSec + 600) - nowSec - 60);
            refreshTimer = setTimeout(fetchToken, ttlSec * 1000);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch video stream token:', e);
      }
    };

    fetchToken();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [currentProject?.id, user]);

  const withStreamToken = (url?: string | null) => {
    if (!url || !streamToken) return '';
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}t=${encodeURIComponent(streamToken)}`;
  };

  // Sync state when project changes
  useEffect(() => {
    if (currentProject) {
      if (currentProject.analysisData) {
        try {
          const parsedScenes = JSON.parse(currentProject.analysisData);
          setScenes(parsedScenes);
        } catch (_) {}
      } else {
        setScenes([]);
      }

      if (currentProject.scriptData) {
        try {
          const parsedSegments = JSON.parse(currentProject.scriptData);
          setSegments(parsedSegments);
        } catch (_) {}
      } else {
        setSegments([]);
      }

      if ((currentProject as any).sfxData) {
        try {
          const parsedSfx = JSON.parse((currentProject as any).sfxData);
          setSfxCues(parsedSfx);
        } catch (_) {}
      } else {
        setSfxCues([]);
      }

      setVideoDuration(currentProject.durationSec);
      setAudioMixMode(currentProject.audioMixMode || 'ducking');
    }
  }, [currentProject]);

  // Handle Video File Upload
  const handleFileUpload = async (file: File) => {
    setError(null);
    if (!user) {
      setError(language === 'ar' ? 'يرجى تسجيل الدخول أولاً' : 'Please sign in to upload videos.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError(language === 'ar' ? 'حجم الفيديو يتجاوز 50 ميغابايت.' : 'File size exceeds 50MB limit.');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ""));
    formData.append('mode', mode);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/video/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setCurrentProject(data);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Failed to upload video');
    } finally {
      setIsUploading(false);
    }
  };

  // Step 1: Run Meta Muse Spark Scene Analysis (Mode A)
  const handleAnalyzeVideo = async () => {
    if (!currentProject || !user) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ userContext: userBrief })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Video analysis failed');

      if (data.provider) setActiveProvider(data.provider);
      if (data.model) setActiveModel(data.model);
      setScenes(data.scenes || []);
      setAnalysisSummary(data.summary || '');
      setDetectedTags(data.detectedVisualTags || []);
      setCurrentProject(prev => prev ? { ...prev, status: 'analyzed', analysisData: JSON.stringify(data.scenes) } : null);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Step 2: Generate Script ONLY using Meta Muse Spark
  // MUST NOT generate audio, call Gemini TTS, or invoke FFmpeg.
  const handleGenerateScript = async () => {
    if (!currentProject || !user) return;
    setIsGeneratingScript(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/generate-script`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          mode,
          dialect,
          platform,
          tone,
          voice,
          userBrief
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Script generation failed');

      if (data.provider) setActiveProvider(data.provider);
      if (data.model) setActiveModel(data.model);
      setSegments(data.segments || []);
      if (data.sfx) {
        setSfxCues(data.sfx);
      }
      setCurrentProject(prev => prev ? { ...prev, scriptData: JSON.stringify(data.segments), sfxData: data.sfx ? JSON.stringify(data.sfx) : prev.sfxData } : null);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Script generation failed');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Save edited Sound Effects Cues
  const handleSaveSfx = async (updatedSfx = sfxCues) => {
    if (!currentProject || !user) return;
    setSavingSfx(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/save-sfx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ sfx: updatedSfx })
      });
      const data = await res.json();
      if (res.ok) {
        setSfxCues(data.sfx || []);
        setCurrentProject(prev => prev ? { ...prev, sfxData: JSON.stringify(data.sfx) } : null);
      }
    } catch (e) {
      console.warn('Failed to save SFX edits:', e);
    } finally {
      setSavingSfx(false);
    }
  };

  // Step 3A: Save edited script
  const handleSaveScript = async (updatedSegments = segments) => {
    if (!currentProject || !user) return;
    setSavingScript(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/save-script`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ segments: updatedSegments })
      });
      const data = await res.json();
      if (res.ok) {
        setSegments(data.segments || []);
        setCurrentProject(prev => prev ? { ...prev, scriptData: JSON.stringify(data.segments) } : null);
      }
    } catch (e) {
      console.warn('Failed to save script edits:', e);
    } finally {
      setSavingScript(false);
    }
  };

  // Step 3B: Rewrite single segment text with Meta Muse Spark
  const handleRegenerateSegmentText = async (segmentId: string) => {
    if (!currentProject || !user) return;
    setRegeneratingTextSegmentId(segmentId);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/regenerate-segment-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          segmentId,
          dialect,
          tone,
          userBrief
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rewrite segment text');

      if (data.provider) setActiveProvider(data.provider);
      if (data.model) setActiveModel(data.model);
      setSegments(prev =>
        prev.map(s => (s.id === segmentId ? { ...s, text: data.text, audioUrl: undefined } : s))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to rewrite segment text');
    } finally {
      setRegeneratingTextSegmentId(null);
    }
  };

  // Step 4: Generate Voiceover ONLY after User Approval (Gemini 3.1 Flash TTS)
  const handleGenerateVoiceover = async () => {
    if (!currentProject || !user) return;
    setIsGeneratingVoiceover(true);
    setError(null);

    try {
      // First persist any unsaved edits
      await handleSaveScript(segments);

      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/generate-voiceover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          dialect,
          voice,
          tone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voiceover generation failed');

      setSegments(data.segments || []);
      setCurrentProject(prev => prev ? { ...prev, scriptData: JSON.stringify(data.segments) } : null);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Voiceover generation failed');
    } finally {
      setIsGeneratingVoiceover(false);
    }
  };

  // Regenerate Audio for a single segment using Gemini TTS
  const handleRegenerateSegmentAudio = async (segmentId: string, text: string) => {
    if (!currentProject || !user) return;
    setRegeneratingSegmentId(segmentId);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/video/${currentProject.id}/regenerate-segment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          segmentId,
          text,
          dialect,
          voice,
          style: tone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Segment audio regeneration failed');

      setSegments(prev =>
        prev.map(s => (s.id === segmentId ? { ...s, audioUrl: data.audioUrl, durationSec: data.durationSec } : s))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to update segment audio');
    } finally {
      setRegeneratingSegmentId(null);
    }
  };

  // Load authenticated preview blob for final video player
  useEffect(() => {
    let objectUrl: string | null = null;
    const loadFinalPreviewBlob = async () => {
      if (!currentProject?.finalVideoUrl || !user || !streamToken) {
        setPreviewBlobUrl(null);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(withStreamToken(currentProject.finalVideoUrl), {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('video/mp4')) {
            const blob = await res.blob();
            objectUrl = URL.createObjectURL(blob);
            setPreviewBlobUrl(objectUrl);
          } else {
            console.warn('[VideoStudio] Preview stream returned non-mp4 content type:', contentType);
          }
        }
      } catch (e) {
        console.warn('Failed to load final video preview blob:', e);
      }
    };

    loadFinalPreviewBlob();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [currentProject?.finalVideoUrl, user, streamToken]);

  // Authenticated file download handler that guarantees video/mp4 blob delivery without HTML proxy interception
  const handleDownloadFinalVideo = async () => {
    if (!currentProject || !user) return;
    setIsDownloadingFinal(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const baseStreamUrl = `/api/video/stream/${currentProject.id}/final?download=true`;
      const streamUrl = streamToken ? `${baseStreamUrl}&t=${encodeURIComponent(streamToken)}` : baseStreamUrl;
      const res = await fetch(streamUrl, {
        headers: { Authorization: `Bearer ${idToken}` }
      });

      if (!res.ok) {
        throw new Error(`Download request failed with HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error('Authentication expired or proxy returned HTML instead of video/mp4. Please try again.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doudouvoice_${currentProject.title ? currentProject.title.toLowerCase().replace(/[^a-z0-0_]/g, '_') : 'dubbed_ad'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err: any) {
      console.error('Final video download failed:', err);
      setError(err.message || 'Failed to download final MP4 video file.');
    } finally {
      setIsDownloadingFinal(false);
    }
  };

  // Step 5: Render & Composite Final MP4 Video via FFmpeg
  const handleRenderFinalVideo = async () => {
    if (!currentProject || !user) return;
    setIsRendering(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();

      const outputWidth = targetAspectRatio === '9:16' ? 1080 : targetAspectRatio === '1:1' ? 1080 : targetAspectRatio === '16:9' ? 1920 : undefined;
      const outputHeight = targetAspectRatio === '9:16' ? 1920 : targetAspectRatio === '1:1' ? 1080 : targetAspectRatio === '16:9' ? 1080 : undefined;

      const res = await fetch(`/api/video/${currentProject.id}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          audioMixMode,
          duckingVolume,
          subtitlesEnabled,
          outputWidth,
          outputHeight,
          fitMode,
          sfx: sfxCues
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rendering failed');

      setCurrentProject(prev => prev ? { ...prev, status: 'completed', finalVideoUrl: data.finalVideoUrl } : null);
      fetchProjects();
    } catch (err: any) {
      setError(err.message || 'Video composition failed');
    } finally {
      setIsRendering(false);
    }
  };

  // Video playback timeupdate tracker
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);

    // Identify active speech segment
    const active = segments.findIndex(
      s => time >= s.startTimeSec && time <= (s.endTimeSec || s.startTimeSec + 3)
    );
    setActiveSegmentIndex(active !== -1 ? active : null);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekTo = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(seconds, videoDuration || 60));
    setCurrentTime(videoRef.current.currentTime);
  };

  const playSegmentAudio = (audioUrl: string) => {
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
    }
    const audio = new Audio(audioUrl);
    segmentAudioRef.current = audio;
    audio.play();
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const hasSynthesizedAudio = segments.some(s => Boolean(s.audioUrl));

  return (
    <div className="min-h-full bg-[#050505] text-white flex flex-col" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Header / Workspace Toolbar */}
      <div className="border-b border-white/10 bg-black/40 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-blue-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400">
            <Video size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-wide">
                {language === 'ar' ? 'استوديو الفيديو والدبلجة الذكية' : 'Video Intelligence & Dubbing Studio'}
              </h1>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                  activeProvider === 'gemini-fallback'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : 'bg-[#0866FF]/20 text-[#0866FF] border-[#0866FF]/30'
                }`}
                title={activeModel || undefined}
              >
                {activeProvider === 'gemini-fallback' ? 'Gemini fallback' : 'Meta Muse Spark'}
              </span>
            </div>
            <p className="text-xs text-white/50">
              {language === 'ar'
                ? 'تحليل إعلاني ذكي، صياغة سكريبت عبر Meta AI، ومراجعة ثم دبلجة عبر Gemini TTS'
                : 'Meta Muse Spark script generation, user approval & Gemini TTS synthesis'}
            </p>
          </div>
        </div>

        {/* Action Controls & Past Projects */}
        <div className="flex items-center gap-2">
          {currentProject && (
            <button
              onClick={() => {
                setCurrentProject(null);
                setScenes([]);
                setSegments([]);
              }}
              className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-white/70 hover:text-white transition-colors"
            >
              {language === 'ar' ? 'فيديو جديد' : 'New Video'}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-brand-500/20 transition-all disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            <span>{language === 'ar' ? 'رفع فيديو تسويقي' : 'Upload Video (Max 60s)'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="m-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-white/50 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Main Workspace Grid */}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        {/* Left Column: Video Preview & Interactive Timeline Scrubber (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black flex items-center justify-center aspect-video group shadow-2xl">
            {currentProject ? (
              <>
                {streamToken && (
                  <video
                    ref={videoRef}
                    src={withStreamToken(currentProject.finalVideoUrl || currentProject.videoUrl)}
                    className="w-full h-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={(e) => {
                      const dur = (e.target as HTMLVideoElement).duration;
                      if (dur) setVideoDuration(dur);
                    }}
                    onEnded={() => setIsPlaying(false)}
                  />
                )}

                {/* Subtitle Overlay during live preview */}
                {subtitlesEnabled && activeSegmentIndex !== null && segments[activeSegmentIndex] && (
                  <div className="absolute bottom-16 inset-x-8 text-center pointer-events-none z-20">
                    <span className="inline-block px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-white font-medium text-sm sm:text-base leading-relaxed shadow-2xl">
                      {segments[activeSegmentIndex].text}
                    </span>
                  </div>
                )}

                {/* Video Play/Pause Overlay Button */}
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <div className="w-14 h-14 rounded-full bg-brand-500 text-black flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
                    {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                  </div>
                </button>
              </>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer flex flex-col items-center justify-center p-8 text-center group/empty hover:bg-white/[0.02] transition-colors w-full h-full"
              >
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover/empty:text-brand-400 group-hover/empty:scale-110 transition-all mb-4">
                  <Video size={28} />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  {language === 'ar' ? 'اسحب وأفلت فيديو المنتج هنا' : 'Drop your product video here'}
                </h3>
                <p className="text-xs text-white/40 max-w-sm mb-4">
                  {language === 'ar'
                    ? 'يدعم صيغ MP4 و WebM و MOV حتى 50 ميغابايت ومدّة حتى 60 ثانية للإعلانات'
                    : 'Supports MP4, WebM, MOV up to 50MB and 60 seconds duration.'}
                </p>
                <span className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white font-medium border border-white/10 transition-colors">
                  {language === 'ar' ? 'تصفح الملفات' : 'Browse Files'}
                </span>
              </div>
            )}
          </div>

          {/* Interactive Timeline & Scrubber Bar */}
          {currentProject && (
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
              <div className="flex items-center justify-between text-xs text-white/60">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                  >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <span className="font-mono text-white">
                    {formatSeconds(currentTime)} / {formatSeconds(videoDuration || currentProject.durationSec)}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-white/70">
                    <input
                      type="checkbox"
                      checked={subtitlesEnabled}
                      onChange={(e) => setSubtitlesEnabled(e.target.checked)}
                      className="rounded accent-brand-500"
                    />
                    <Subtitles size={13} className="text-brand-400" />
                    <span>{language === 'ar' ? 'الترجمة التوضيحية' : 'Subtitles'}</span>
                  </label>
                </div>
              </div>

              {/* Scrubber Progress Track */}
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = (e.clientX - rect.left) / rect.width;
                  seekTo(pos * (videoDuration || currentProject.durationSec));
                }}
                className="relative h-6 rounded-lg bg-black/60 border border-white/10 cursor-pointer overflow-hidden group/track"
              >
                {/* Scene Slices */}
                {scenes.map((scene, i) => {
                  const leftPct = (scene.startTimeSec / (videoDuration || currentProject.durationSec || 60)) * 100;
                  const widthPct =
                    ((scene.endTimeSec - scene.startTimeSec) / (videoDuration || currentProject.durationSec || 60)) * 100;
                  return (
                    <div
                      key={scene.id || i}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className="absolute top-0 bottom-0 border-r border-white/20 hover:bg-brand-500/10 transition-colors"
                      title={`${scene.description} (${scene.startTimeSec}s - ${scene.endTimeSec}s)`}
                    />
                  );
                })}

                {/* Voiceover Segments Track */}
                {segments.map((seg, i) => {
                  const leftPct = (seg.startTimeSec / (videoDuration || currentProject.durationSec || 60)) * 100;
                  const widthPct =
                    ((seg.endTimeSec - seg.startTimeSec) / (videoDuration || currentProject.durationSec || 60)) * 100;
                  return (
                    <div
                      key={seg.id || i}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-1 bottom-1 rounded px-1 text-[9px] font-mono truncate transition-all ${
                        activeSegmentIndex === i
                          ? 'bg-brand-500 text-black font-bold shadow-lg'
                          : seg.audioUrl
                          ? 'bg-emerald-500/30 border border-emerald-500/40 text-emerald-200'
                          : 'bg-amber-500/30 border border-amber-500/40 text-amber-200'
                      }`}
                    >
                      {seg.text}
                    </div>
                  );
                })}

                {/* Current Playhead */}
                <div
                  style={{
                    left: `${(currentTime / (videoDuration || currentProject.durationSec || 60)) * 100}%`
                  }}
                  className="absolute top-0 bottom-0 w-1 bg-brand-400 z-10 shadow-lg"
                />
              </div>
            </div>
          )}

          {/* Visual Scene Breakdown & Scene-to-Narration Alignment Matrix */}
          {scenes.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/50">
                <span className="flex items-center gap-2">
                  <Layers size={14} className="text-brand-400" />
                  <span>{language === 'ar' ? 'مصفوفة مزامنة المشاهد والتعليق الصوتي' : 'Scene-to-Narration Visual Alignment Matrix'}</span>
                </span>
                <span className="text-[10px] text-brand-400 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded font-mono">
                  {scenes.length} {language === 'ar' ? 'مشاهد مرصودة' : 'scenes detected'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                {scenes.map((scene, idx) => {
                  const matchingSegs = segments.filter(
                    s => s.sceneId === scene.id || (s.startTimeSec >= scene.startTimeSec && s.startTimeSec <= scene.endTimeSec + 2.0)
                  );

                  return (
                    <div
                      key={scene.id || idx}
                      onClick={() => seekTo(scene.startTimeSec)}
                      className="p-3 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] font-mono text-brand-400 font-bold">
                          {scene.id.toUpperCase()} ({scene.startTimeSec}s - {scene.endTimeSec}s)
                        </span>
                        {scene.hookPotential === 'high' && (
                          <span className="px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-400 text-[9px] font-bold">
                            HOOK SCENE
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-white/80 line-clamp-2 leading-relaxed">{scene.description}</p>

                      {/* Linked Narration Segments for this scene */}
                      <div className="pt-1.5 border-t border-white/5 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-white/40 block">
                          {language === 'ar' ? 'التعليق الصوتي المترجم:' : 'Linked Narration Speech:'}
                        </span>
                        {matchingSegs.length > 0 ? (
                          matchingSegs.map((seg) => (
                            <div key={seg.id} className="p-1.5 rounded bg-black/40 border border-white/10 text-[10px] space-y-0.5">
                              <div className="flex items-center justify-between text-brand-300 font-mono">
                                <span>{seg.id}</span>
                                <span className="text-emerald-400 font-bold">
                                  {seg.startTimeSec}s - {seg.endTimeSec}s (SYNCED)
                                </span>
                              </div>
                              <p className="text-white/90 truncate">&quot;{seg.text}&quot;</p>
                            </div>
                          ))
                        ) : (
                          <span className="text-[10px] text-white/30 italic block">
                            {language === 'ar' ? 'لا يوجد تعليق صوتي مخصص لهذا المشهد' : 'No speech assigned to this scene bounds'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interactive Sound Effects & Scene Timeline Panel */}
          {sfxCues.length > 0 && (
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 size={16} className="text-brand-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    {language === 'ar' ? 'المؤثرات الصوتية والمزامنة مع المشاهد' : 'Scene-Synchronized Sound Effects'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newCue: SoundEffectCue = {
                        id: `sfx-custom-${Date.now()}`,
                        description: 'Custom Sound Effect',
                        startTimeSec: 0,
                        endTimeSec: 2,
                        volume: 0.6,
                        source: 'original_audio'
                      };
                      const updated = [...sfxCues, newCue];
                      setSfxCues(updated);
                      handleSaveSfx(updated);
                    }}
                    className="px-2 py-1 rounded bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 text-[10px] font-bold border border-brand-500/30 transition-colors flex items-center gap-1"
                  >
                    <span>+ {language === 'ar' ? 'إضافة مؤثر' : 'Add SFX Cue'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveSfx(sfxCues)}
                    disabled={savingSfx}
                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-medium text-white transition-colors flex items-center gap-1"
                  >
                    {savingSfx ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                    <span>{language === 'ar' ? 'حفظ المؤثرات' : 'Save SFX'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {sfxCues.map((cue, idx) => (
                  <div
                    key={cue.id || idx}
                    className="p-2.5 rounded-lg border border-white/10 bg-black/40 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={cue.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSfxCues(prev => prev.map((c, i) => i === idx ? { ...c, description: val } : c));
                        }}
                        className="bg-transparent text-white font-semibold text-xs border-b border-white/20 focus:border-brand-500 focus:outline-none px-1 py-0.5 w-2/3"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          const updated = sfxCues.filter((_, i) => i !== idx);
                          setSfxCues(updated);
                          handleSaveSfx(updated);
                        }}
                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                        title="Delete Sound Effect"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <span className="text-white/40 block">{language === 'ar' ? 'البداية (ث):' : 'Start Time (s):'}</span>
                        <input
                          type="number"
                          step="0.1"
                          value={cue.startTimeSec}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setSfxCues(prev => prev.map((c, i) => i === idx ? { ...c, startTimeSec: val } : c));
                          }}
                          className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white font-mono text-[10px]"
                        />
                      </div>

                      <div>
                        <span className="text-white/40 block">{language === 'ar' ? 'النهاية (ث):' : 'End Time (s):'}</span>
                        <input
                          type="number"
                          step="0.1"
                          value={cue.endTimeSec}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setSfxCues(prev => prev.map((c, i) => i === idx ? { ...c, endTimeSec: val } : c));
                          }}
                          className="w-full bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white font-mono text-[10px]"
                        />
                      </div>

                      <div className="col-span-2 sm:col-span-1">
                        <span className="text-white/40 block">{language === 'ar' ? 'مستوى الصوت:' : 'Volume:'} {Math.round(cue.volume * 100)}%</span>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={cue.volume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setSfxCues(prev => prev.map((c, i) => i === idx ? { ...c, volume: val } : c));
                          }}
                          className="w-full accent-brand-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Two-Stage Workflow Controls & Script Editor (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto">
          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-white/[0.03] border border-white/10 rounded-xl">
            <button
              onClick={() => setMode('understand')}
              className={`py-2 px-2 text-xs font-medium rounded-lg transition-all ${
                mode === 'understand' ? 'bg-brand-500 text-black font-bold shadow' : 'text-white/60 hover:text-white'
              }`}
            >
              {language === 'ar' ? 'فهم الفيديو' : 'Understand'}
            </button>
            <button
              onClick={() => setMode('dub_ad')}
              className={`py-2 px-2 text-xs font-medium rounded-lg transition-all ${
                mode === 'dub_ad' ? 'bg-brand-500 text-black font-bold shadow' : 'text-white/60 hover:text-white'
              }`}
            >
              {language === 'ar' ? 'إعلان متزامن' : 'Ad Dubbing'}
            </button>
            <button
              onClick={() => setMode('localize')}
              className={`py-2 px-2 text-xs font-medium rounded-lg transition-all ${
                mode === 'localize' ? 'bg-brand-500 text-black font-bold shadow' : 'text-white/60 hover:text-white'
              }`}
            >
              {language === 'ar' ? 'دبلجة وترجمة' : 'Localize'}
            </button>
          </div>

          {/* Form Configuration & Step 1/Step 2 Triggers */}
          <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
            <div className="space-y-1">
              <label className="text-[11px] text-white/60 font-medium block">
                {language === 'ar' ? 'اللهجة المستهدفة' : 'Target Dialect'}
              </label>
              <select
                value={dialect}
                onChange={(e) => setDialect(e.target.value)}
                className="w-full rounded-xl bg-black border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
              >
                {SUPPORTED_DIALECTS.map(d => (
                  <option key={d} value={d} className="bg-black">
                    {getDialectFlag(d)} {t(d)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-white/60 font-medium block">
                  {language === 'ar' ? 'صوت التعليق (Gemini TTS)' : 'Voice Profile (Gemini TTS)'}
                </label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="w-full rounded-xl bg-black border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                >
                  {VOICES.map(v => (
                    <option key={v.name} value={v.name} className="bg-black">
                      {v.name} ({v.desc.split(' ')[0]})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-white/60 font-medium block">
                  {language === 'ar' ? 'المنصة' : 'Platform'}
                </label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full rounded-xl bg-black border border-white/10 px-3 py-2 text-xs text-white focus:border-brand-500 focus:outline-none"
                >
                  {PLATFORMS.map(p => (
                    <option key={p} value={p} className="bg-black">{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-white/60 font-medium block">
                {language === 'ar' ? 'توجيهات الحملة والمنتج (اختياري)' : 'Campaign Guidance & Verified Facts (Optional)'}
              </label>
              <textarea
                value={userBrief}
                onChange={(e) => setUserBrief(e.target.value)}
                rows={2}
                placeholder={
                  language === 'ar'
                    ? 'مثال: ركّز على سعر 3500 دينار والتوصيل السريع لـ 58 ولاية'
                    : 'e.g. Focus on product ease of use and discount promo'
                }
                className="w-full rounded-xl bg-white/5 border border-white/10 p-2.5 text-xs text-white focus:border-brand-500 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            {/* Workflow Action Triggers: Step 1 Analyze & Step 2 Generate Script */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={handleAnalyzeVideo}
                disabled={!currentProject || isAnalyzing}
                className="py-2.5 px-3 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-brand-400" />}
                <span>{language === 'ar' ? '1. تحليل المشاهد' : '1. Analyze Scenes'}</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateScript}
                disabled={!currentProject || isGeneratingScript}
                className="py-2.5 px-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-brand-500/20 transition-all disabled:opacity-50"
              >
                {isGeneratingScript ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                <span>{language === 'ar' ? '2. توليد النص (Meta)' : '2. Generate Script'}</span>
              </button>
            </div>
          </div>

          {/* Editable Script Review & Approval Section */}
          {segments.length > 0 && (
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.02] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-brand-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white">
                    {language === 'ar' ? 'مراجعة وتعديل النص الإعلاني' : 'Review & Edit Script'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 text-[10px] font-mono border border-brand-500/30">
                    {segments.filter(s => Boolean(s.audioUrl)).length} / {segments.length} {language === 'ar' ? 'مقاطع صوتية جاهزة' : 'Audio Segments Ready'}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleSaveScript(segments)}
                    disabled={savingScript}
                    className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] font-medium text-white transition-colors flex items-center gap-1"
                  >
                    {savingScript ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    <span>{t('save_script')}</span>
                  </button>
                </div>
              </div>

              {!hasSynthesizedAudio && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] flex items-center gap-2">
                  <Info size={14} className="text-amber-400 shrink-0" />
                  <span>{t('audio_pending_notice')}</span>
                </div>
              )}

              {/* Editable Segment List with individual audio controls */}
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {segments.map((seg, idx) => (
                  <div
                    key={seg.id || idx}
                    className={`p-3 rounded-xl border transition-all space-y-2 ${
                      activeSegmentIndex === idx
                        ? 'border-brand-500/50 bg-brand-500/5'
                        : seg.audioUrl
                        ? 'border-emerald-500/20 bg-black/40'
                        : 'border-amber-500/20 bg-amber-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-white/10 font-mono text-brand-400">
                          #{idx + 1} ({seg.startTimeSec}s - {seg.endTimeSec}s)
                        </span>
                        {seg.audioUrl ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold border border-emerald-500/30">
                            {language === 'ar' ? 'صوت جاهز' : 'Voice Ready'}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-bold border border-amber-500/30">
                            {language === 'ar' ? 'في الانتظار' : 'Pending Voice'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Play segment audio if synthesized */}
                        {seg.audioUrl && (
                          <button
                            type="button"
                            onClick={() => playSegmentAudio(seg.audioUrl!)}
                            className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 transition-colors flex items-center gap-1 text-[10px]"
                            title="Play Segment Audio"
                          >
                            <Play size={10} />
                            <span>{language === 'ar' ? 'استماع' : 'Play'}</span>
                          </button>
                        )}

                        {/* Rewrite text with Meta Muse Spark */}
                        <button
                          type="button"
                          disabled={regeneratingTextSegmentId === seg.id}
                          onClick={() => handleRegenerateSegmentText(seg.id)}
                          className="px-2 py-0.5 rounded border border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/20 text-[10px] text-brand-300 flex items-center gap-1 transition-colors disabled:opacity-50"
                          title="Rewrite Text with Meta Muse Spark"
                        >
                          {regeneratingTextSegmentId === seg.id ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Sparkles size={10} />
                          )}
                          <span>{language === 'ar' ? 'إعادة النص' : 'Rewrite'}</span>
                        </button>

                        {/* Synthesize Audio for single segment with Gemini TTS */}
                        <button
                          type="button"
                          disabled={regeneratingSegmentId === seg.id}
                          onClick={() => handleRegenerateSegmentAudio(seg.id, seg.text)}
                          className={`px-2 py-0.5 rounded border text-[10px] flex items-center gap-1 transition-colors disabled:opacity-50 ${
                            seg.audioUrl
                              ? 'border-white/20 hover:bg-white/10 text-white/80'
                              : 'border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200'
                          }`}
                        >
                          {regeneratingSegmentId === seg.id ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <RotateCcw size={10} />
                          )}
                          <span>
                            {seg.audioUrl
                              ? (language === 'ar' ? 'تحديث' : 'Regen Voice')
                              : (language === 'ar' ? 'توليد الصوت' : 'Synthesize')}
                          </span>
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={seg.text}
                      onChange={(e) => {
                        const newText = e.target.value;
                        setSegments(prev =>
                          prev.map(s => (s.id === seg.id ? { ...s, text: newText, audioUrl: undefined } : s))
                        );
                      }}
                      rows={2}
                      className="w-full rounded-lg bg-black/50 border border-white/10 p-2 text-xs text-white focus:border-brand-500 focus:outline-none resize-none leading-relaxed"
                      placeholder="Enter spoken dialect text..."
                    />
                  </div>
                ))}
              </div>

              {/* Step 3 Trigger: Explicit User Approval for Voiceover Generation */}
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleGenerateVoiceover}
                  disabled={isGeneratingVoiceover || segments.length === 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-500 to-amber-500 hover:from-brand-400 hover:to-amber-400 text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-brand-500/20 transition-all disabled:opacity-50"
                >
                  {isGeneratingVoiceover ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>{language === 'ar' ? 'جاري توليد الصوت لكافة المقاطع عبر Gemini 3.1 Flash TTS...' : 'Synthesizing Speech for All Segments (Gemini 3.1 Flash TTS)...'}</span>
                    </>
                  ) : (
                    <>
                      <Volume2 size={16} />
                      <span>{language === 'ar' ? '3. موافقة وتوليد التعليق الصوتي لكافة المقاطع (Gemini TTS)' : '3. Approve Script & Generate Voiceover for All Segments'}</span>
                    </>
                  )}
                </button>
              </div>

              {/* Output Resolution, Aspect Ratio & Fitting Mode Controls */}
              <div className="pt-3 border-t border-white/10 space-y-3 bg-white/[0.01] p-3 rounded-xl border border-white/5">
                <div className="flex items-center justify-between text-xs font-semibold text-white/80">
                  <span className="flex items-center gap-1.5">
                    <Sliders size={13} className="text-brand-400" />
                    <span>{language === 'ar' ? 'أبعاد فيديو المخرجات' : 'Output Video Format & Resolution'}</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTargetAspectRatio('9:16')}
                    className={`p-2 rounded-lg text-center border transition-all ${
                      targetAspectRatio === '9:16'
                        ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                        : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] font-bold">TikTok / Reels</div>
                    <div className="text-[9px] font-mono text-white/50">9:16 (1080x1920)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetAspectRatio('1:1')}
                    className={`p-2 rounded-lg text-center border transition-all ${
                      targetAspectRatio === '1:1'
                        ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                        : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] font-bold">Instagram Feed</div>
                    <div className="text-[9px] font-mono text-white/50">1:1 (1080x1080)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetAspectRatio('16:9')}
                    className={`p-2 rounded-lg text-center border transition-all ${
                      targetAspectRatio === '16:9'
                        ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                        : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] font-bold">YouTube Ads</div>
                    <div className="text-[9px] font-mono text-white/50">16:9 (1920x1080)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetAspectRatio('original')}
                    className={`p-2 rounded-lg text-center border transition-all ${
                      targetAspectRatio === 'original'
                        ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                        : 'border-white/10 bg-black/40 text-white/60 hover:text-white'
                    }`}
                  >
                    <div className="text-[11px] font-bold">{language === 'ar' ? 'الأصلية' : 'Original'}</div>
                    <div className="text-[9px] font-mono text-white/50">{language === 'ar' ? 'نفس المصدر' : 'Keep Source'}</div>
                  </button>
                </div>

                {targetAspectRatio !== 'original' && (
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[10px] text-white/50 font-medium block">
                      {language === 'ar' ? 'طريقة ملاءمة الفيديو:' : 'Video Fitting Mode:'}
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFitMode('crop')}
                        className={`py-1.5 px-2 rounded text-[10px] font-medium border transition-all ${
                          fitMode === 'crop'
                            ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                            : 'border-white/10 bg-black/40 text-white/50 hover:text-white'
                        }`}
                      >
                        {language === 'ar' ? 'قص ملء الشاشة' : 'Crop to Fill'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setFitMode('fit')}
                        className={`py-1.5 px-2 rounded text-[10px] font-medium border transition-all ${
                          fitMode === 'fit'
                            ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                            : 'border-white/10 bg-black/40 text-white/50 hover:text-white'
                        }`}
                      >
                        {language === 'ar' ? 'احتواء كامل' : 'Fit Entire Video'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setFitMode('blur_bg')}
                        className={`py-1.5 px-2 rounded text-[10px] font-medium border transition-all ${
                          fitMode === 'blur_bg'
                            ? 'border-brand-500 bg-brand-500/20 text-brand-300 font-bold'
                            : 'border-white/10 bg-black/40 text-white/50 hover:text-white'
                        }`}
                      >
                        {language === 'ar' ? 'تغبيش الخلفية' : 'Blur Background'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Audio Mixer & Step 4 Render Section */}
              {hasSynthesizedAudio && (
                <div className="pt-3 border-t border-white/10 space-y-3">
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                      <Sliders size={13} className="text-brand-400" />
                      <span>{language === 'ar' ? 'نمط دمج مع الصوت الأصلي (FFmpeg)' : 'Original Audio & Speech Separation Mode'}</span>
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10">
                      <button
                        type="button"
                        onClick={() => setAudioMixMode('replace_speech')}
                        className={`p-2 rounded-lg text-center transition-all ${
                          audioMixMode === 'replace_speech'
                            ? 'bg-brand-500 text-black font-bold shadow'
                            : 'text-white/60 hover:text-white'
                        }`}
                      >
                        <div className="text-[11px] font-bold">
                          {language === 'ar' ? 'حذف الصوت البشري فقط' : 'Replace Human Voice Only'}
                        </div>
                        <div className="text-[9px] opacity-80 leading-tight mt-0.5">
                          {language === 'ar' ? 'عزل الكلام وحفظ الموسيقى والمؤثرات' : 'Removes original speech, preserves music & SFX'}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAudioMixMode('ducking')}
                        className={`p-2 rounded-lg text-center transition-all ${
                          audioMixMode === 'ducking'
                            ? 'bg-brand-500 text-black font-bold shadow'
                            : 'text-white/60 hover:text-white'
                        }`}
                      >
                        <div className="text-[11px] font-bold">
                          {language === 'ar' ? 'خفض تلقائي للخلفية' : 'Smart Ducking'}
                        </div>
                        <div className="text-[9px] opacity-80 leading-tight mt-0.5">
                          {language === 'ar' ? 'خفض الخلفية أثناء التحدث ورفعها بالصمت' : 'Ducks background volume while speech plays'}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAudioMixMode('full_original')}
                        className={`p-2 rounded-lg text-center transition-all ${
                          audioMixMode === 'full_original'
                            ? 'bg-brand-500 text-black font-bold shadow'
                            : 'text-white/60 hover:text-white'
                        }`}
                      >
                        <div className="text-[11px] font-bold">
                          {language === 'ar' ? 'الصوت الأصلي الكامل' : 'Full Original Audio'}
                        </div>
                        <div className="text-[9px] opacity-80 leading-tight mt-0.5">
                          {language === 'ar' ? 'دعم كامل للصوت الأصلي مع صوت جديد' : 'Mixes full original audio with new voice'}
                        </div>
                      </button>
                    </div>
                  </div>

                  {audioMixMode === 'ducking' && (
                    <div className="flex items-center gap-3 text-xs bg-white/[0.02] p-2 rounded-lg border border-white/10">
                      <Volume1 size={14} className="text-brand-400" />
                      <span className="text-[10px] text-white/60">{language === 'ar' ? 'مستوى صوت الخلفية:' : 'Background Volume:'}</span>
                      <input
                        type="range"
                        min="0.05"
                        max="0.40"
                        step="0.05"
                        value={duckingVolume}
                        onChange={(e) => setDuckingVolume(parseFloat(e.target.value))}
                        className="flex-1 accent-brand-500"
                      />
                      <span className="font-mono text-[10px] text-brand-300 font-bold">
                        {Math.round(duckingVolume * 100)}%
                      </span>
                    </div>
                  )}

                  {/* Step 4 Render Button */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleRenderFinalVideo}
                      disabled={isRendering}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20 transition-all disabled:opacity-50"
                    >
                      {isRendering ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          <span>{language === 'ar' ? 'جارٍ دمج وتصدير الفيديو عبر FFmpeg...' : 'Compositing Final Video with FFmpeg...'}</span>
                        </>
                      ) : (
                        <>
                          <Layers size={16} />
                          <span>{language === 'ar' ? '4. دمج وتصدير الفيديو النهائي (MP4)' : '4. Render & Export Final Video (MP4)'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 5: Final Video Preview BEFORE Download */}
              {currentProject.finalVideoUrl && (
                <div className="mt-6 pt-5 border-t border-brand-500/20 space-y-4 bg-brand-500/5 p-4 rounded-2xl border border-brand-500/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Video size={16} className="text-brand-400" />
                        <span>{language === 'ar' ? '5. معاينة الفيديو النهائي (قبل التحميل)' : '5. Final Video Preview (Before Download)'}</span>
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono">
                        H.264 / AAC 48kHz
                      </span>
                      <span className="px-2 py-0.5 rounded bg-brand-500/20 border border-brand-500/40 text-brand-300 font-mono">
                        QuickTime Ready
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-white/70 leading-relaxed">
                    {language === 'ar'
                      ? 'يمكنك مشاهدة الفيديو المدمج كاملاً والتحقق من جودة الصوت ومزج التعليق الصوتي مباشرة هنا قبل تحميل الملف:'
                      : 'Review your complete dubbed video with synchronized voiceover & audio mix directly in DoudouVoice before downloading:'}
                  </p>

                  {/* HTML5 Video Preview Player */}
                  <div className="relative rounded-xl overflow-hidden border border-white/20 bg-black aspect-video shadow-2xl group">
                    {(previewBlobUrl || streamToken) && (
                      <video
                        key={previewBlobUrl || withStreamToken(currentProject.finalVideoUrl)}
                        controls
                        playsInline
                        preload="metadata"
                        src={previewBlobUrl || withStreamToken(currentProject.finalVideoUrl)}
                        className="w-full h-full object-contain bg-black"
                      >
                        {language === 'ar'
                          ? 'متصفحك لا يدعم تشغيل الفيديو.'
                          : 'Your browser does not support HTML5 video playback.'}
                      </video>
                    )}
                  </div>

                  {/* Authenticated Download Button - DOES NOT AUTO-START, GUARANTEES MP4 BLOB */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleDownloadFinalVideo}
                      disabled={isDownloadingFinal}
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-brand-500 hover:from-amber-400 hover:to-brand-400 text-black text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-xl shadow-brand-500/30 transition-all hover:scale-[1.01] disabled:opacity-50"
                    >
                      {isDownloadingFinal ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          <span>{language === 'ar' ? 'جارٍ تنزيل ملف الفيديو...' : 'Downloading MP4 Video File...'}</span>
                        </>
                      ) : (
                        <>
                          <Download size={18} />
                          <span>{language === 'ar' ? 'تحميل ملف الفيديو (doudouvoice_dubbed_ad.mp4)' : 'Download MP4 Video (doudouvoice_dubbed_ad.mp4)'}</span>
                        </>
                      )}
                    </button>
                    <p className="text-[10px] text-center text-white/40 mt-1.5 font-mono">
                      {language === 'ar'
                        ? 'ترميز H.264 متوافق 100% مع QuickTime Player و macOS و iOS و Android.'
                        : '100% compatible with macOS QuickTime Player, iOS, Android, and social media ad platforms.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
