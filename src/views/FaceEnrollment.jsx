import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { ShieldAlert, Lock, ArrowRight, Settings } from 'lucide-react';

export default function FaceEnrollment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-2xl py-12 px-4"
    >
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm flex flex-col items-center text-center space-y-6">
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Admin managed face registration
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
            Employee self-enrollment is restricted per corporate security policy. Biometric face descriptors can only be registered or updated by an administrator.
          </p>
        </div>

        <div className="w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2 text-left">
          <div className="flex items-center gap-1.5 text-amber-800 font-semibold">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            Security policy enforcement
          </div>
          <p>• Employees cannot register their own facial descriptors.</p>
          <p>• All biometric template registrations are restricted to the Admin Control Panel.</p>
          <p>• Employees can use the shared attendance terminal (<code className="text-indigo-600 font-medium">/attendance</code>) without login.</p>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {isAdmin ? (
            <button
              onClick={() => navigate('/admin')}
              className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center gap-2 transition-colors shadow-xs cursor-pointer min-h-[40px]"
            >
              <Settings className="w-4 h-4" />
              Open admin control panel
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => navigate('/employee-dashboard')}
              className="py-2.5 px-5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-xs flex items-center gap-2 transition-colors cursor-pointer min-h-[40px]"
            >
              Return to dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
