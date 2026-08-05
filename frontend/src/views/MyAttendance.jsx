import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { motion } from 'framer-motion';
import { Calendar, Clock, Activity } from 'lucide-react';

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

export default function MyAttendance() {
  const { user } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!user) { setLoading(false); return; }

    const fetchHistory = async () => {
      try {
        if (mountedRef.current) setLoading(true);
        const res = await apiCall(`/attendance/history/${user.id}`, 'GET');
        if (!mountedRef.current) return;
        if (res.success) {
          setHistory(res.history || []);
        }
      } catch (err) {
        console.error('[MY ATTENDANCE ERROR]:', err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchHistory();
    return () => { mountedRef.current = false; };
  }, [user]);

  // Summary stats
  const totalDays = history.length;
  const onTimeDays = history.filter(r => r.status === 'On Time').length;
  const lateDays = history.filter(r => r.status === 'Late Arrival').length;
  const totalHours = history.reduce((sum, r) => sum + (parseFloat(r.working_hours) || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="hero-band relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-80">Personal records</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">My Attendance</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 opacity-85">Your complete check-in and check-out history.</p>
        </div>
        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total days', value: totalDays },
            { label: 'On time', value: onTimeDays },
            { label: 'Late', value: lateDays },
            { label: 'Total hours', value: totalHours.toFixed(1) + 'h' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/20 bg-white/14 p-3 backdrop-blur-md">
              <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{item.label}</p>
              <p className="mt-1 truncate text-lg font-semibold">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Attendance Table */}
      <div className="glass-panel-heavy relative overflow-hidden rounded-xl">
        <div className="spectrum-bar absolute left-0 right-0 top-0 h-1" />
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-violet-100 bg-violet-50 p-2 text-violet-700">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Attendance history</h3>
              <p className="text-xs text-slate-500">Your personal check-in and check-out records</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            {history.length} records
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            <p className="mt-4 text-sm text-slate-500">Loading attendance records...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Activity className="mb-3 h-7 w-7 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">No attendance records yet</p>
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
                    <td className="px-5 py-4 font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {(rec.working_hours !== null && rec.working_hours !== undefined) ? Number(rec.working_hours).toFixed(2) : '0.00'}h
                      </span>
                    </td>
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
