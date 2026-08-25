import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { Shield, Mail, AlertTriangle, Eye, EyeOff, ArrowRight, Building2 } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setError('');
    setSubmitting(true);

    const result = await login(email, password);

    if (result.success) {
      const cachedUser = JSON.parse(localStorage.getItem('quantum_user') || '{}');
      if (cachedUser.role === 'admin') {
        navigate('/dashboard');
      } else if (cachedUser.is_face_registered === false) {
        navigate('/enroll-face');
      } else {
        navigate('/employee-dashboard');
      }
      return;
    }

    setError(result.message || 'Invalid email or password. Please try again.');
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8 bg-slate-50 text-slate-900 relative select-none">
      {/* Main Split Card Container */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 border border-slate-200"
      >
        {/* Left Column: Brand & Security Overview */}
        <div className="lg:col-span-5 relative flex flex-col justify-between p-8 bg-slate-900 text-white overflow-hidden">
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-20"
            style={{ 
              backgroundImage: `url('/office_bg.jpg'), url('https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80')` 
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/90 to-slate-900/80" />

          {/* Top Brand Block */}
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md flex items-center justify-center shrink-0 overflow-hidden">
                <img 
                  src="/orbit_logo.png" 
                  alt="Orbit Logo" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                  }}
                />
                <Building2 className="w-5 h-5 text-indigo-400 hidden" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-white tracking-tight">Orbit Engineering Solutions</h1>
                <p className="text-[11px] text-slate-400">Attendance & workforce management</p>
              </div>
            </div>
          </div>

          {/* Center Info Block */}
          <div className="relative z-10 my-8 space-y-3">
            <h2 className="text-xl font-semibold text-white tracking-tight leading-snug">
              Secure biometric verification and attendance telemetry
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Facial recognition, anti-spoof liveness detection, and geofence validation for enterprise teams.
            </p>
          </div>

          {/* Bottom Badges */}
          <div className="relative z-10 pt-4 border-t border-white/10 flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-indigo-400" /> AES-256 encrypted</span>
            <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-slate-400" /> Official portal</span>
          </div>
        </div>

        {/* Right Column: Clean Form Container */}
        <div className="lg:col-span-7 p-8 md:p-10 flex flex-col justify-between bg-white">
          <div>
            {/* Quick Public Scanner Link */}
            <button
              type="button"
              onClick={() => navigate('/attendance')}
              className="w-full mb-6 p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Employee attendance terminal (/attendance)
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <div className="space-y-1 text-left">
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
                Sign in to your account
              </h2>
              <p className="text-xs text-slate-500">
                Enter your credentials below to access your dashboard.
              </p>
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5 text-left">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Corporate email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pr-10 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50 mt-2 min-h-[44px] flex items-center justify-center gap-2"
              >
                {submitting ? 'Authenticating...' : 'Sign in'}
              </button>
            </form>
          </div>

          {/* Footer Note */}
          <div className="mt-8 pt-4 border-t border-slate-100 text-center text-xs text-slate-400">
            Orbit Engineering Solutions &bull; Authorized personnel only
          </div>
        </div>
      </motion.div>
    </div>
  );
}
