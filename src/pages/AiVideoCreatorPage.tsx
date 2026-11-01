import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import {
  Sparkles,
  Upload,
  Video,
  Image as ImageIcon,
  Play,
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
  Music
} from 'lucide-react';

interface UploadedAsset {
  id: string;
  type: 'image' | 'video';
  filePath: string;
  originalName: string;
  mimeType: string;
  previewUrl?: string;
  durationSec?: number;
}

export default function AiVideoCreatorPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  
  // Pipeline Settings
  const [dialect, setDialect] = useState<string>('Algerian Darija');
  const [voice, setVoice] = useState<string>('ar-DZ-Amir');
  const [targetDuration, setTargetDuration] = useState<number>(15);
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [userPrompt, setUserPrompt] = useState<string>('');

  // Status Stepper
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentStage, setCurrentStage] = useState<number>(0); // 0: Idle, 1: Uploading, 2: Meta Analysis, 3: Creative Dir, 4: Script & Voice, 5: Editing Plan, 6: Modal Render, 7: Done
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Execution Results
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [creativeDirection, setCreativeDirection] = useState<any>(null);
  const [scriptData, setScriptData] = useState<any>(null);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [renderedVia, setRenderedVia] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Accordion Toggles
  const [showAnalysisJson, setShowAnalysisJson] = useState<boolean>(false);
  const [showScriptJson, setShowScriptJson] = useState<boolean>(false);
  const [showPlanJson, setShowPlanJson] = useState<boolean>(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...filesArray]);

      const previews: UploadedAsset[] = filesArray.map((f: File) => ({
        id: `temp_${Math.random().toString(36).slice(2, 9)}`,
        type: f.type.startsWith('video/') ? 'video' : 'image',
        filePath: '',
        originalName: f.name,
        mimeType: f.type,
        previewUrl: URL.createObjectURL(f)
      }));

      setUploadedAssets(prev => [...prev, ...previews]);
    }
  };

  const removeAsset = (id: string) => {
    setUploadedAssets(prev => prev.filter(a => a.id !== id));
  };

  const handleStartPipeline = async () => {
    if (selectedFiles.length === 0 && uploadedAssets.length === 0) {
      setErrorMessage('Please upload at least one image or video clip.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setFinalVideoUrl(null);
    setCurrentStage(1);
    setStatusMessage('Uploading media assets...');

    try {
      const token = user ? await user.getIdToken() : '';
      const formData = new FormData();
      selectedFiles.forEach(file => {
        formData.append('mediaFiles', file);
      });

      // Helper for safe JSON response parsing
      const parseJsonResponse = async (res: Response, endpointName: string) => {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || `Request to ${endpointName} failed with status ${res.status}`);
          }
          return data;
        }

        const text = await res.text();
        if (text.includes('Cookie check') || text.includes('cookie') || text.includes('<!doctype') || text.includes('<html')) {
          throw new Error(`AI Studio preview session challenge received (${res.status} OK). Please click or refresh the preview iframe to confirm cookies.`);
        }

        const cleanText = text.replace(/<[^>]*>/g, '').trim().slice(0, 150);
        throw new Error(`Server returned non-JSON response from ${endpointName} (${res.status}): ${cleanText || 'Unexpected format'}`);
      };

      // Step 1: Upload assets
      const uploadRes = await fetch('/api/creator/upload-assets', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'same-origin',
        body: formData
      });

      const uploadData = await parseJsonResponse(uploadRes, '/api/creator/upload-assets');
      const activeProjectId = uploadData.projectId;
      const serverAssets = uploadData.assets;
      setProjectId(activeProjectId);

      // Step 2-6: Execute Full Meta + Modal Pipeline
      setCurrentStage(2);
      setStatusMessage('Meta Stage A: Multimodal vision analysis (Muse Spark 1.3 & SAM 3.1)...');

      const pipelineRes = await fetch('/api/creator/pipeline-all', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          projectId: activeProjectId,
          assets: serverAssets,
          dialect,
          voice,
          durationSec: targetDuration,
          aspectRatio,
          userPrompt
        })
      });

      const result = await parseJsonResponse(pipelineRes, '/api/creator/pipeline-all');

      setAnalysisData(result.analysis);
      setCreativeDirection(result.creativeDirection);
      setScriptData(result.script);
      setEditingPlan(result.editingPlan);
      setFinalVideoUrl(result.finalVideoUrl);
      setRenderedVia(result.renderedVia || 'Modal Cloud');
      setCurrentStage(7);
      setStatusMessage('Video successfully created and verified!');
    } catch (err: any) {
      console.error('Pipeline Error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred during pipeline execution');
    } finally {
      setIsProcessing(false);
    }
  };

  const stages = [
    { title: 'Upload Assets', desc: 'Preparing original media' },
    { title: 'Meta Asset Analysis', desc: 'Muse Spark 1.3 + SAM 3.1 visual understanding' },
    { title: 'Meta Creative Direction', desc: 'Campaign concept & visual rhythm' },
    { title: 'Meta Script & Voice', desc: 'DoudouVoice natural TTS narration' },
    { title: 'Meta Editing Director', desc: 'Executable Editing Plan generation' },
    { title: 'Modal Cloud Render', desc: 'FFmpeg remote execution & export' }
  ];

  return (
    <div className="min-h-screen w-full bg-[#050505] text-[#e0e0e0] p-6 lg:p-10 flex flex-col gap-8">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold border border-brand-500/30 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles size={13} />
              Meta AI + Modal Cloud
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30 uppercase tracking-widest">
              BETA
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white mt-2 flex items-center gap-3 tracking-tight">
            AI Video Creator
          </h1>
          <p className="text-sm text-white/50 mt-1 max-w-2xl">
            Autonomous end-to-end video ad creation powered by Meta multimodal intelligence (Muse Spark 1.3 & SAM 3.1), expressive DoudouVoice dialect TTS, and Modal Cloud remote FFmpeg rendering.
          </p>
        </div>

        {finalVideoUrl && (
          <a
            href={`${finalVideoUrl}?download=true`}
            download="doudouvoice_ai_creator_video.mp4"
            className="px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-brand-500/25 transition-all self-start lg:self-auto"
          >
            <Download size={18} />
            Download Final MP4
          </a>
        )}
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-3">
          <ShieldAlert size={20} className="shrink-0" />
          <span>{errorMessage}</span>
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
          <div className="p-6 rounded-2xl bg-[#0a0a0a] border border-white/10 flex flex-col gap-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <Sliders size={16} className="text-brand-400" />
              2. Campaign Configuration
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-white/60 mb-1.5 block">Target Dialect</label>
                <select
                  value={dialect}
                  onChange={e => setDialect(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="Algerian Darija">Algerian Darija</option>
                  <option value="Gulf Arabic">Gulf Arabic (Khaleeji)</option>
                  <option value="Saudi Arabic">Saudi Arabic</option>
                  <option value="Emirati Arabic">Emirati Arabic</option>
                  <option value="English">English</option>
                  <option value="French">French</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/60 mb-1.5 block">DoudouVoice Speaker</label>
                <select
                  value={voice}
                  onChange={e => setVoice(e.target.value)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="ar-DZ-Amir">Amir (Algerian Male)</option>
                  <option value="ar-DZ-Meriem">Meriem (Algerian Female)</option>
                  <option value="ar-SA-Zayd">Zayd (Saudi Male)</option>
                  <option value="ar-AE-Fatima">Fatima (Emirati Female)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-white/60 mb-1.5 block">Target Duration</label>
                <select
                  value={targetDuration}
                  onChange={e => setTargetDuration(Number(e.target.value))}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500"
                >
                  <option value={10}>10 Seconds (Quick Hook)</option>
                  <option value={15}>15 Seconds (TikTok / Reel)</option>
                  <option value={30}>30 Seconds (Commercial Ad)</option>
                  <option value={60}>60 Seconds (Full Showcase)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-white/60 mb-1.5 block">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={e => setAspectRatio(e.target.value as any)}
                  disabled={isProcessing}
                  className="w-full bg-[#121212] border border-white/10 rounded-xl px-3 py-2 text-xs font-medium text-white focus:outline-none focus:border-brand-500"
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

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
                <h2 className="text-sm font-bold uppercase tracking-wider text-brand-400 flex items-center gap-2">
                  <Film size={18} />
                  Final Rendered Commercial Video
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-white/70 bg-white/5 px-2.5 py-1 rounded border border-white/10">
                    Engine: {renderedVia === 'Modal Cloud' ? '☁️ Modal Cloud (Remote)' : '⚙️ Local Server FFmpeg'}
                  </span>
                </div>
              </div>

              {renderedVia !== 'Modal Cloud' && (
                <p className="text-[11px] text-white/50 bg-white/[0.02] border border-white/5 px-3 py-1.5 rounded-lg">
                  ℹ️ Rendered via local server FFmpeg. To dispatch jobs to serverless GPU cloud workers, configure <code className="text-brand-300">MODAL_WEBHOOK_URL</code> in environment secrets.
                </p>
              )}

              <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-white/10">
                <video
                  src={finalVideoUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/10">
                <div className="text-xs text-white/60 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Format: <strong className="text-white font-mono">{aspectRatio} QuickTime MP4</strong></span>
                  <span>Video: <strong className="text-emerald-400 font-mono">H.264 (yuv420p)</strong></span>
                  <span>Audio: <strong className="text-emerald-400 font-mono">AAC (48kHz)</strong></span>
                  <span>Loudness: <strong className="text-emerald-400 font-mono">-14 LUFS</strong></span>
                </div>
                <a
                  href={`${finalVideoUrl}?download=true`}
                  download="meta_ai_creator_video.mp4"
                  className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20 transition-all"
                >
                  <Download size={15} />
                  Download Verified MP4
                </a>
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
                    Stage C & D: Expressive Voice Direction & Segment Previews ({dialect})
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
                    {scriptData.segments && scriptData.segments.length > 0 ? (
                      <div className="flex flex-col gap-2.5">
                        {scriptData.segments.map((seg: any, idx: number) => {
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

                              <p className="text-sm font-semibold text-white/95 leading-relaxed pt-1" dir="rtl">
                                {seg.text}
                              </p>

                              {seg.deliveryInstruction && (
                                <p className="text-[11px] text-white/40 italic">
                                  &gt; Voice Direction: {seg.deliveryInstruction}
                                </p>
                              )}

                              {seg.audioUrl && (
                                <div className="pt-1 flex items-center gap-2">
                                  <audio
                                    src={seg.audioUrl}
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

            {/* Stage E: Meta Executable Editing Plan Drawer */}
            {editingPlan && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowPlanJson(!showPlanJson)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/80 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Layers size={15} className="text-brand-400" />
                    Stage E: Meta Video Director Timeline Plan ({editingPlan.scenes?.length || 0} Scenes)
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
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white/60">Scene {idx + 1}</span>
                              <span className="font-mono text-brand-300 bg-brand-500/10 px-1.5 py-0.5 rounded border border-brand-500/20">
                                {sc.timelineStartTimeSec.toFixed(1)}s - {(sc.timelineStartTimeSec + sc.durationSec).toFixed(1)}s
                              </span>
                              <span className="text-white/70 capitalize font-medium">
                                Effect: {sc.effect?.replace('_', ' ')}
                              </span>
                              {sc.samFocusBox && (
                                <span className="text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                  SAM Focus Point
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

            {/* Stage A: Meta Multimodal Vision Analysis Drawer */}
            {analysisData && (
              <div className="rounded-xl bg-[#0a0a0a] border border-white/10 overflow-hidden">
                <button
                  onClick={() => setShowAnalysisJson(!showAnalysisJson)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/70 hover:bg-white/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Bot size={15} className="text-brand-400" />
                    Stage A: Meta Multimodal Vision & SAM 3.1 Raw Analysis
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
