import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ADMIN_EMAIL = 'abdelwadoudamirouche7@gmail.com';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // PayPal Test State
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalSecret, setPaypalSecret] = useState('');
  const [paypalMode, setPaypalMode] = useState('sandbox');
  const [testResult, setTestResult] = useState<{success?: boolean, message?: string} | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveOnly = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!paypalClientId || !paypalSecret) return;
    setIsSaving(true);
    setTestResult(null);
    try {
      const idToken = await user?.getIdToken();
      const response = await fetch('/api/paypal/save', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ clientId: paypalClientId, clientSecret: paypalSecret, mode: paypalMode })
      });
      const data = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: 'Credentials saved successfully!' });
        setPaypalSecret('••••••••••••••••••••••••••••••••••••••••');
      } else {
        setTestResult({ success: false, message: `Failed to save on server: ${data.error || 'Error occurred.'}` });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: `Failed to save: ${error.message || 'Error occurred.'}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPaypal = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTesting(true);
    setTestResult(null);
    try {
      const idToken = await user?.getIdToken();
      const response = await fetch('/api/paypal/test', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ clientId: paypalClientId, clientSecret: paypalSecret, mode: paypalMode })
      });
      const data = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: 'Credentials saved & connection tested successfully!' });
        setPaypalSecret('••••••••••••••••••••••••••••••••••••••••');
      } else {
        setTestResult({ success: false, message: `Connection failed: ${data.error || 'Authentication failed.'}` });
      }
    } catch (error: any) {
      setTestResult({ success: false, message: `Connection test errored: ${error.message || 'An error occurred.'}` });
    } finally {
      setIsTesting(false);
    }
  };

  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL) {
      navigate('/');
      return;
    }

    const fetchPayPalSettings = async () => {
      try {
        const response = await fetch('/api/paypal/config');
        if (response.ok) {
          const data = await response.json();
          if (data.clientId) setPaypalClientId(data.clientId);
          if (data.hasSecret) setPaypalSecret('••••••••••••••••••••••••••••••••••••••••');
          if (data.mode) setPaypalMode(data.mode);
        }
      } catch (error) {
        console.error("Error loading PayPal settings:", error);
      }
    };

    const fetchUsers = async () => {
      try {
        const idToken = await user?.getIdToken();
        const response = await fetch('/api/admin/users', {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setAllUsers(data);
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchPayPalSettings();
    fetchUsers();
  }, [user, navigate]);

  if (!user || user.email !== ADMIN_EMAIL) return null;

  return (
    <div className="flex-1 w-full flex flex-col items-center bg-[#050505] overflow-y-auto pt-16 px-6">
      <div className="w-full max-w-6xl flex flex-col gap-12 pb-24">
        
        {/* Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-white">Admin Dashboard</h1>
          <p className="text-white/40 text-lg">Overview of users, billing, and platform activity.</p>
        </div>

        <div className="flex flex-col gap-4 mt-4">
          
          {/* PayPal Integration Test */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-8">
            <h2 className="text-xl font-medium text-white tracking-wide mb-4">Configure PayPal Credentials</h2>
            <p className="text-white/60 mb-6 text-sm">Enter your PayPal API credentials to configure payments. Testing a successful connection will securely save these credentials to your database for all real and sandbox checkouts.</p>
            
            <form onSubmit={handleTestPaypal} className="flex flex-col gap-4 max-w-2xl">
              <div className="flex gap-4">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-xs uppercase tracking-widest text-white/50 font-bold">Client ID</label>
                  <input
                    type="text"
                    value={paypalClientId}
                    onChange={(e) => setPaypalClientId(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-brand-500"
                    placeholder="Enter Client ID"
                    required
                  />
                </div>
                <div className="w-48 flex flex-col gap-1.5">
                  <label className="text-xs uppercase tracking-widest text-white/50 font-bold">Mode</label>
                  <select
                    value={paypalMode}
                    onChange={(e) => setPaypalMode(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-brand-500 appearance-none"
                  >
                    <option value="sandbox">Sandbox (Testing)</option>
                    <option value="live">Live (Production)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-widest text-white/50 font-bold">Secret Key</label>
                <input
                  type="password"
                  value={paypalSecret}
                  onChange={(e) => setPaypalSecret(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-brand-500"
                  placeholder="Enter Secret Key"
                  required
                />
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-2">
                <button
                  type="button"
                  onClick={handleSaveOnly}
                  disabled={isSaving || isTesting || !paypalClientId || !paypalSecret}
                  className="bg-white/10 text-white border border-white/20 px-6 py-2 rounded font-bold uppercase tracking-widest text-xs hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save Credentials'}
                </button>

                <button
                  type="submit"
                  disabled={isSaving || isTesting || !paypalClientId || !paypalSecret}
                  className="bg-brand-500 text-black px-6 py-2 rounded font-bold uppercase tracking-widest text-xs hover:bg-brand-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isTesting ? 'Saving & Testing...' : 'Save & Test Connection'}
                </button>
                
                {testResult && (
                  <div className={`text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'} flex-1 min-w-[200px]`}>
                    {testResult.success ? '✓ ' : '✗ '}
                    {testResult.message}
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* All Users Table */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-medium text-white tracking-wide">All Users & Usage</h2>
          </div>
          
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-white/50">User</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-white/50">Plan</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-white/50">Usage (Chars)</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-white/50">Remaining</th>
                    <th className="p-4 text-xs font-bold uppercase tracking-widest text-white/50 text-right">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-white/40 text-sm">Loading users...</td>
                    </tr>
                  ) : allUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-white/40 text-sm">No users found.</td>
                    </tr>
                  ) : (
                    allUsers.map((u) => (
                      <tr key={u.id} className="border-b border-white/10 last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden">
                              {u.photoURL ? <img src={u.photoURL} alt="avatar" className="w-full h-full object-cover" /> : <UserPlaceholder />}
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm text-white font-medium">{u.displayName || 'Unknown User'}</span>
                              <span className="text-xs text-white/40">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                            u.plan === 'Pro' ? 'bg-purple-500/10 text-purple-400' :
                            u.plan === 'Business' ? 'bg-blue-500/10 text-blue-400' :
                            'bg-green-500/10 text-green-400'
                          }`}>
                            {u.plan}
                          </span>
                        </td>
                        <td className="p-4 text-sm">
                          <div className="flex flex-col gap-1 w-32">
                            <span className="text-white">{u.usedCharacters} / {u.limitCharacters}</span>
                            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-brand-500" 
                                style={{ width: `${Math.min(100, (u.usedCharacters / u.limitCharacters) * 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-white/60">
                          {Math.max(0, u.limitCharacters - u.usedCharacters)} chars
                        </td>
                        <td className="p-4 text-right text-sm text-white/40">
                          {u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

function UserPlaceholder() {
  return <Users size={14} className="text-white/40" />;
}
