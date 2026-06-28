import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { db } from '../lib/firebase';
import { collection, query, orderBy, getDocs, deleteDoc, doc, Bytes } from 'firebase/firestore';
import { Play, Pause, Download, Trash2, Clock, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadedAudios, setLoadedAudios] = useState<Record<string, string>>({});
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

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
        const q = query(
          collection(db, 'users', user.uid, 'history'),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as HistoryItem[];
        setHistory(data);
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
      await deleteDoc(doc(db, 'users', user.uid, 'history', id));
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
    if (!user) return null;
    try {
      const chunksSnap = await getDocs(
        query(
          collection(db, 'users', user.uid, 'history', historyId, 'chunks'),
          orderBy('index')
        )
      );
      
      if (chunksSnap.empty) {
        console.warn("No persistent audio chunks found in Firestore for:", historyId);
        return null;
      }
      
      const chunkArrays: Uint8Array[] = [];
      chunksSnap.docs.forEach(docSnap => {
        const chunkData = docSnap.data();
        if (chunkData.data && typeof chunkData.data.toUint8Array === 'function') {
          const bytes = chunkData.data.toUint8Array();
          chunkArrays.push(bytes);
        }
      });
      
      if (chunkArrays.length === 0) return null;

      // Calculate total length
      const totalLength = chunkArrays.reduce((sum, arr) => sum + arr.length, 0);
      const combined = new Uint8Array(totalLength);
      
      let offset = 0;
      chunkArrays.forEach(arr => {
        combined.set(arr, offset);
        offset += arr.length;
      });
      
      const blob = new Blob([combined], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Error rebuilding audio from chunks:", err);
      return null;
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(t('download_failed'));
    }
  };

  const playAudio = async (id: string, url: string) => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      if (playingId === id) {
        setPlayingId(null);
        activeAudioRef.current = null;
        return;
      }
    }

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
        }
      } finally {
        setLoadingAudioId(null);
      }
    }

    const audio = new Audio(audioUrlToPlay);
    activeAudioRef.current = audio;
    setPlayingId(id);
    
    audio.play().catch(err => {
      console.error("Error playing:", err);
    });
    
    audio.onended = () => {
      setPlayingId(null);
      activeAudioRef.current = null;
    };
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
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1">{t(item.dialect)}</span>
                  <span className="rounded border border-white/10 bg-white/5 px-2 py-1">{t(item.style)}</span>
                  <span className="rounded border border-brand-500/30 bg-brand-500/10 text-brand-500 px-2 py-1">{t(item.voice)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <button 
                  onClick={() => playAudio(item.id, item.audioUrl)}
                  disabled={loadingAudioId === item.id}
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${playingId === item.id ? 'bg-brand-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.5)] border-brand-500' : 'border border-white/20 bg-white/5 text-white hover:bg-white/10'} disabled:opacity-50`}
                  title={playingId === item.id ? t('pause') : t('play')}
                >
                  {loadingAudioId === item.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : playingId === item.id ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} className="ml-0.5" />
                  )}
                </button>
                <button 
                  onClick={() => {
                    if (userData?.plan === 'Free') {
                      alert(t('upgrade_download'));
                      return;
                    }
                    handleDownload(loadedAudios[item.id] || item.audioUrl, "doudouvoice-generation.wav");
                  }}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                    userData?.plan === 'Free'
                      ? 'border-white/10 text-white/20 hover:bg-transparent cursor-not-allowed'
                      : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                  }`}
                  title={userData?.plan === 'Free' ? t('upgrade_download') : t('download_audio')}
                >
                  <Download size={16} />
                </button>
                <button 
                  onClick={() => handleDelete(item.id)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-red-500 transition-colors hover:bg-red-500/10 hover:border-red-500/50"
                  title={t('delete')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
