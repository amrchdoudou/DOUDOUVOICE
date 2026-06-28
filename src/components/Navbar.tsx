import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { signInWithGoogle, logOut } from '../lib/firebase';
import { Mic, LogOut, User, Globe } from 'lucide-react';
import { motion } from 'motion/react';

export default function Navbar() {
  const { user } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();

  return (
    <nav className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0a0a0a] shrink-0" dir="ltr">
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <Mic size={20} className="text-black" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Doudou<span className="text-brand-500 underline decoration-2 underline-offset-4">Voice</span></span>
        </Link>
        
        <div className="hidden md:flex items-center gap-4 text-xs font-medium uppercase tracking-widest text-white/40">
          <Link to="/generator" className="hover:text-white transition-colors">{t('studio')}</Link>
          <Link to="/pricing" className="hover:text-white transition-colors">{t('pricing')}</Link>
          {user && <Link to="/history" className="hover:text-white transition-colors">{t('history')}</Link>}
          {user?.email === 'abdelwadoudamirouche7@gmail.com' && <Link to="/dashboard" className="hover:text-white transition-colors">{t('dashboard')}</Link>}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button 
          onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest"
        >
          <Globe size={16} />
          <span className="hidden sm:inline">{t('language')}</span>
        </button>

        {user ? (
          <div className="flex items-center gap-4">
            <Link to="/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-neutral-800 to-neutral-900 object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-xs font-bold text-white">
                  <User size={16} />
                </div>
              )}
            </Link>
            <button onClick={() => logOut()} className="text-white/40 hover:text-white transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <Link
            to="/auth"
            className="rounded bg-white/5 border border-white/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/10"
          >
            {t('signin')}
          </Link>
        )}
      </div>
    </nav>
  );
}
