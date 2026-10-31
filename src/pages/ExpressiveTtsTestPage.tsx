import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  Pause,
  Download,
  Loader2,
  Volume2,
  Clock,
  Sparkles,
  RotateCcw,
  AlertCircle,
  FileAudio,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';

const DEFAULT_TEST_SCRIPT = `[sentence: 1]
[pace: fast]
راك تسوق كل يوم وجوالك ضايع بين المرتبة والطبلون؟

[sentence: 2]
[pace: slow]
مع MagnaDrive، جوالك يكون قدامك وانت تسوق.

[pause: 3s]

[sound: excited]
واااو!

[pause: 1s]

[sound: surprised]
أوووه!

[pause: 1s]

[sound: laugh]
هاهاها!

[sentence: 3]
[pace: normal]
اطلب MagnaDrive الحين!`;

const DIALECT_OPTIONS = [
  'Saudi Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Algerian Arabic',
  'Egyptian Arabic',
  'Kuwaiti Arabic',
  'Moroccan Arabic',
  'Neutral Middle Eastern Arabic'
];

const VOICE_OPTIONS = ['Puck', 'Fenrir', 'Zephyr', 'Kore', 'Charon', 'Aoede'];

interface ComposedSegment {
  id: string;
  type: 'speech' | 'pause' | 'sound';
  sentenceId?: string;
  pace?: string;
  soundType?: string;
  text?: string;
  durationSec: number;
  audioUrl?: string;
  error?: string;
}

interface ComposedResult {
  segments: ComposedSegment[];
  masterAudioUrl: string;
  totalDurationSec: number;
  speechDurationSec: number;
  silenceDurationSec: number;
  sampleRate: number;
  totalSamples: number;
}

export default function ExpressiveTtsTestPage() {
  const { user } = useAuth();
  const { language } = useLanguage();

  const [scriptText, setScriptText] = useState(DEFAULT_TEST_SCRIPT);
  const [dialect, setDialect] = useState('Saudi Arabic');
  const [voice, setVoice] = useState('Puck');

  const [isProcessing, setIsProcessing] = useState(false);
  const [regeneratingSegmentId, setRegeneratingSegmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposedResult | null>(null);

  // Audio preview playback
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayToggle = (url?: string) => {
    if (!url) return;
    if (playingAudioUrl === url) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      setPlayingAudioUrl(null);
    } else {
      setPlayingAudioUrl(url);
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = url;
        audioPlayerRef.current.play().catch(console.error);
      }
    }
  };

  const handleComposeFull = async () => {
    if (!scriptText.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      const idToken = user ? await user.getIdToken() : '';
      const res = await fetch('/api/experiment/compose-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          script: scriptText,
          dialect,
          voice
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to compose expressive TTS');
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Error occurred during composition');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerateSegment = async (seg: ComposedSegment) => {
    if (seg.type === 'pause') return;
    setRegeneratingSegmentId(seg.id);
    setError(null);

    try {
      const idToken = user ? await user.getIdToken() : '';
      const res = await fetch('/api/experiment/generate-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          segment: {
            id: seg.id,
            type: seg.type,
            pace: seg.pace,
            soundType: seg.soundType,
            text: seg.text
          },
          dialect,
          voice
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate segment');
      }

      // Update segment in state
      if (result) {
        const updatedSegments = result.segments.map(s => {
          if (s.id === seg.id) {
            return {
              ...s,
              durationSec: data.durationSec,
              audioUrl: data.audioUrl,
              error: undefined
            };
          }
          return s;
        });

        // Recalculate speech duration
        const newSpeechDuration = updatedSegments
          .filter(s => s.type !== 'pause')
          .reduce((sum, s) => sum + s.durationSec, 0);

        setResult({
          ...result,
          segments: updatedSegments,
          speechDurationSec: Number(newSpeechDuration.toFixed(2)),
          totalDurationSec: Number((newSpeechDuration + result.silenceDurationSec).toFixed(2))
        });
      }
    } catch (err: any) {
      setError(`Failed to regenerate segment ${seg.id}: ${err.message}`);
    } finally {
      setRegeneratingSegmentId(null);
    }
  };

  return (
    <div className="min-h-full bg-[#050505] text-white p-4 md:p-8 flex flex-col items-center">
      {/* Hidden Global Audio Player */}
      <audio
        ref={audioPlayerRef}
        onEnded={() => setPlayingAudioUrl(null)}
        onError={() => setPlayingAudioUrl(null)}
      />

      <div className="w-full max-w-5xl space-y-6">
        {/* Header Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-amber-500/10 via-brand-500/10 to-transparent border border-brand-500/20 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-mono uppercase tracking-wider font-bold">
                Phase 1 Experiment
              </span>
              <span className="text-white/40 text-xs font-mono">gemini-3.1-flash-tts-preview</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Sparkles className="text-brand-400" size={22} />
              <span>Expressive TTS, Timing & Silence Lab</span>
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-2xl">
              Testing segment-level pacing directives (<code className="text-amber-300">[pace: fast|slow]</code>), exact sample-accurate digital silence (<code className="text-amber-300">[pause: 3s]</code>), and expressive reaction vocalizations without modifying production TTS.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2 shrink-0">
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase text-white/40 tracking-wider block font-bold">Dialect</label>
              <select
                value={dialect}
                onChange={(e) => setDialect(e.target.value)}
                className="bg-transparent text-xs text-white border-0 outline-none font-medium"
              >
                {DIALECT_OPTIONS.map(d => <option key={d} value={d} className="bg-black text-white">{d}</option>)}
              </select>
            </div>
            <div className="w-[1px] h-6 bg-white/10 mx-1" />
            <div className="space-y-0.5">
              <label className="text-[10px] uppercase text-white/40 tracking-wider block font-bold">Voice</label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="bg-transparent text-xs text-white border-0 outline-none font-medium"
              >
                {VOICE_OPTIONS.map(v => <option key={v} value={v} className="bg-black text-white">{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-center gap-3">
            <AlertCircle size={18} className="text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Script Editor Card */}
        <div className="p-6 rounded-2xl bg-[#0c0c0d] border border-white/10 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <FileAudio size={16} className="text-brand-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-white">Experimental Script Markup</span>
            </div>
            <button
              type="button"
              onClick={() => setScriptText(DEFAULT_TEST_SCRIPT)}
              className="text-[11px] text-white/40 hover:text-white flex items-center gap-1 transition-colors"
            >
              <RotateCcw size={12} />
              <span>Reset to Test Script</span>
            </button>
          </div>

          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={12}
            dir="rtl"
            className="w-full bg-black/60 border border-white/10 rounded-xl p-4 text-sm text-white font-mono leading-relaxed outline-none focus:border-brand-500"
            placeholder="Enter test script with [sentence: 1], [pace: fast], [pause: 3s], [sound: excited]..."
          />

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <Info size={13} className="text-amber-400" />
              <span>Supports <code className="text-white/80">[pace: fast|slow|normal]</code>, <code className="text-white/80">[pause: Xs]</code>, and <code className="text-white/80">[sound: excited|surprised|laugh]</code></span>
            </div>

            <button
              type="button"
              onClick={handleComposeFull}
              disabled={isProcessing || !scriptText.trim()}
              className="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50 flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Generating & Composing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Run Composition & Timing Test</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results & Inspection Section */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Master Audio Track Card */}
            <div className="p-6 rounded-2xl bg-[#0e0e10] border border-white/15 shadow-2xl space-y-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-brand-400 font-bold block">Experiment 5</span>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-400" />
                    <span>Master Composed Audio (WAV 24kHz Mono)</span>
                  </h3>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handlePlayToggle(result.masterAudioUrl)}
                    className="px-5 py-2.5 rounded-xl bg-white hover:bg-white/90 text-black text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
                  >
                    {playingAudioUrl === result.masterAudioUrl ? <Pause size={14} /> : <Play size={14} />}
                    <span>{playingAudioUrl === result.masterAudioUrl ? 'Pause Master' : 'Play Master'}</span>
                  </button>

                  <a
                    href={`${result.masterAudioUrl}?download=true&filename=doudouvoice-experiment-master.wav`}
                    className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors border border-white/10"
                  >
                    <Download size={14} />
                    <span>Download WAV</span>
                  </a>
                </div>
              </div>

              {/* Timing Breakdown Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-white/40 uppercase block font-bold">Total Duration</span>
                  <span className="text-lg font-black text-white font-mono">{result.totalDurationSec.toFixed(2)}s</span>
                </div>
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-white/40 uppercase block font-bold">Speech Duration</span>
                  <span className="text-lg font-black text-amber-300 font-mono">{result.speechDurationSec.toFixed(2)}s</span>
                </div>
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-white/40 uppercase block font-bold">Digital Silence</span>
                  <span className="text-lg font-black text-sky-400 font-mono">{result.silenceDurationSec.toFixed(2)}s</span>
                </div>
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-white/40 uppercase block font-bold">Sample Count</span>
                  <span className="text-lg font-black text-white/70 font-mono">{result.totalSamples.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Segment Breakdown Inspection Cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-widest text-white/60">
                  Parsed Sequence & Segment Duration Breakdown ({result.segments.length} segments)
                </h4>
                <span className="text-[11px] text-white/40 font-mono">
                  Sample-accurate timing measurement
                </span>
              </div>

              <div className="space-y-2.5">
                {result.segments.map((seg, idx) => {
                  const isPlayingThis = playingAudioUrl === seg.audioUrl;
                  const isRegeneratingThis = regeneratingSegmentId === seg.id;

                  return (
                    <div
                      key={seg.id || idx}
                      className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
                        seg.type === 'pause'
                          ? 'bg-sky-500/[0.03] border-sky-500/20'
                          : seg.type === 'sound'
                          ? 'bg-purple-500/[0.04] border-purple-500/20'
                          : 'bg-white/[0.02] border-white/10'
                      }`}
                    >
                      <div className="flex items-start md:items-center gap-3">
                        {/* Step Index */}
                        <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-mono text-white/60 shrink-0">
                          {idx + 1}
                        </span>

                        {/* Tag Badge */}
                        <div className="flex flex-wrap items-center gap-2">
                          {seg.type === 'pause' && (
                            <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/30 text-sky-300 font-mono text-[10px] font-bold uppercase">
                              [Pause: {seg.durationSec.toFixed(1)}s Digital Silence]
                            </span>
                          )}

                          {seg.type === 'speech' && (
                            <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase border ${
                              seg.pace === 'fast'
                                ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                                : seg.pace === 'slow'
                                ? 'bg-blue-500/20 border-blue-500/30 text-blue-300'
                                : 'bg-white/10 border-white/20 text-white/80'
                            }`}>
                              Sentence {seg.sentenceId || ''} • Pace: {seg.pace || 'normal'}
                            </span>
                          )}

                          {seg.type === 'sound' && (
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 font-mono text-[10px] font-bold uppercase">
                              Sound: {seg.soundType}
                            </span>
                          )}

                          {/* Text Preview */}
                          {seg.text && (
                            <span className="text-sm text-white font-medium mr-2" dir="rtl">
                              &ldquo;{seg.text}&rdquo;
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right: Duration Measurement & Controls */}
                      <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-white/70">
                          <Clock size={13} className="text-white/40" />
                          <span className="font-bold text-white">{seg.durationSec.toFixed(2)}s</span>
                        </div>

                        {/* Play segment button */}
                        {seg.audioUrl && (
                          <button
                            type="button"
                            onClick={() => handlePlayToggle(seg.audioUrl)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
                              isPlayingThis
                                ? 'bg-brand-500 border-brand-400 text-black'
                                : 'bg-white/5 hover:bg-white/15 border-white/10 text-white'
                            }`}
                            title="Play this segment individually"
                          >
                            {isPlayingThis ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                        )}

                        {/* Regenerate segment button */}
                        {seg.type !== 'pause' && (
                          <button
                            type="button"
                            onClick={() => handleRegenerateSegment(seg)}
                            disabled={isRegeneratingThis}
                            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/60 hover:text-white transition-colors disabled:opacity-50 flex items-center gap-1"
                            title="Regenerate this segment independently"
                          >
                            {isRegeneratingThis ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                            <span className="hidden sm:inline">Regen</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
