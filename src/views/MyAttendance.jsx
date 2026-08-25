import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { motion } from 'framer-motion';
import { Calendar, Clock, Activity } from 'lucide-react';
import { EmptyState, SkeletonTable } from '../components/common/CommonUI.jsx';

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
      {/* Clean White Header Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">My attendance</h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">Your complete check-in and check-out logs.</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
          {[
            { label: 'Total days', value: totalDays },
            { label: 'On time', value: onTimeDays },
            { label: 'Late arrivals', value: lateDays },
            { label: 'Total hours', value: totalHours.toFixed(1) + 'h' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className="mt-1 text-base font-semibold text-slate-900 truncate">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Attendance Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Attendance history</h3>
              <p className="text-xs text-slate-500">Your personal check-in and check-out records</p>
            </div>
          </div>
          <span className="ui-badge badge-neutral">
            {history.length} records
          </span>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No attendance records yet"
            description="Your verified facial biometric scans will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-medium">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Check-in</th>
                  <th className="px-5 py-3">Check-out</th>
                  <th className="px-5 py-3">Working hours</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {history.map((rec) => (
                  <tr key={rec.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{rec.date}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatTimeStr(rec.check_in)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{formatTimeStr(rec.check_out)}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {(rec.working_hours !== null && rec.working_hours !== undefined) ? Number(rec.working_hours).toFixed(2) : '0.00'}h
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`ui-badge ${
                        rec.status === 'On Time' ? 'badge-success' :
                        rec.status === 'Late Arrival' ? 'badge-warning' :
                        rec.status === 'Early Exit' ? 'badge-error' :
                        'badge-neutral'
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
