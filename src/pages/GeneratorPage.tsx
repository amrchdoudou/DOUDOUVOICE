import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Play, Pause, Download, Loader2, Settings2, History } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc, Bytes } from 'firebase/firestore';
import { getDialectFlag } from '../lib/utils';

const DIALECTS = [
  'Saudi Arabic',
  'Emirati Arabic (Dubai / UAE)',
  'Omani Arabic',
  'Kuwaiti Arabic',
  'Qatari Arabic',
  'Bahraini Arabic',
  'Egyptian Arabic',
  'Algerian Arabic',
  'Tunisian Arabic',
  'Libyan Arabic',
  'Moroccan Arabic',
  'Syrian Arabic',
  'Palestinian Arabic',
  'Neutral Middle Eastern Arabic'
];

const STYLES = [
  'Premium commercial',
  'Professional business',
  'Friendly',
  'Storytelling',
  'Energetic sales',
  'Luxury brand voice'
];

const VOICES = {
  male: ['Puck', 'Fenrir', 'Zephyr'],
  female: ['Kore', 'Charon', 'Aoede']
};

export default function GeneratorPage() {
  const { user, userData } = useAuth();
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const [dialect, setDialect] = useState(DIALECTS[0]);
  const [style, setStyle] = useState(STYLES[0]);
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [voice, setVoice] = useState(VOICES.male[0]);
  const [emotion, setEmotion] = useState('neutral');
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    
    if (userData?.plan === 'Free' && (userData.generationCount || 0) >= 5) {
      setError(t('limit_error'));
      return;
    }

    const currentUsed = userData?.usedCharacters || 0;
    const limit = userData?.limitCharacters || (userData?.plan === 'Pro' ? 50000 : userData?.plan === 'Business' ? 200000 : 10000);
    if (userData?.plan !== 'Free' && (currentUsed + text.length) > limit) {
      const isAr = document.documentElement.dir === 'rtl';
      setError(
        isAr 
          ? `لقد تجاوزت الحد الأقصى للحروف المسموح به لخطة ${t(userData?.plan || 'Starter')} (${limit.toLocaleString()} حرف). يرجى ترقية خطتك لمواصلة التوليد.`
          : `You have exceeded the character limit for your ${userData?.plan || 'Starter'} plan (${limit.toLocaleString()} chars). Please upgrade to continue.`
      );
      return;
    }

    setIsGenerating(true);
    setAudioUrl(null);
    setIsPlaying(false);
    setError(null);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    try {
      const token = user ? await user.getIdToken() : "";
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          text, dialect, style, voice, speed, pitch, emotion
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      
      setAudioUrl(data.audio);
      
      if (user) {
        const historyDocRef = await addDoc(collection(db, 'users', user.uid, 'history'), {
          userId: user.uid,
          text,
          dialect,
          style,
          voice,
          speed,
          pitch,
          emotion,
          audioUrl: data.audio,
          createdAt: serverTimestamp()
        });

        // Slice the audio into persistent chunks and save to subcollection
        try {
          const audioRes = await fetch(data.audio);
          const arrayBuffer = await audioRes.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          
          const chunkSize = 500 * 1024; // 500KB per chunk
          let index = 0;
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunkBytes = bytes.slice(offset, offset + chunkSize);
            const chunkData = Bytes.fromUint8Array(chunkBytes);
            
            await setDoc(doc(db, 'users', user.uid, 'history', historyDocRef.id, 'chunks', index.toString()), {
              index,
              data: chunkData
            });
            index++;
          }
        } catch (uploadError) {
          console.error("Error saving persistent audio chunks:", uploadError);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('failed_to_generate'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPause = async () => {
    if (!audioRef.current) return;
    try {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        await audioRef.current.play();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Error playing audio:", err);
      }
      setIsPlaying(false);
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    try {
      let downloadUrl = url;
      
      if (!url.startsWith('blob:')) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        downloadUrl = URL.createObjectURL(blob);
      }

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (!url.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(t('download_failed'));
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-y-auto md:overflow-hidden">
      
      {/* Settings Panel Left (originally Dialects) */}
      <aside className="w-full md:w-72 border-b md:border-b-0 md:border-r border-white/10 bg-[#080808] flex-col shrink-0 overflow-y-auto hidden md:flex">
        <div className="p-4 border-b border-white/5">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-3" dir="ltr">{t('select_dialect')}</label>
          <div className="grid grid-cols-1 gap-1" dir="ltr">
            {DIALECTS.map(d => (
              <button 
                key={d}
                onClick={() => setDialect(d)}
                className={`flex items-center justify-between p-2.5 rounded text-sm transition-all ${dialect === d ? 'bg-white/5 border border-brand-500/30 text-white' : 'hover:bg-white/5 text-white/60'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-base shrink-0">{getDialectFlag(d)}</span>
                  <span>{t(d)}</span>
                </span>
                {dialect === d && <span className="text-[10px] text-brand-500 font-bold uppercase tracking-widest">{t('active')}</span>}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Central Editor Area */}
      <section className="flex-none md:flex-1 flex flex-col p-4 md:p-6 gap-6 relative md:overflow-y-auto bg-[#050505] min-h-[500px] md:min-h-0">
        <div className="flex-1 flex flex-col bg-white/[0.02] border border-white/10 rounded-xl overflow-hidden shadow-2xl min-h-[300px]">
          <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10" dir="ltr">
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('text_area')}</span>
            <div className="flex gap-4">
              <span className="text-[10px] text-white/30 font-mono">{t('chars')}: {text.length}/1000</span>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            placeholder={t('text_placeholder')}
            dir="rtl"
            className="flex-1 w-full bg-transparent p-6 md:p-8 text-xl md:text-2xl leading-relaxed text-white resize-none outline-none font-light placeholder:text-white/10 italic font-arabic"
          />
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm flex flex-col gap-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
            <p className="font-bold flex items-center gap-2 text-red-400">
              <span>⚠️ {t('generation_error')}</span>
            </p>
            <p className="text-white/80 leading-relaxed text-xs">{error}</p>
          </div>
        )}

        {/* Floating Control Bar */}
        <div className="md:h-24 bg-[#111] border border-white/10 rounded-xl flex flex-col md:flex-row items-center p-4 md:px-6 gap-4 md:gap-8 shadow-2xl shadow-black shrink-0" dir="ltr">
          <div className="flex flex-col gap-1 flex-1 w-full hidden md:flex">
            <label className="text-[9px] uppercase tracking-tighter text-white/30 font-bold">{t('audio_ready')}</label>
            <div className="flex items-end gap-[2px] h-10 w-full">
              {/* Fake waveform for visual aesthetic matching the design */}
              {[2,4,8,5,3,10,6,8,3,1,2,4,2,1,5,3].map((h, i) => (
                <div key={i} className={`w-1 ${audioUrl ? 'bg-brand-500' : 'bg-white/5'} transition-all duration-500`} style={{height: `${h*4}px`}}></div>
              ))}
            </div>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            {audioUrl && (
              <div className="flex items-center">
                <audio 
                  ref={audioRef} 
                  src={audioUrl} 
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onError={(e) => {
                    console.error("Audio error event:", e);
                    setIsPlaying(false);
                  }}
                  className="hidden" 
                />
                <button 
                  onClick={handlePlayPause}
                  className={`w-12 h-12 rounded-full border flex items-center justify-center transition-colors ${isPlaying ? 'bg-brand-500 text-black border-brand-500 shadow-[0_0_15px_rgba(245,158,11,0.5)]' : 'border-white/20 hover:bg-white/5 text-white'}`}
                  title={isPlaying ? t('pause_audio') : t('play_audio')}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
                </button>
              </div>
            )}
            
            <button
              onClick={() => {
                if (!user) {
                  window.location.href = '/auth';
                  return;
                }
                handleGenerate();
              }}
              disabled={isGenerating || !text.trim()}
              className="px-8 h-12 bg-brand-500 text-black font-bold text-sm rounded hover:bg-brand-400 transition-colors shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2 flex-1 md:flex-none uppercase tracking-widest"
            >
              {isGenerating ? (
                <><Loader2 size={16} className="animate-spin" /> {t('generating')}</>
              ) : !user ? (
                <>{t('signin')}</>
              ) : (
                <>{t('generate')}</>
              )}
            </button>

            {audioUrl && (
              userData?.plan === 'Free' ? (
                <button
                  onClick={() => {
                    alert(t('upgrade_download'));
                  }}
                  className="w-12 h-12 rounded-full border border-white/10 text-white/20 hover:bg-transparent cursor-not-allowed flex items-center justify-center transition-colors"
                  title={t('upgrade_download')}
                >
                  <Download size={20} />
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownload(audioUrl, "doudouvoice-generation.wav")}
                    className="px-4.5 h-12 rounded-full border border-white/20 hover:bg-white/5 text-white flex items-center justify-center gap-1.5 transition-colors"
                    title="Download WAV"
                  >
                    <Download size={16} />
                    <span className="text-[10px] font-bold tracking-wider">WAV</span>
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* Settings Panel Right */}
      <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-white/10 bg-[#080808] p-6 flex flex-col gap-8 shrink-0 md:overflow-y-auto" dir="ltr">
        
        <div className="md:hidden mb-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-4">{t('select_dialect')}</label>
          <select 
            value={dialect}
            onChange={(e) => setDialect(e.target.value)}
            className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            {DIALECTS.map(d => <option key={d} value={d} className="bg-black">{getDialectFlag(d)} {t(d)}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block mb-4">{t('voice_profile')}</label>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 border border-white/20 rounded bg-white/5">
              <div className="w-10 h-10 bg-brand-500/10 rounded flex items-center justify-center text-brand-500 font-bold">
                {gender[0].toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-bold text-white capitalize">{t(voice)} {t('voice')}</p>
                <p className="text-[10px] text-white/40">{t(style)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['male', 'female'] as const).map((g) => (
                <button 
                  key={g}
                  onClick={() => {
                    setGender(g);
                    setVoice(VOICES[g][0]);
                  }}
                  className={`p-2 text-[10px] border rounded transition-all uppercase tracking-widest font-bold ${gender === g ? 'border-brand-500/50 bg-brand-500/10 text-brand-500' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
                >
                  {t(g)}
                </button>
              ))}
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              {VOICES[gender].map((v) => (
                <button 
                  key={v}
                  onClick={() => setVoice(v)}
                  className={`p-2 text-[10px] border rounded transition-all uppercase tracking-widest font-bold ${voice === v ? 'border-brand-500/50 bg-brand-500/10 text-brand-500' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold block">{t('fine_tuning')}</label>
          
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-white/60">
              <span>{t('voice_style')}</span>
            </div>
            <select 
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              {STYLES.map(s => <option key={s} value={s} className="bg-black">{t(s)}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-white/60">
              <span>{t('emotion')}</span>
            </div>
            <select 
              value={emotion}
              onChange={(e) => setEmotion(e.target.value)}
              className="w-full rounded bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="neutral" className="bg-black">{t('neutral')}</option>
              <option value="excited" className="bg-black">{t('excited')}</option>
              <option value="serious" className="bg-black">{t('serious')}</option>
              <option value="warm" className="bg-black">{t('warm')}</option>
            </select>
          </div>
        </div>

        <div className="mt-auto pt-6 pb-6 md:pb-0">
          <div className="p-4 rounded-lg bg-brand-500/5 border border-brand-500/10">
            <p className="text-[10px] text-brand-500/60 uppercase font-bold mb-2 tracking-widest">{t('output_specs')}</p>
            <div className="flex flex-wrap gap-2">
              <span className="px-1.5 py-0.5 rounded border border-white/10 text-[9px] font-mono bg-black text-white/70">48kHz</span>
              <span className="px-1.5 py-0.5 rounded border border-white/10 text-[9px] font-mono bg-black text-white/70">WAV</span>
              <span className="px-1.5 py-0.5 rounded border border-white/10 text-[9px] font-mono bg-black text-white/70">{t('high_bitrate')}</span>
            </div>
          </div>
          
          {!user && (
            <p className="mt-4 text-center text-[10px] text-white/40 uppercase tracking-widest">
              {t('sign_in_save')}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
