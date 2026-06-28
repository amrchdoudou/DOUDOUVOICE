/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { LanguageProvider } from './lib/LanguageContext';
import { PayPalScriptProvider } from '@paypal/react-paypal-js';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import GeneratorPage from './pages/GeneratorPage';
import HistoryPage from './pages/HistoryPage';
import PricingPage from './pages/PricingPage';
import ProfilePage from './pages/ProfilePage';

import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';

const paypalOptions = {
  clientId: (import.meta as any).env.VITE_PAYPAL_CLIENT_ID && (import.meta as any).env.VITE_PAYPAL_CLIENT_ID !== "YOUR_PAYPAL_CLIENT_ID" 
    ? (import.meta as any).env.VITE_PAYPAL_CLIENT_ID 
    : "test",
  currency: "USD",
  intent: "capture",
  "disable-funding": "card,venmo,paylater",
};

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <PayPalScriptProvider options={paypalOptions}>
          <Router>
            <div className="flex h-full w-full flex-col bg-[#050505] text-[#e0e0e0]">
              <Navbar />
              <main className="flex-1 flex overflow-hidden">
                <div className="w-full h-full overflow-y-auto">
                  <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/generator" element={<GeneratorPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                </Routes>
                </div>
              </main>
            </div>
          </Router>
        </PayPalScriptProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}
