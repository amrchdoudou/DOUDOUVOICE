import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  Pause,
  Download,
  Loader2,
  Sparkles,
  Volume2,
  RotateCcw,
  Clock,
  Mic,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Flame,
  Laugh,
  HelpCircle
} from 'lucide-react';
import {
  parseExperimentScript,
  SAMPLE_EXPERIMENT_SCRIPT,
  TimelineSegment,
  SpeechSegment,
  SoundSegment,
  PauseSegment
} from '../lib/experimentScriptParser';
import { useLanguage } from '../lib/LanguageContext';

const DIALECTS = [
  'Saudi Arabic',
  'Algerian Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Egyptian Arabic',
  'Moroccan Arabic',
  'Kuwaiti Arabic',
  'Neutral Middle Eastern Arabic'
];

const VOICES = ['Puck', 'Fenrir', 'Zephyr', 'Kore', 'Charon', 'Aoede'];

export default function ExperimentPage() {
  const { t, language } = useLanguage();
  const [rawScript, setRawScript] = useState(SAMPLE_EXPERIMENT_SCRIPT);
  const [dialect, setDialect] = useState('Saudi Arabic');
  const [voice, setVoice] = useState('Puck');

  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Master composition state
  const [isComposing, setIsComposing] = useState(false);
  const [composedAudioUrl, setComposedAudioUrl] = useState<string | null>(null);
  const [composedDuration, setComposedDuration] = useState<number | null>(null);
  const [composedSamples, setComposedSamples] = useState<number | null>(null);

  // Audio playback state for segments and master
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const segmentAudioRef = useRef<HTMLAudioElement | null>(null);
  const masterAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initial parse on load
  useEffect(() => {
    const res = parseExperimentScript(SAMPLE_EXPERIMENT_SCRIPT);
    setSegments(res.segments);
  }, []);

  const handleParseOnly = () => {
    setGlobalError(null);
    const res = parseExperimentScript(rawScript);
    setSegments(res.segments);
  };

  const handlePlayAudio = (id: string, url: string) => {
    if (currentlyPlayingId === id) {
      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause();
      }
      setCurrentlyPlayingId(null);
      return;
    }

    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause();
    }
    if (masterAudioRef.current) {
      masterAudioRef.current.pause();
    }

    const audio = new Audio(url);
    segmentAudioRef.current = audio;
    setCurrentlyPlayingId(id);

    audio.onended = () => {
      setCurrentlyPlayingId(null);
    };
    audio.onerror = () => {
      setCurrentlyPlayingId(null);
    };
    audio.play().catch(e => {
      console.error(e);
      setCurrentlyPlayingId(null);
    });
  };

  // Generate a single segment
  const handleGenerateSingleSegment = async (index: number) => {
    const seg = segments[index];
    if (seg.type === 'pause') return;

    setGlobalError(null);
    setSegments(prev => {
      const copy = [...prev];
      if (copy[index].type !== 'pause') {
        (copy[index] as SpeechSegment | SoundSegment).status = 'generating';
        (copy[index] as SpeechSegment | SoundSegment).error = undefined;
      }
      return copy;
    });

    try {
      const payload: any = {
        type: seg.type,
        text: seg.text,
        dialect,
        voice
      };
      if (seg.type === 'speech') {
        payload.pace = seg.pace;
      } else if (seg.type === 'sound') {
        payload.soundType = seg.soundType;
      }

      const res = await fetch('/api/experiment/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate segment');
      }

      setSegments(prev => {
        const copy = [...prev];
        const target = copy[index] as SpeechSegment | SoundSegment;
        target.status = 'ready';
        target.durationSec = data.durationSec;
        target.audioUrl = data.audioUrl;
        return copy;
      });
    } catch (err: any) {
      setSegments(prev => {
        const copy = [...prev];
        const target = copy[index] as SpeechSegment | SoundSegment;
        target.status = 'error';
        target.error = err.message || 'Generation failed';
        return copy;
      });
    }
  };

  // Generate all segments and compose master audio
  const handleGenerateAllAndCompose = async () => {
    setIsProcessingAll(true);
    setGlobalError(null);
    setComposedAudioUrl(null);

    // 1. Parse current script
    const parsed = parseExperimentScript(rawScript);
    let currentTimeline = [...parsed.segments];
    setSegments(currentTimeline);

    // 2. Sequentially generate missing or non-ready speech/sound segments
    for (let i = 0; i < currentTimeline.length; i++) {
      const seg = currentTimeline[i];
      if (seg.type === 'pause') continue;

      setProcessingStatus(`Generating segment ${i + 1}/${currentTimeline.length}: [${seg.type}] "${seg.text.slice(0, 20)}..."`);
      
      setSegments(prev => {
        const copy = [...prev];
        (copy[i] as SpeechSegment | SoundSegment).status = 'generating';
        return copy;
      });

      try {
        const payload: any = {
          type: seg.type,
          text: seg.text,
          dialect,
          voice
        };
        if (seg.type === 'speech') payload.pace = seg.pace;
        else if (seg.type === 'sound') payload.soundType = seg.soundType;

        const res = await fetch('/api/experiment/segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to generate segment');
        }

        currentTimeline[i] = {
          ...seg,
          status: 'ready',
          durationSec: data.durationSec,
          audioUrl: data.audioUrl,
          id: data.segmentId // Server cached segment ID
        } as any;

        setSegments([...currentTimeline]);

        // A small polite 1.5s delay between API calls to prevent 429 burst rate limits on Free Tier
        await new Promise(r => setTimeout(r, 1500));
      } catch (err: any) {
        currentTimeline[i] = {
          ...seg,
          status: 'error',
          error: err.message
        } as any;
        setSegments([...currentTimeline]);
        setGlobalError(`Error on segment ${i + 1}: ${err.message}`);
        setIsProcessingAll(false);
        setProcessingStatus(null);
        return;
      }
    }

    // 3. Compose all segments into master WAV
    setProcessingStatus('Composing master audio (concatenating PCM & sample-accurate digital silence)...');
    try {
      const itemsToCompose = currentTimeline.map(seg => {
        if (seg.type === 'pause') {
          return { type: 'pause', durationSec: seg.durationSec };
        } else {
          return { type: seg.type, segmentId: (seg as any).id };
        }
      });

      const composeRes = await fetch('/api/experiment/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToCompose })
      });

      const composeData = await composeRes.json();
      if (!composeRes.ok || !composeData.success) {
        throw new Error(composeData.error || 'Composition failed');
      }

      setComposedAudioUrl(composeData.audioUrl);
      setComposedDuration(composeData.totalDurationSec);
      setComposedSamples(composeData.totalSamples);
    } catch (err: any) {
      setGlobalError(`Composition error: ${err.message}`);
    } finally {
      setIsProcessingAll(false);
      setProcessingStatus(null);
    }
  };

  // Re-compose only (when all segments already exist)
  const handleComposeOnly = async () => {
    setIsComposing(true);
    setGlobalError(null);
    try {
      const itemsToCompose = segments.map(seg => {
        if (seg.type === 'pause') {
          return { type: 'pause', durationSec: seg.durationSec };
        } else {
          return { type: seg.type, segmentId: (seg as any).id };
        }
      });

      const res = await fetch('/api/experiment/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToCompose })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Composition failed');
      }

      setComposedAudioUrl(data.audioUrl);
      setComposedDuration(data.totalDurationSec);
      setComposedSamples(data.totalSamples);
    } catch (err: any) {
      setGlobalError(`Composition error: ${err.message}`);
    } finally {
      setIsComposing(false);
    }
  };

  // Metrics summary
  const totalSpeechDuration = segments
    .filter(s => s.type !== 'pause' && (s as any).durationSec)
    .reduce((acc, s) => acc + ((s as any).durationSec || 0), 0);
  const totalPauseDuration = segments
    .filter(s => s.type === 'pause')
    .reduce((acc, s) => acc + (s as PauseSegment).durationSec, 0);

  const fastSegment = segments.find(s => s.type === 'speech' && (s as SpeechSegment).pace === 'fast' && (s as any).durationSec) as SpeechSegment | undefined;
  const slowSegment = segments.find(s => s.type === 'speech' && (s as SpeechSegment).pace === 'slow' && (s as any).durationSec) as SpeechSegment | undefined;
  const normalSegment = segments.find(s => s.type === 'speech' && (s as SpeechSegment).pace === 'normal' && (s as any).durationSec) as SpeechSegment | undefined;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 text-white min-h-screen">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-black to-blue-950/40 border border-purple-500/30 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-mono uppercase font-bold tracking-wider">
              Phase 1 Experiment
            </span>
            <span className="text-white/40 text-xs font-mono">gemini-3.1-flash-tts-preview</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <span>Experimental Expressive TTS & Timing Test</span>
          </h1>
          <p className="text-xs text-white/60 mt-1 max-w-2xl leading-relaxed">
            Testing segment-level pacing (slow/normal/fast), sample-accurate digital silence (pauses), and expressive vocal reactions (excited, surprised, laugh) with raw PCM concatenation.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-white/40 block">Dialect</label>
            <select
              value={dialect}
              onChange={e => setDialect(e.target.value)}
              className="bg-black/80 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-400"
            >
              {DIALECTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-mono text-white/40 block">Voice</label>
            <select
              value={voice}
              onChange={e => setVoice(e.target.value)}
              className="bg-black/80 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-purple-400"
            >
              {VOICES.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {globalError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5 shadow-lg">
          <AlertCircle size={16} className="text-red-400 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {/* Grid: Editor on Left, Parsed Timeline on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Script Format Editor */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-[#0c0c0e] border border-white/10 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-sm font-bold tracking-wide uppercase flex items-center gap-2 text-purple-300">
                <Sliders size={16} />
                <span>Test Script Input</span>
              </h2>
              <button
                type="button"
                onClick={() => setRawScript(SAMPLE_EXPERIMENT_SCRIPT)}
                className="text-[10px] text-white/50 hover:text-white transition-colors"
              >
                Reset to Default
              </button>
            </div>

            <p className="text-[11px] text-white/50 leading-relaxed">
              Use directives like <code className="text-purple-300 bg-white/5 px-1 py-0.5 rounded">[sentence: N]</code>, <code className="text-purple-300 bg-white/5 px-1 py-0.5 rounded">[pace: fast/slow/normal]</code>, <code className="text-purple-300 bg-white/5 px-1 py-0.5 rounded">[pause: 3s]</code>, and <code className="text-purple-300 bg-white/5 px-1 py-0.5 rounded">[sound: excited/surprised/laugh]</code>.
            </p>

            <textarea
              value={rawScript}
              onChange={e => setRawScript(e.target.value)}
              rows={16}
              className="w-full rounded-xl bg-black/60 border border-white/10 p-3.5 text-xs text-white font-mono leading-relaxed focus:outline-none focus:border-purple-500 resize-none"
              dir="auto"
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleParseOnly}
                className="px-4 py-2.5 rounded-xl border border-white/20 hover:bg-white/5 text-xs font-semibold text-white transition-all flex items-center gap-1.5"
              >
                <span>Parse Only</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateAllAndCompose}
                disabled={isProcessingAll}
                className="flex-1 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isProcessingAll ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Generate & Compose All</span>
                  </>
                )}
              </button>
            </div>

            {processingStatus && (
              <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-200 text-[11px] flex items-center gap-2">
                <Loader2 size={13} className="animate-spin shrink-0 text-purple-400" />
                <span className="truncate">{processingStatus}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Parsed Sequence & Audio Timeline */}
        <div className="lg:col-span-7 space-y-6">
          {/* Master Composed Player Card */}
          {composedAudioUrl && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-black to-purple-950/40 border border-emerald-500/30 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
                    Composed Master Audio
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
                    Total: {composedDuration?.toFixed(2)}s
                  </span>
                  {composedSamples && (
                    <span className="text-[10px] font-mono text-white/40">
                      ({composedSamples.toLocaleString()} samples @ 24kHz)
                    </span>
                  )}
                </div>
              </div>

              {/* Master Audio Tag */}
              <div className="w-full bg-black/60 p-3 rounded-xl border border-white/10 flex items-center gap-3">
                <audio
                  ref={masterAudioRef}
                  controls
                  src={composedAudioUrl}
                  className="w-full h-10 accent-purple-500"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-4 text-xs text-white/60">
                  <span>Speech: <strong>{totalSpeechDuration.toFixed(2)}s</strong></span>
                  <span>•</span>
                  <span>Digital Silence: <strong>{totalPauseDuration.toFixed(2)}s</strong></span>
                </div>

                <a
                  href={`${composedAudioUrl}?download=true&filename=doudouvoice-experiment.wav`}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-md shadow-emerald-500/20"
                >
                  <Download size={14} />
                  <span>Download Master WAV</span>
                </a>
              </div>
            </motion.div>
          )}

          {/* Timeline Segments Breakdown */}
          <div className="p-6 rounded-2xl bg-[#0c0c0e] border border-white/10 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2 text-white">
                <Clock size={16} className="text-purple-400" />
                <span>Parsed Timeline Sequence ({segments.length} items)</span>
              </h3>

              {segments.some(s => s.type !== 'pause' && (s as any).audioUrl) && (
                <button
                  type="button"
                  onClick={handleComposeOnly}
                  disabled={isComposing}
                  className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 transition-colors"
                >
                  {isComposing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  <span>Re-compose WAV</span>
                </button>
              )}
            </div>

            {segments.length === 0 ? (
              <p className="text-xs text-white/40 py-8 text-center">
                No segments parsed yet. Click &quot;Parse Only&quot; or &quot;Generate &amp; Compose All&quot;.
              </p>
            ) : (
              <div className="space-y-3">
                {segments.map((seg, idx) => {
                  if (seg.type === 'pause') {
                    const numSamples = Math.round(seg.durationSec * 24000);
                    return (
                      <div
                        key={seg.id || idx}
                        className="p-3.5 rounded-xl bg-white/[0.02] border border-dashed border-white/20 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center font-mono text-[10px] text-white/40">
                            {idx + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] uppercase font-bold tracking-wider">
                              Digital Silence
                            </span>
                            <span className="text-white/80 font-medium">
                              Requested Pause: <strong>{seg.durationSec}s</strong>
                            </span>
                          </div>
                        </div>

                        <div className="text-right text-[10px] font-mono text-white/40">
                          {numSamples.toLocaleString()} zeroes @ 24kHz (sample-level precision)
                        </div>
                      </div>
                    );
                  }

                  if (seg.type === 'sound') {
                    const isReady = seg.status === 'ready' && seg.audioUrl;
                    const isPlaying = currentlyPlayingId === seg.id;

                    return (
                      <div
                        key={seg.id || idx}
                        className="p-4 rounded-xl bg-gradient-to-r from-amber-950/20 to-black border border-amber-500/20 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-300 flex items-center justify-center font-mono text-[10px] font-bold">
                              {idx + 1}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-300 font-mono text-[10px] uppercase font-bold flex items-center gap-1">
                              {seg.soundType === 'laugh' ? <Laugh size={11} /> : <Flame size={11} />}
                              <span>Sound: {seg.soundType}</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {seg.durationSec && (
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-amber-300">
                                {seg.durationSec.toFixed(2)}s
                              </span>
                            )}

                            {isReady && (
                              <button
                                type="button"
                                onClick={() => handlePlayAudio(seg.id, seg.audioUrl!)}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors ${
                                  isPlaying ? 'bg-amber-500 text-black' : 'bg-white/10 hover:bg-white/20 text-white'
                                }`}
                              >
                                {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleGenerateSingleSegment(idx)}
                              disabled={seg.status === 'generating'}
                              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white/70 transition-colors flex items-center gap-1"
                              title="Regenerate this segment"
                            >
                              {seg.status === 'generating' ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                              <span>Regen</span>
                            </button>
                          </div>
                        </div>

                        <p className="text-base text-white/90 font-bold px-1" dir="rtl">
                          {seg.text}
                        </p>

                        {seg.error && (
                          <p className="text-[10px] text-red-400">{seg.error}</p>
                        )}
                      </div>
                    );
                  }

                  // Speech segment
                  const isReady = seg.status === 'ready' && seg.audioUrl;
                  const isPlaying = currentlyPlayingId === seg.id;
                  const paceColor =
                    seg.pace === 'fast' ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                    : seg.pace === 'slow' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    : 'bg-white/10 text-white/80 border-white/20';

                  return (
                    <div
                      key={seg.id || idx}
                      className="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-2 hover:border-white/20 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center font-mono text-[10px] text-white/60">
                            {idx + 1}
                          </span>
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase font-bold tracking-wider ${paceColor}`}>
                            Pace: {seg.pace}
                          </span>
                          {seg.sentenceNumber && (
                            <span className="text-[10px] text-white/40 font-mono">
                              Sentence #{seg.sentenceNumber}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {seg.durationSec && (
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-purple-300">
                              {seg.durationSec.toFixed(2)}s
                            </span>
                          )}

                          {isReady && (
                            <button
                              type="button"
                              onClick={() => handlePlayAudio(seg.id, seg.audioUrl!)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors ${
                                isPlaying ? 'bg-purple-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                              }`}
                            >
                              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleGenerateSingleSegment(idx)}
                            disabled={seg.status === 'generating'}
                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white/70 transition-colors flex items-center gap-1"
                            title="Regenerate this segment"
                          >
                            {seg.status === 'generating' ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                            <span>Regen</span>
                          </button>
                        </div>
                      </div>

                      <p className="text-sm text-white/90 leading-relaxed px-1" dir="rtl">
                        {seg.text}
                      </p>

                      {seg.error && (
                        <p className="text-[10px] text-red-400">{seg.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Experimental Observations & Metrics Card */}
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/60 flex items-center gap-2">
              <HelpCircle size={14} className="text-purple-400" />
              <span>Experiment Findings &amp; Measured Metrics</span>
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-1">
                <span className="text-[10px] uppercase font-mono text-white/40 block">Speech Speed Variance</span>
                <p className="text-white/80 leading-relaxed text-[11px]">
                  {fastSegment && slowSegment ? (
                    <>
                      Fast: <strong>{fastSegment.durationSec?.toFixed(2)}s</strong> vs Slow: <strong>{slowSegment.durationSec?.toFixed(2)}s</strong>. Ratio: <strong>{((slowSegment.durationSec || 1) / (fastSegment.durationSec || 1)).toFixed(2)}x</strong> slower!
                    </>
                  ) : (
                    'Generate fast and slow segments to compare measured duration ratio.'
                  )}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-1">
                <span className="text-[10px] uppercase font-mono text-white/40 block">Silence Precision</span>
                <p className="text-white/80 leading-relaxed text-[11px]">
                  Digital silence is synthesized directly in raw PCM (24,000 zeros/sec) guaranteeing 100% sample-accurate pauses without model approximation.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-1">
                <span className="text-[10px] uppercase font-mono text-white/40 block">Vocal Reactions</span>
                <p className="text-white/80 leading-relaxed text-[11px]">
                  Excited (&quot;واااو!&quot;) and Surprised (&quot;أوووه!&quot;) produce vivid pitch spikes. Laugh (&quot;هاهاها!&quot;) generates chuckled vocalization.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
