import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ScanFace, Clock, Activity, Calendar, TrendingUp, Fingerprint, ArrowRight } from 'lucide-react';

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [todayRecord, setTodayRecord] = useState(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [lastEvent, setLastEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!user) { setLoading(false); return; }

    const fetchData = async () => {
      try {
        if (mountedRef.current) setLoading(true);

        // Fetch personal attendance history
        const histRes = await apiCall(`/attendance/history/${user.id}`, 'GET');
        if (!mountedRef.current) return;

        if (histRes.success) {
          const history = histRes.history || [];
          setTotalRecords(history.length);

          // Find today's record
          const today = new Date().toISOString().split('T')[0];
          const todayRec = history.find(r => r.date === today);
          setTodayRecord(todayRec || null);
        }

        // Fetch personal logs for last event
        const logsRes = await apiCall('/logs/my-logs', 'GET');
        if (!mountedRef.current) return;

        if (logsRes.success) {
          const logs = logsRes.logs || [];
          setLastEvent(logs.length > 0 ? logs[0] : null);
        }
      } catch (err) {
        console.error('[EMPLOYEE DASHBOARD ERROR]:', err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchData();
    return () => { mountedRef.current = false; };
  }, [user]);

  const getStatusText = () => {
    if (!todayRecord) return 'Not checked in';
    if (todayRecord.check_out) return 'Shift complete';
    return 'Checked in';
  };

  const getStatusTone = () => {
    if (!todayRecord) return 'slate';
    if (todayRecord.check_out) return 'blue';
    return 'emerald';
  };

  const statusTone = getStatusTone();
  const toneMap = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  const metricCards = [
    {
      label: 'Today\'s status',
      value: getStatusText(),
      helper: todayRecord?.status || 'No attendance record for today',
      icon: Clock,
      tone: statusTone,
      bars: [18, 24, 15, 28, 21, 32, 20, 26, 34, 25, 30, 22],
      barA: statusTone === 'emerald' ? '#10B981' : statusTone === 'blue' ? '#3B82F6' : '#94A3B8',
      barB: statusTone === 'emerald' ? '#14B8A6' : statusTone === 'blue' ? '#06B6D4' : '#CBD5E1',
    },
    {
      label: 'Total records',
      value: totalRecords,
      helper: 'Attendance entries in history',
      icon: Calendar,
      tone: 'violet',
      bars: [22, 16, 30, 25, 34, 20, 28, 18, 31, 24, 29, 21],
      barA: '#8B5CF6',
      barB: '#4F46E5',
    },
    {
      label: 'Last event',
      value: lastEvent ? lastEvent.event_type : 'None',
      helper: lastEvent
        ? new Date(lastEvent.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'No activity recorded',
      icon: Activity,
      tone: 'amber',
      bars: [15, 19, 27, 22, 33, 25, 18, 30, 24, 36, 28, 21],
      barA: '#F59E0B',
      barB: '#F97316',
    },
  ];

  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  };

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="hero-band relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-80">My workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Welcome back, {user?.name?.split(' ')[0] || 'Employee'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 opacity-85">
              {user?.department || 'Your department'} · {user?.role || 'employee'}
            </p>
          </div>
          <button
            onClick={() => navigate('/scanner')}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/16 px-4 py-2 text-sm font-semibold backdrop-blur-md hover:bg-white/25 transition-all cursor-pointer"
          >
            <ScanFace className="h-4 w-4" />
            Open scanner
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Status', value: getStatusText() },
            { label: 'Role', value: user?.role || 'employee' },
            { label: 'Records', value: totalRecords },
            { label: 'Department', value: user?.department || 'N/A' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/20 bg-white/14 p-3 backdrop-blur-md">
              <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{item.label}</p>
              <p className="mt-1 truncate text-lg font-semibold capitalize">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
          <p className="mt-4 text-sm text-slate-500">Loading your attendance data...</p>
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }}
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          {metricCards.map((card) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.label}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                className={`glass-card metric-card ${card.tone} p-5`}
              >
                <div className="relative z-10 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{card.label}</p>
                    <h2 className="mt-2 truncate text-3xl font-semibold text-slate-900">{card.value}</h2>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${toneClasses[card.tone]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div
                  className="mini-bars relative z-10 mt-5"
                  style={{ '--bar-a': card.barA, '--bar-b': card.barB }}
                  aria-hidden="true"
                >
                  {card.bars.map((height, index) => (
                    <span key={`${card.label}-bar-${index}`} style={{ '--h': `${height}px`, animationDelay: `${index * 55}ms` }} />
                  ))}
                </div>
                <div className="relative z-10 mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5 text-indigo-500" />
                  {card.helper}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={() => navigate('/scanner')}
          className="glass-panel-heavy rounded-xl p-5 text-left transition-all hover:shadow-md group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-2.5 text-cyan-700">
              <ScanFace className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Biometric Scanner</h3>
              <p className="text-xs text-slate-500">Check in or check out with face scan</p>
            </div>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
          </div>
        </button>
        <button
          onClick={() => navigate('/my-attendance')}
          className="glass-panel-heavy rounded-xl p-5 text-left transition-all hover:shadow-md group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-violet-100 bg-violet-50 p-2.5 text-violet-700">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">My Attendance</h3>
              <p className="text-xs text-slate-500">View your attendance history</p>
            </div>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-400 group-hover:text-slate-900 transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
}
