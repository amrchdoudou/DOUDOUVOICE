import React from 'react';
import Footer from '../components/Footer';

export default function RefundPage() {
  return (
    <div className="w-full min-h-screen flex flex-col bg-black text-gray-300">
      <div className="max-w-3xl mx-auto px-6 py-20 w-full flex-1">
        <h1 className="text-4xl font-bold text-white mb-2">Refund Policy</h1>
        <p className="text-gray-500 mb-12">Last Updated: {new Date().toLocaleDateString()}</p>
        
        <div className="space-y-10 leading-relaxed">
          <section>
            <p>
              Thank you for choosing DoudouVoice. We strive to provide the highest quality AI text-to-speech services. Please read this policy carefully to understand your rights regarding refunds for subscriptions and purchases made on our platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Subscription Payments</h2>
            <p>
              DoudouVoice operates on a subscription model processed through Paddle or PayPal. You will be billed in advance on a recurring, periodic basis (monthly or annually). By upgrading your account, you agree to these recurring charges.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. Refund Eligibility</h2>
            <p className="mb-4">We offer refunds under the following specific circumstances:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-400">
              <li><strong>Accidental Renewal:</strong> If you forgot to cancel your subscription and request a refund within 48 hours of the renewal charge, provided you have not utilized any generated characters in the new billing cycle.</li>
              <li><strong>Technical Failures:</strong> If you experience persistent technical issues preventing you from generating audio, and our support team is unable to resolve the issue within a reasonable timeframe.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. Non-Refundable Cases</h2>
            <p className="mb-4">Refunds will <strong>not</strong> be granted in the following scenarios:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-400">
              <li>You have consumed a significant portion of your character limit for the current billing cycle.</li>
              <li>You request a refund for a prior billing cycle.</li>
              <li>You violate our Acceptable Use policy or Terms of Service, leading to account suspension or termination.</li>
              <li>You changed your mind after utilizing the premium service. We provide 5 free trial generations so you can evaluate the voice quality before purchasing a subscription.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. Billing Disputes</h2>
            <p>
              If you believe you have been incorrectly charged, please contact us immediately before filing a dispute with your bank, Paddle, or PayPal. We are committed to resolving billing errors swiftly and fairly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. How to Request a Refund</h2>
            <p>
              To request a refund, please contact our support team with your account email address, the transaction ID, and the reason for the request. We aim to review and respond to all refund requests within 3-5 business days.
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
