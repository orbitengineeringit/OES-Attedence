import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { motion } from 'framer-motion';
import { Activity, Calendar, Mail, Shield, Building2, MapPin, Clock } from 'lucide-react';

const formatTimeStr = (t) => {
  if (!t) return '---';
  if (typeof t === 'string' && t.includes(':') && !t.includes('T') && !t.includes('-')) return t;
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return t;
  }
};

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    const fetchProfileData = async () => {
      try {
        if (isMounted) setLoading(true);
        const profRes = await apiCall(`/employees/${user?.id}`, 'GET');
        if (profRes.success && isMounted) setProfile(profRes.employee);

        const histRes = await apiCall(`/attendance/history/${user?.id}`, 'GET');
        if (histRes.success && isMounted) setHistory(histRes.history);
      } catch (err) {
        console.error('[PROFILE ERROR]: Failed fetching user metadata:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchProfileData();
    return () => { isMounted = false; };
  }, [user]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="glass-panel-heavy rounded-xl p-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-2xl font-semibold text-indigo-700">
            {(user?.name || '').slice(0, 2).toUpperCase()}
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">{profile?.name || user?.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{profile?.id || user?.id}</p>
        </div>

        <div className="mt-6 space-y-3 border-t border-slate-200 pt-5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-500"><Mail className="h-4 w-4" />Email</span>
            <span className="truncate font-medium text-slate-900">{profile?.email}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-500"><Building2 className="h-4 w-4" />Department</span>
            <span className="font-medium text-slate-900">{profile?.department}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-500"><Shield className="h-4 w-4" />Role</span>
            <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{profile?.role || user?.role}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-500"><MapPin className="h-4 w-4" />Status</span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${profile?.status === 'Inside Office' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{profile?.status || 'Offline'}</span>
          </div>
        </div>
      </div>

      <div className="glass-panel-heavy rounded-xl lg:col-span-2">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-2 text-sky-700">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Attendance history</h3>
              <p className="text-xs text-slate-500">Personal check-in and check-out records</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">{history.length} records</span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Calendar className="mb-3 h-7 w-7 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">No attendance records</p>
            <p className="mt-1 text-sm text-slate-500">Your scanned attendance will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Check-in</th>
                  <th className="px-5 py-3">Check-out</th>
                  <th className="px-5 py-3">Hours</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.map((rec) => (
                  <tr key={rec.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4 font-medium text-slate-900">{rec.date}</td>
                    <td className="px-5 py-4 text-slate-600">{formatTimeStr(rec.check_in)}</td>
                    <td className="px-5 py-4 text-slate-600">{formatTimeStr(rec.check_out)}</td>
                    <td className="px-5 py-4 font-semibold text-slate-900"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-slate-400" />{(rec.working_hours !== null && rec.working_hours !== undefined) ? Number(rec.working_hours).toFixed(2) : '0.00'}h</span></td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        rec.status === 'On Time' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' :
                        rec.status === 'Late Arrival' ? 'border-amber-100 bg-amber-50 text-amber-700' :
                        rec.status === 'Early Exit' ? 'border-rose-100 bg-rose-50 text-rose-700' :
                        'border-slate-200 bg-slate-50 text-slate-600'
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
