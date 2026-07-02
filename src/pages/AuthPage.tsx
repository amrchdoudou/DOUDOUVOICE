import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { signInWithGoogle, auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();

  // Redirect if already logged in
  React.useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await signInWithGoogle();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
    }
  };

  return (
    <div className="flex-1 w-full flex items-center justify-center bg-[#050505] p-6 overflow-hidden relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-500/10 rounded-full blur-[120px] pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-2xl flex flex-col gap-8 relative z-10 backdrop-blur-sm"
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <img 
            src="/logo.png" 
            alt="DoudouVoice" 
            className="w-12 h-12 rounded-xl object-contain" 
            referrerPolicy="no-referrer" 
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {isLogin ? t('welcome_back') : t('create_account')}
            </h1>
            <p className="text-white/40 text-sm">
              {isLogin ? t('signin_desc') : t('signup_desc')}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-white/50 px-1">{t('email')}</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-brand-500/50 transition-colors"
                placeholder="hello@example.com"
              />
            </div>
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-white/50 px-1">{t('password')}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={18} />
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-brand-500/50 transition-colors"
                placeholder="••••••••"
                minLength={6}
              />
            </div>
          </div>

          <button 
            disabled={loading}
            type="submit" 
            className="w-full bg-white text-black hover:bg-neutral-200 transition-colors py-3 rounded-xl font-medium flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
          >
            {loading ? 'Processing...' : isLogin ? t('sign_in') : t('sign_up')}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="relative flex items-center py-2">
          <div className="flex-grow border-t border-white/10"></div>
          <span className="flex-shrink-0 mx-4 text-white/30 text-xs uppercase tracking-widest font-bold">{t('or_continue_with')}</span>
          <div className="flex-grow border-t border-white/10"></div>
        </div>

        <button 
          onClick={handleGoogleAuth}
          className="w-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors py-3 rounded-xl font-medium text-white flex items-center justify-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {t('google_signin')}
        </button>

        <div className="text-center text-sm text-white/50">
          {isLogin ? t('dont_have_account') : t('already_have_account')}
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-brand-500 hover:text-brand-400 font-medium transition-colors ml-1"
          >
            {isLogin ? t('sign_up') : t('sign_in')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
