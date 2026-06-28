import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { logOut } from '../lib/firebase';
import { User as UserIcon, LogOut, Mail, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ProfilePage() {
  const { user, userData } = useAuth();
  const { t } = useLanguage();

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">{t('signin_required')}</h2>
        <p className="text-gray-400 mb-8">{t('signin_view_profile')}</p>
        <Link to="/" className="text-brand-500 hover:underline">{t('return_home')}</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <h1 className="font-heading text-3xl font-bold text-white mb-8">{t('profile_settings')}</h1>
      
      <div className="rounded-2xl border border-gray-800 bg-gray-900/50 overflow-hidden">
        <div className="p-8 sm:flex sm:items-center sm:justify-between border-b border-gray-800">
          <div className="flex items-center gap-6">
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'User'} className="h-20 w-20 rounded-full border-4 border-gray-800" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-gray-800 bg-gray-800 text-gray-400">
                <UserIcon size={32} />
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-white">{user.displayName || t('doudouvoice_user')}</h2>
              <p className="text-sm text-brand-500 font-medium">{t(userData?.plan || 'Free')} {t('plan')}</p>
              {userData?.plan === 'Free' && (
                <p className="text-[10px] text-white/40 mt-1">{userData?.generationCount || 0}/5 {t('free_voices_used')}</p>
              )}
            </div>
          </div>
          <div className="mt-6 sm:mt-0">
            <Link to="/pricing" className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700">
              {t('upgrade_plan')}
            </Link>
          </div>
        </div>
        
        <div className="p-8 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
              <Mail size={16} /> {t('email_address')}
            </h3>
            <p className="text-white">{user.email}</p>
          </div>
          
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
              <Calendar size={16} /> {t('account_created')}
            </h3>
            <p className="text-white">{user.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : t('unknown')}</p>
          </div>
        </div>
        
        <div className="p-8 border-t border-gray-800 bg-black/50">
          <button
            onClick={() => logOut()}
            className="flex items-center gap-2 text-red-500 hover:text-red-400 font-medium transition-colors"
          >
            <LogOut size={18} /> {t('sign_out')}
          </button>
        </div>
      </div>
    </div>
  );
}
