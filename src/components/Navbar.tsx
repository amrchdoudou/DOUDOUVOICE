import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { signInWithGoogle, logOut } from '../lib/firebase';
import { LogOut, User, Globe, Menu, X, Mic, CreditCard, History, LayoutDashboard, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Navbar() {
  const { user, userData } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleNavClick = (path: string) => {
    setIsMenuOpen(false);
    navigate(path);
  };

  const handleLogoutClick = async () => {
    setIsMenuOpen(false);
    await logOut();
    navigate('/');
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  const menuItems = [
    { label: t('studio'), path: '/generator', icon: Mic },
    { label: t('pricing'), path: '/pricing', icon: CreditCard },
    ...(user ? [{ label: t('history'), path: '/history', icon: History }] : []),
    ...(user?.email === 'abdelwadoudamirouche7@gmail.com' ? [{ label: t('dashboard'), path: '/dashboard', icon: LayoutDashboard }] : []),
  ];

  const limitCharacters = userData ? (userData.limitCharacters || (userData.plan?.toLowerCase() === 'pro' ? 50000 : userData.plan?.toLowerCase() === 'business' ? 200000 : 10000)) : 0;
  const usedCharacters = userData?.usedCharacters || 0;
  const remainingCharacters = Math.max(0, limitCharacters - usedCharacters);

  return (
    <nav className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0a0a0a] shrink-0 relative z-50" dir="ltr">
      {/* Brand Logo */}
      <div className="flex items-center gap-6">
        <Link to="/" onClick={() => setIsMenuOpen(false)} className="flex items-center transition-opacity hover:opacity-80">
          <img 
            src="/logo.png" 
            alt="DoudouVoice" 
            className="h-10 w-auto rounded object-contain" 
            referrerPolicy="no-referrer" 
          />
        </Link>
        
        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-4 text-xs font-medium uppercase tracking-widest text-white/40">
          <Link 
            to="/generator" 
            className={`transition-colors hover:text-white ${location.pathname === '/generator' ? 'text-white font-bold' : ''}`}
          >
            {t('studio')}
          </Link>
          <Link 
            to="/pricing" 
            className={`transition-colors hover:text-white ${location.pathname === '/pricing' ? 'text-white font-bold' : ''}`}
          >
            {t('pricing')}
          </Link>
          {user && (
            <Link 
              to="/history" 
              className={`transition-colors hover:text-white ${location.pathname === '/history' ? 'text-white font-bold' : ''}`}
            >
              {t('history')}
            </Link>
          )}
          {user?.email === 'abdelwadoudamirouche7@gmail.com' && (
            <Link 
              to="/dashboard" 
              className={`transition-colors hover:text-white ${location.pathname === '/dashboard' ? 'text-white font-bold' : ''}`}
            >
              {t('dashboard')}
            </Link>
          )}
        </div>
      </div>

      {/* Desktop Controls (hidden on mobile) */}
      <div className="hidden md:flex items-center gap-4">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors p-2 rounded-full hover:bg-white/5"
          title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        <button 
          onClick={toggleLanguage}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest"
        >
          <Globe size={16} />
          <span>{t('language')}</span>
        </button>

        {user ? (
          <div className="flex items-center gap-4">
            {userData && (
              <div className="hidden lg:flex flex-col items-end border-r border-white/10 pr-4 mr-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('characters') || 'Characters'}</span>
                <span className="text-xs font-mono text-white/80" title="Used / Remaining">
                  {usedCharacters.toLocaleString()} / <span className="text-brand-400">{remainingCharacters.toLocaleString()}</span>
                </span>
              </div>
            )}
            <Link to="/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {user.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName || 'User'} 
                  className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-neutral-800 to-neutral-900 object-cover" 
                />
              ) : (
                <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-xs font-bold text-white">
                  <User size={16} />
                </div>
              )}
            </Link>
            <button 
              onClick={() => logOut()} 
              className="text-white/40 hover:text-white transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-widest"
              title={t('sign_out')}
            >
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

      {/* Mobile Controls & Trigger */}
      <div className="flex items-center gap-3 md:hidden">
        {user && userData && (
          <div className="flex flex-col items-end mr-1">
             <span className="text-[9px] font-mono text-white/70" title="Used / Remaining">
                {usedCharacters.toLocaleString()} / <span className="text-brand-400">{remainingCharacters.toLocaleString()}</span>
             </span>
          </div>
        )}
        {/* Short Profile preview / auth link directly on Navbar for quick access */}
        {user ? (
          <Link to="/profile" onClick={() => setIsMenuOpen(false)} className="flex items-center hover:opacity-80 transition-opacity">
            {user.photoURL ? (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-8 h-8 rounded-full border border-white/20 object-cover" 
              />
            ) : (
              <div className="w-8 h-8 rounded-full border border-white/20 bg-neutral-900 flex items-center justify-center text-xs font-bold text-white">
                <User size={14} />
              </div>
            )}
          </Link>
        ) : (
          <Link
            to="/auth"
            className="rounded bg-white/5 border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white/10"
          >
            {t('signin')}
          </Link>
        )}

        {/* Hamburger Menu Trigger */}
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 text-white/80 hover:text-white focus:outline-none transition-colors border border-white/10 rounded bg-white/5"
          aria-label="Toggle navigation menu"
        >
          {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Menu Panel */}
      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute top-16 left-0 w-full bg-[#0a0a0a]/95 backdrop-blur-md border-b border-white/10 shadow-2xl flex flex-col p-5 gap-4 md:hidden z-40"
          >
            {/* Nav Menu Links */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1 block">
                Navigation
              </span>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavClick(item.path)}
                    className={`w-full flex items-center gap-3.5 px-4 py-3 rounded text-sm transition-all ${
                      isActive 
                        ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20 font-semibold' 
                        : 'text-white/70 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-brand-400' : 'text-white/40'} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="h-px bg-white/10 my-1" />

            {/* Quick Actions */}
            <div className="flex flex-col gap-2">
              {/* Theme Switcher */}
              <button
                onClick={toggleTheme}
                className="w-full flex items-center justify-between px-4 py-3 rounded text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  {theme === 'light' ? <Moon size={18} className="text-white/40" /> : <Sun size={18} className="text-white/40" />}
                  <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                </div>
                <span className="text-xs bg-white/10 px-2.5 py-1 rounded text-white font-mono uppercase font-bold tracking-widest">
                  {theme === 'light' ? 'DARK' : 'LIGHT'}
                </span>
              </button>

              {/* Language Switcher */}
              <button
                onClick={toggleLanguage}
                className="w-full flex items-center justify-between px-4 py-3 rounded text-sm text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <Globe size={18} className="text-white/40" />
                  <span>{t('language')}</span>
                </div>
                <span className="text-xs bg-white/10 px-2.5 py-1 rounded text-white font-mono uppercase font-bold tracking-widest">
                  {language === 'en' ? 'AR' : 'EN'}
                </span>
              </button>

              {/* Log Out button (if user is logged in) */}
              {user && (
                <button
                  onClick={handleLogoutClick}
                  className="w-full flex items-center gap-3.5 px-4 py-3 rounded text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={18} className="text-red-400/70" />
                  <span>{t('sign_out')}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
