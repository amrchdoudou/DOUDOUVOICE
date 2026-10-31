import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { Play, Pause, Download, Trash2, Clock, Loader2, Sliders } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { getDialectFlag } from '../lib/utils';

interface HistoryItem {
  id: string;
  text: string;
  dialect: string;
  style: string;
  voice: string;
  audioUrl: string;
  createdAt: any;
}

export default function HistoryPage() {
  const { user, userData } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadedAudios, setLoadedAudios] = useState<Record<string, string>>({});
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentPlayRequestRef = useRef<string | null>(null);

  const handleGoToStudio = (item: HistoryItem) => {
    navigate('/generator', {
      state: {
        text: item.text,
        dialect: item.dialect,
        style: item.style,
        voice: item.voice,
        audioUrl: item.audioUrl,
        openMeta: false
      }
    });
  };

  const handleGoToMeta = (item: HistoryItem) => {
    navigate('/generator', {
      state: {
        text: item.text,
        dialect: item.dialect,
        style: item.style,
        voice: item.voice,
        audioUrl: item.audioUrl,
        openMeta: true,
        metaInitialText: item.text,
        metaInitialDialect: item.dialect,
        metaInitialTone: item.style
      }
    });
  };

  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
      // Revoke created blob URLs to prevent memory leaks
      Object.values(loadedAudios).forEach(val => {
        const url = val as string;
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [loadedAudios]);

  useEffect(() => {
    if (!user) return;
    const fetchHistory = async () => {
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/history', {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          // Map backend language field to dialect for frontend compatibility
          setHistory(data.map((item: any) => ({ ...item, dialect: item.language })));
        }
      } catch (error) {
        console.error("Error fetching history", error);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [user]);

  const handleDelete = async (id: string) => {
    if (!user || !window.confirm(t('delete_recording'))) return;
    try {
      const idToken = await user.getIdToken();
      await fetch(`/api/history/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      setHistory(prev => prev.filter(item => item.id !== id));
      if (loadedAudios[id]) {
        URL.revokeObjectURL(loadedAudios[id]);
        setLoadedAudios(prev => {
          const updated = { ...prev };
          delete updated[id];
          return updated;
        });
      }
    } catch (error) {
      console.error("Error deleting", error);
    }
  };

  const rebuildAudioFromChunks = async (historyId: string): Promise<string | null> => {
    // Left for backwards compatibility if needed, but not required for Postgres backend since we just use audioUrl directly.
    return null;
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

  const playAudio = async (id: string, url: string) => {
    // Immediately pause any active audio
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    // If the user clicked to pause the currently playing audio, we are done
    if (playingId === id) {
      setPlayingId(null);
      currentPlayRequestRef.current = null;
      return;
    }

    // Record the active play request
    currentPlayRequestRef.current = id;
    let audioUrlToPlay = loadedAudios[id] || url;

    // Verify if the url is accessible, or fall back to reconstructing from Firestore chunks
    if (!loadedAudios[id]) {
      setLoadingAudioId(id);
      try {
        const checkRes = await fetch(url, { method: 'HEAD' });
        if (!checkRes.ok) {
          throw new Error("Server audio not found (404)");
        }
      } catch (err) {
        console.log("Server cache missing or inaccessible, rebuilding audio from Firestore chunks...", err);
        const reconstructedUrl = await rebuildAudioFromChunks(id);
        if (reconstructedUrl) {
          audioUrlToPlay = reconstructedUrl;
          setLoadedAudios(prev => ({ ...prev, [id]: reconstructedUrl }));
        } else {
          console.error("Failed to rebuild audio from chunks.");
          setLoadingAudioId(null);
          currentPlayRequestRef.current = null;
          alert(t('download_failed') || "Failed to load audio");
          return;
        }
      } finally {
        setLoadingAudioId(null);
      }
    }

    // Check if this request is still the latest one
    if (currentPlayRequestRef.current !== id) {
      return;
    }

    try {
      const audio = new Audio(audioUrlToPlay);
      activeAudioRef.current = audio;
      setPlayingId(id);
      
      audio.onended = () => {
        if (currentPlayRequestRef.current === id) {
          setPlayingId(null);
          activeAudioRef.current = null;
          currentPlayRequestRef.current = null;
        }
      };

      audio.onerror = (e) => {
        console.error("Audio playback error event:", e);
        if (currentPlayRequestRef.current === id) {
          setPlayingId(null);
          activeAudioRef.current = null;
          currentPlayRequestRef.current = null;
        }
      };

      await audio.play();
    } catch (err: any) {
      // Ignore AbortError since it's expected when user pauses or switches tracks
      if (err.name !== 'AbortError') {
        console.error("Error playing:", err);
      }
      if (currentPlayRequestRef.current === id) {
        setPlayingId(null);
        activeAudioRef.current = null;
        currentPlayRequestRef.current = null;
      }
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">{t('signin_required')}</h2>
        <p className="text-gray-400 mb-8">{t('signin_view_history')}</p>
        <Link to="/" className="text-brand-500 hover:underline">{t('return_home')}</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-white mb-2">{t('history')}</h1>
        <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">{t('past_generations')}</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-white/40 text-sm">{t('loading_history')}</div>
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-12 text-center shadow-2xl">
          <Clock className="mx-auto h-12 w-12 text-white/20 mb-4" />
          <h3 className="text-sm font-medium text-white mb-2 uppercase tracking-widest">{t('no_history')}</h3>
          <p className="text-white/40 text-sm mb-6">{t('no_history_desc')}</p>
          <Link to="/generator" className="inline-flex rounded border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 uppercase tracking-widest transition-colors">
            {t('generate_voice')}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <div key={item.id} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20 shadow-lg">
              <div className="flex-1 min-w-0 w-full">
                <p className="text-lg font-arabic text-white mb-3 truncate font-light" dir="rtl">{item.text}</p>
                <div className="flex flex-wrap gap-2 text-[9px] uppercase tracking-widest font-bold text-white/60">
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1 flex items-center gap-1.5">
                    <span>{getDialectFlag(item.dialect)}</span>
                    <span>{t(item.dialect)}</span>
                  </span>
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1">{t(item.style)}</span>
                  <span className="rounded border border-brand-500/30 bg-brand-500/10 text-brand-500 px-2 py-1">{t(item.voice)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                {/* Go to Studio Button */}
                <button 
                  type="button"
                  onClick={() => handleGoToStudio(item)}
                  className="h-9 px-3 rounded-xl border border-brand-500/30 bg-gradient-to-r from-brand-500/15 to-amber-500/10 hover:from-brand-500/25 hover:to-amber-500/20 text-brand-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm group"
                  title={t('open_in_studio_tooltip')}
                >
                  <Sliders size={13} className="text-brand-400 group-hover:scale-110 transition-transform" />
                  <span>{t('go_to_studio')}</span>
                </button>

                {/* Go to Meta Button */}
                <button 
                  type="button"
                  onClick={() => handleGoToMeta(item)}
                  className="h-9 px-3 rounded-xl border border-blue-400/40 bg-[#0866FF]/20 hover:bg-[#0866FF]/35 text-blue-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(8,102,255,0.3)] group"
                  title={t('edit_with_meta_tooltip')}
                >
                  <svg className="w-3.5 h-2 text-blue-300 group-hover:text-white fill-current shrink-0 transition-colors" viewBox="0 0 24 12" aria-hidden="true">
                    <path d="M11.996 3.125c-1.89-2.07-4.66-2.92-7.16-2.05-3.37 1.17-4.8 5.43-2.3 8.35 1.83 2.14 4.8 2.8 7.42 1.34l.04-.03.04.03c2.62 1.46 5.59.8 7.42-1.34 2.5-2.92 1.07-7.18-2.3-8.35-2.5-.87-5.27-.02-7.16 2.05z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>{t('go_to_meta')}</span>
                </button>

                <div className="h-5 w-[1px] bg-white/10 hidden sm:block mx-0.5" />

                <button 
                  onClick={() => playAudio(item.id, item.audioUrl)}
                  disabled={loadingAudioId === item.id}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${playingId === item.id ? 'bg-brand-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)] border-brand-500' : 'border border-white/20 bg-white/5 text-white hover:bg-white/10'} disabled:opacity-50`}
                  title={playingId === item.id ? t('pause') : t('play')}
                >
                  {loadingAudioId === item.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : playingId === item.id ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} className="ml-0.5" />
                  )}
                </button>
                {userData?.plan === 'Free' ? (
                  <button 
                    onClick={() => alert(t('upgrade_download'))}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/20 cursor-not-allowed"
                    title={t('upgrade_download')}
                  >
                    <Download size={14} />
                  </button>
                ) : (
                  <button 
                    onClick={() => handleDownload(loadedAudios[item.id] || item.audioUrl, "doudouvoice-generation.wav")}
                    className="flex h-9 px-2.5 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white hover:bg-white/10 gap-0.5"
                    title="Download WAV"
                  >
                    <Download size={12} />
                    <span className="text-[8px] font-bold">WAV</span>
                  </button>
                )}
                <button 
                  onClick={() => handleDelete(item.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-red-500 transition-colors hover:bg-red-500/10 hover:border-red-500/50"
                  title={t('delete')}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
