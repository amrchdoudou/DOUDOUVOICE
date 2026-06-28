import { useLanguage } from '../lib/LanguageContext';
import { motion } from 'motion/react';
import { ArrowRight, AudioWaveform, Globe2, Sparkles, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-[#050505] overflow-y-auto w-full">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-24 pb-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand-900/20 via-[#050505] to-[#050505]"></div>
        <div className="container relative mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-widest text-brand-500 font-bold mb-8"
          >
            <Sparkles size={14} className="text-brand-500" />
            <span>{t('next_gen_ai')}</span>
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="font-heading text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white mb-6 max-w-4xl"
          >
            {t('convert_text_premium')} <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-brand-600">{t('arabic_speech')}</span>
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg md:text-xl text-white/40 max-w-2xl mb-10 font-light"
          >
            {t('hero_desc')}
          </motion.p>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 w-full justify-center"
          >
            <Link
              to="/generator"
              className="inline-flex h-12 items-center justify-center gap-2 rounded bg-brand-500 px-8 text-sm font-bold uppercase tracking-widest text-black transition-transform hover:bg-brand-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]"
            >
              {t('start_generating')} <ArrowRight size={16} />
            </Link>
            <Link
              to="/pricing"
              className="inline-flex h-12 items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-8 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/10"
            >
              {t('view_pricing')}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-[#080808] border-t border-white/5">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="font-heading text-3xl font-bold text-white mb-4 tracking-tight">{t('why_doudou')}</h2>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('pro_voice_gen')}</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Globe2, titleKey: 'dialects_title', descKey: 'dialects_desc' },
              { icon: AudioWaveform, titleKey: 'studio_quality_title', descKey: 'studio_quality_desc' },
              { icon: Zap, titleKey: 'instant_gen_title', descKey: 'instant_gen_desc' },
            ].map((feat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded border border-white/5 bg-white/[0.02] p-8 hover:bg-white/[0.04] transition-colors"
              >
                <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded bg-brand-500/10 text-brand-500 border border-brand-500/20">
                  <feat.icon size={24} />
                </div>
                <h3 className="font-heading text-xl font-bold text-white mb-3 tracking-tight">{t(feat.titleKey)}</h3>
                <p className="text-white/40 leading-relaxed text-sm">{t(feat.descKey)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
