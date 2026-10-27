import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Loader2, Play, Pause, Save, Star, Volume2, CheckCircle2, AlertCircle } from 'lucide-react';
import { KABYLE_REGIONS } from '../lib/kabyle';

interface TestSentence {
  id: string;
  text: string;
  region: string;
  expected_note?: string;
}

interface SentenceRating {
  sentenceId: string;
  voiceA: string;
  voiceB: string;
  ratingA: number;
  ratingB: number;
  notes: string;
  updatedAt?: string;
}

const VOICES = ['Puck', 'Fenrir', 'Zephyr', 'Kore', 'Charon', 'Aoede'];

export default function KabyleTestPage() {
  const { user, loading: authLoading } = useAuth();
  const [sentences, setSentences] = useState<TestSentence[]>([]);
  const [ratings, setRatings] = useState<Record<string, SentenceRating>>({});
  const [voiceA, setVoiceA] = useState('Puck');
  const [voiceB, setVoiceB] = useState('Kore');
  const [audioUrls, setAudioUrls] = useState<Record<string, { voiceA?: string; voiceB?: string }>>({});
  const [loadingAudio, setLoadingAudio] = useState<Record<string, boolean>>({});
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  const isAdmin = user?.email === 'abdelwadoudamirouche7@gmail.com';

  useEffect(() => {
    if (!isAdmin) return;

    async function loadTestData() {
      try {
        const token = await user?.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };

        // 1. Load test sentences
        const sentRes = await fetch('/api/kabyle-test/sentences', { headers });
        if (sentRes.ok) {
          const sentData = await sentRes.json();
          setSentences(sentData);
        }

        // 2. Load existing ratings
        const ratRes = await fetch('/api/kabyle-test/ratings', { headers });
        if (ratRes.ok) {
          const ratData = await ratRes.json();
          setRatings(ratData);
        }
      } catch (err: any) {
        console.error('Failed to load Kabyle test data:', err);
        setError(err.message || 'Failed to load test suite');
      }
    }

    loadTestData();
  }, [user, isAdmin]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#050505] text-white">
        <Loader2 className="animate-spin text-brand-500" size={32} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#050505] p-6 text-center text-white">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h1 className="text-xl font-bold">Admin Quality Testing Only</h1>
        <p className="mt-2 text-sm text-white/50 max-w-md">
          This evaluation workbench is restricted to authorized testing in development mode.
        </p>
      </div>
    );
  }

  const handleGenerateVoice = async (sentence: TestSentence, slot: 'voiceA' | 'voiceB') => {
    const selectedVoice = slot === 'voiceA' ? voiceA : voiceB;
    const reqKey = `${sentence.id}_${slot}`;

    setLoadingAudio(prev => ({ ...prev, [reqKey]: true }));
    setError(null);

    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          text: sentence.text,
          dialect: 'Algerian Kabyle (Taqbaylit)',
          kabyleRegion: sentence.region || 'default',
          style: 'Friendly',
          voice: selectedVoice,
          speed: 1.0,
          pitch: 0,
          emotion: 'neutral'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'TTS generation failed');

      setAudioUrls(prev => ({
        ...prev,
        [sentence.id]: {
          ...prev[sentence.id],
          [slot]: data.audio
        }
      }));
    } catch (err: any) {
      console.error(err);
      setError(`[${slot.toUpperCase()}] ${err.message || 'Generation failed'}`);
    } finally {
      setLoadingAudio(prev => ({ ...prev, [reqKey]: false }));
    }
  };

  const handleTogglePlay = (audioKey: string, url: string) => {
    // Pause any currently playing
    if (playingKey && playingKey !== audioKey && audioRefs.current[playingKey]) {
      audioRefs.current[playingKey].pause();
    }

    if (!audioRefs.current[audioKey]) {
      const audio = new Audio(url);
      audio.onended = () => setPlayingKey(null);
      audio.onerror = () => setPlayingKey(null);
      audioRefs.current[audioKey] = audio;
    }

    const currentAudio = audioRefs.current[audioKey];
    if (playingKey === audioKey) {
      currentAudio.pause();
      setPlayingKey(null);
    } else {
      currentAudio.play();
      setPlayingKey(audioKey);
    }
  };

  const updateRating = (sentenceId: string, patch: Partial<SentenceRating>) => {
    setRatings(prev => {
      const current = prev[sentenceId] || {
        sentenceId,
        voiceA,
        voiceB,
        ratingA: 0,
        ratingB: 0,
        notes: ''
      };
      return {
        ...prev,
        [sentenceId]: {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString()
        }
      };
    });
  };

  const handleSaveRatings = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/kabyle-test/ratings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(ratings)
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save');
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to save ratings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 bg-[#050505] text-white p-6 md:p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-brand-500/20 text-brand-400 border border-brand-500/30 uppercase tracking-widest">
                Dev Quality Workbench
              </span>
              <span className="text-xs text-white/40 font-mono">kabyle-test-set.json</span>
            </div>
            <h1 className="text-2xl font-bold mt-1 text-white">Kabyle TTS Quality Evaluation</h1>
            <p className="text-xs text-white/50 mt-1">
              Compare 2 voices across regional variants, evaluate phonology (spirantization, loanwords, cadence), and save ratings.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveRatings}
              disabled={saving}
              className="px-4 py-2 bg-brand-500 hover:bg-brand-400 text-black font-bold text-xs rounded flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Save Evaluation Ratings</span>
            </button>
          </div>
        </div>

        {saveSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>Ratings successfully saved to local file (kabyle-test-ratings.json)</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg text-xs flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Global Voice Comparison Selectors */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 uppercase tracking-widest font-semibold">Voice A:</label>
              <select
                value={voiceA}
                onChange={(e) => setVoiceA(e.target.value)}
                className="bg-black/60 border border-white/20 rounded px-2.5 py-1 text-xs text-white"
              >
                {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 uppercase tracking-widest font-semibold">Voice B:</label>
              <select
                value={voiceB}
                onChange={(e) => setVoiceB(e.target.value)}
                className="bg-black/60 border border-white/20 rounded px-2.5 py-1 text-xs text-white"
              >
                {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="text-[11px] text-white/40 font-mono">
            Loaded sentences: {sentences.length}
          </div>
        </div>

        {/* Sentence Cards */}
        <div className="space-y-4">
          {sentences.map((sent, index) => {
            const currentRating = ratings[sent.id] || {
              sentenceId: sent.id,
              voiceA,
              voiceB,
              ratingA: 0,
              ratingB: 0,
              notes: ''
            };

            const keyA = `${sent.id}_voiceA`;
            const keyB = `${sent.id}_voiceB`;
            const audioA = audioUrls[sent.id]?.voiceA;
            const audioB = audioUrls[sent.id]?.voiceB;
            const isRegInfo = KABYLE_REGIONS[sent.region] || KABYLE_REGIONS['default'];

            return (
              <div
                key={sent.id || index}
                className="p-5 rounded-xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all flex flex-col gap-4"
              >
                {/* Sentence Info Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-white/60">
                        #{sent.id}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20 font-medium">
                        {isRegInfo.labelEn}
                      </span>
                    </div>
                    <p className="text-lg font-medium text-white/95 pt-1">
                      {sent.text}
                    </p>
                    {sent.expected_note && (
                      <p className="text-xs text-white/40 italic">
                        Target: {sent.expected_note}
                      </p>
                    )}
                  </div>
                </div>

                {/* Voice Comparison Controls */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                  
                  {/* Voice A Slot */}
                  <div className="p-3.5 rounded-lg bg-black/40 border border-white/10 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Volume2 size={15} className="text-brand-400" />
                        <span className="text-xs font-bold text-white">Voice A ({voiceA})</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {audioA && (
                          <button
                            onClick={() => handleTogglePlay(keyA, audioA)}
                            className="p-1.5 rounded-full bg-brand-500 text-black hover:bg-brand-400 transition-colors"
                            title="Play/Pause"
                          >
                            {playingKey === keyA ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleGenerateVoice(sent, 'voiceA')}
                          disabled={loadingAudio[keyA]}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-white/20 hover:bg-white/10 text-white/80 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {loadingAudio[keyA] && <Loader2 size={11} className="animate-spin" />}
                          <span>{audioA ? 'Regenerate' : 'Generate'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Star Rating for Voice A */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] uppercase text-white/40 tracking-wider">Score:</span>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => updateRating(sent.id, { ratingA: star })}
                          className={`p-0.5 transition-colors ${
                            star <= currentRating.ratingA ? 'text-amber-400' : 'text-white/20 hover:text-white/40'
                          }`}
                        >
                          <Star size={14} fill={star <= currentRating.ratingA ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                      <span className="text-[11px] text-white/50 ml-1 font-mono">
                        {currentRating.ratingA ? `${currentRating.ratingA}/5` : '-'}
                      </span>
                    </div>
                  </div>

                  {/* Voice B Slot */}
                  <div className="p-3.5 rounded-lg bg-black/40 border border-white/10 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Volume2 size={15} className="text-indigo-400" />
                        <span className="text-xs font-bold text-white">Voice B ({voiceB})</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {audioB && (
                          <button
                            onClick={() => handleTogglePlay(keyB, audioB)}
                            className="p-1.5 rounded-full bg-indigo-500 text-white hover:bg-indigo-400 transition-colors"
                            title="Play/Pause"
                          >
                            {playingKey === keyB ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleGenerateVoice(sent, 'voiceB')}
                          disabled={loadingAudio[keyB]}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-white/20 hover:bg-white/10 text-white/80 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {loadingAudio[keyB] && <Loader2 size={11} className="animate-spin" />}
                          <span>{audioB ? 'Regenerate' : 'Generate'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Star Rating for Voice B */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[10px] uppercase text-white/40 tracking-wider">Score:</span>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => updateRating(sent.id, { ratingB: star })}
                          className={`p-0.5 transition-colors ${
                            star <= currentRating.ratingB ? 'text-indigo-400' : 'text-white/20 hover:text-white/40'
                          }`}
                        >
                          <Star size={14} fill={star <= currentRating.ratingB ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                      <span className="text-[11px] text-white/50 ml-1 font-mono">
                        {currentRating.ratingB ? `${currentRating.ratingB}/5` : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Free Text Notes */}
                <div className="pt-2">
                  <input
                    type="text"
                    value={currentRating.notes || ''}
                    onChange={(e) => updateRating(sent.id, { notes: e.target.value })}
                    placeholder="Linguistic notes: spirantization (b, t, d), pharyngeals (ḥ, ɛ), cadence, loanword adaptation..."
                    className="w-full bg-black/50 border border-white/10 rounded px-3 py-1.5 text-xs text-white placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
