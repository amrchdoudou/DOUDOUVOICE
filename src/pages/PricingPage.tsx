import { useState, useEffect } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../lib/LanguageContext';
import { useAuth } from '../lib/AuthContext';
import { PayPalButtons, usePayPalScriptReducer } from '@paypal/react-paypal-js';

const TIERS = [
  {
    name: 'starter',
    price: '$7',
    description: 'starter_desc',
    features: [
      'char_10k',
      'std_voices',
      'wav_dl',
      'personal_lic'
    ],
    buttonText: 'get_started',
    popular: false
  },
  {
    name: 'pro',
    price: '$19',
    description: 'pro_desc',
    features: [
      'char_50k',
      'all_premium',
      'wav_dl',
      'commercial_lic',
      'priority_gen'
    ],
    buttonText: 'upgrade_pro',
    popular: true
  },
  {
    name: 'business',
    price: '$49',
    description: 'biz_desc',
    features: [
      'char_200k',
      'custom_clone',
      'api_access',
      'enterprise_sla',
      'dedicated_support'
    ],
    buttonText: 'contact_sales',
    popular: false
  }
];

export default function PricingPage() {
  const { t } = useLanguage();
  const { user, userData } = useAuth();
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [{ isPending, options }, dispatch] = usePayPalScriptReducer();

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/paypal/config");
        if (response.ok) {
          const data = await response.json();
          if (data.clientId) {
            dispatch({
              type: "resetOptions",
              value: {
                ...options,
                clientId: data.clientId,
                "client-id": data.clientId,
              }
            });
          }
        }
      } catch (error) {
        console.error("Error fetching dynamic PayPal configuration:", error);
      }
    };
    fetchConfig();
  }, [dispatch]);

  const handleSelectPlan = (plan: string) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setPaymentError(null);
    setSelectedPlan(plan);
  };

  const createOrder = async (data: any, actions: any) => {
    try {
      setPaymentError(null);
      const token = user ? await user.getIdToken() : "";
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const orderData = await response.json();
      if (orderData.id) {
        return orderData.id;
      } else {
        const errorDetail = orderData?.details?.[0];
        const errorMessage = errorDetail ? `${errorDetail.issue}: ${errorDetail.description} (${orderData.debug_id})` : orderData.error || JSON.stringify(orderData);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error("Create Order Error:", error);
      setPaymentError(error.message || String(error));
      throw error;
    }
  };

  const onApprove = async (data: any, actions: any) => {
    try {
      setPaymentError(null);
      const token = user ? await user.getIdToken() : "";
      const response = await fetch(`/api/orders/${data.orderID}/capture`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({})
      });
      const orderData = await response.json();
      const errorDetail = orderData?.details?.[0];

      if (errorDetail?.issue === "INSTRUMENT_DECLINED") {
        return actions.restart();
      } else if (errorDetail) {
        throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
      } else if (orderData.error) {
        throw new Error(orderData.error);
      } else {
        // Capture successful
        alert(t('payment_success'));
        setSelectedPlan(null);
        setPaymentError(null);
      }
    } catch (error: any) {
      console.error("Capture Order Error:", error);
      setPaymentError(error.message || String(error));
      throw error;
    }
  };

  const onError = (err: any) => {
    console.error("PayPal Button Error:", err);
    setPaymentError(err.message || String(err));
  };

  return (
    <div className="container mx-auto px-4 py-24 relative">
      <div className="text-center mb-16">
        <h1 className="font-heading text-4xl font-bold text-white mb-4 tracking-tight">{t('simple_pricing')}</h1>
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{t('choose_plan')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {TIERS.map((tier) => (
          <div 
            key={tier.name}
            className={`relative rounded border p-8 flex flex-col ${
              tier.popular 
                ? 'border-brand-500/50 bg-[#080808] shadow-[0_0_30px_-10px_rgba(245,158,11,0.2)]' 
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded border border-brand-500/50 bg-brand-500/10 px-3 py-1 text-[9px] uppercase tracking-widest font-bold text-brand-500">
                {t('most_popular')}
              </div>
            )}
            
            <div className="mb-6">
              <h3 className="text-xl font-medium text-white mb-2">{t(tier.name)}</h3>
              <p className="text-[10px] text-white/40 uppercase tracking-widest">{t(tier.description)}</p>
            </div>
            
            <div className="mb-8">
              <span className="text-4xl font-bold text-white">{tier.price}</span>
              <span className="text-white/40 text-sm">{t('per_month')}</span>
            </div>
            
            <ul className="mb-8 flex-1 space-y-4">
              {tier.features.map(feature => (
                <li key={feature} className="flex items-start gap-3 text-sm text-white/60">
                  <Check size={18} className="text-brand-500 shrink-0" />
                  <span>{t(feature)}</span>
                </li>
              ))}
            </ul>
            
            <button 
              onClick={() => handleSelectPlan(tier.name)}
              disabled={userData?.plan?.toLowerCase() === tier.name.toLowerCase()}
              className={`flex w-full justify-center rounded py-3 text-[10px] uppercase tracking-widest font-bold transition-colors ${
                userData?.plan?.toLowerCase() === tier.name.toLowerCase()
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : tier.popular
                    ? 'bg-brand-500 text-black hover:bg-brand-400'
                    : 'bg-white/5 border border-white/10 text-white hover:bg-white/10'
              }`}
            >
              {userData?.plan?.toLowerCase() === tier.name.toLowerCase() ? t('current_plan') : t(tier.buttonText)}
            </button>
          </div>
        ))}
      </div>

      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl" dir={document.documentElement.dir}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">{t('complete_purchase')}</h3>
              <button onClick={() => setSelectedPlan(null)} className="text-white/40 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="mb-6">
              <p className="text-white/60 mb-2">{t('upgrade_to')} <strong className="text-white uppercase">{t(selectedPlan)}</strong> {t('plan_word')}</p>
              <p className="text-2xl font-bold text-brand-500 mb-6">{TIERS.find(t => t.name === selectedPlan)?.price} <span className="text-sm font-normal text-white/40">{t('per_month')}</span></p>
            </div>

            {paymentError && (
              <div className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-300">
                <p className="font-bold mb-1 text-red-400">⚠️ {t('payment_failed')}</p>
                <p className="opacity-90 leading-relaxed">{paymentError}</p>
              </div>
            )}

            <div className="bg-white p-4 rounded-xl min-h-[150px] relative flex justify-center items-center" dir="ltr">
              {isPending && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-xl z-10">
                  <Loader2 className="w-8 h-8 text-brand-500 animate-spin mb-2" />
                  <p className="text-gray-500 text-sm">Loading secure checkout...</p>
                </div>
              )}
              <div className="w-full">
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", color: "gold" }}
                  createOrder={createOrder}
                  onApprove={onApprove}
                  onError={onError}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
