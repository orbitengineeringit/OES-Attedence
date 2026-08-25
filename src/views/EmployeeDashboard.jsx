import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ScanFace, Clock, Activity, Calendar, ArrowRight } from 'lucide-react';
import { LiveIndicator, SkeletonCard } from '../components/common/CommonUI.jsx';

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

  const metricCards = [
    {
      label: 'Today\'s status',
      value: getStatusText(),
      helper: todayRecord?.status || 'No attendance record for today',
      icon: Clock,
    },
    {
      label: 'Total attendance records',
      value: totalRecords,
      helper: 'Recorded scan sessions',
      icon: Calendar,
    },
    {
      label: 'Last biometric event',
      value: lastEvent ? lastEvent.event_type : 'None',
      helper: lastEvent
        ? new Date(lastEvent.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'No activity recorded',
      icon: Activity,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-slate-500">Employee portal</span>
              <LiveIndicator label="System online" />
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">
              Welcome back, {user?.name?.split(' ')[0] || 'Employee'}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">
              {user?.department || 'Department'} · <span className="capitalize">{user?.role || 'Employee'}</span>
            </p>
          </div>
          <button
            onClick={() => navigate('/scanner')}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-medium text-white shadow-xs hover:bg-indigo-700 transition-colors cursor-pointer min-h-[40px]"
          >
            <ScanFace className="h-4 w-4" />
            Open biometric scanner
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
          {[
            { label: 'Status', value: getStatusText() },
            { label: 'Role', value: user?.role || 'employee' },
            { label: 'Total records', value: totalRecords },
            { label: 'Department', value: user?.department || 'N/A' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className="mt-1 text-base font-semibold text-slate-900 truncate capitalize">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Metric Cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {metricCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{card.label}</p>
                    <h2 className="mt-2 truncate text-2xl font-semibold text-slate-900">{card.value}</h2>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-indigo-600">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  {card.helper}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={() => navigate('/scanner')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left transition-colors hover:bg-slate-50 shadow-sm group cursor-pointer"
        >
          <div className="flex items-center gap-3.5">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2.5 text-indigo-600">
              <ScanFace className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Biometric scanner</h3>
              <p className="text-xs text-slate-500">Scan face to verify attendance punch</p>
            </div>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
          </div>
        </button>
        <button
          onClick={() => navigate('/my-attendance')}
          className="rounded-xl border border-slate-200 bg-white p-5 text-left transition-colors hover:bg-slate-50 shadow-sm group cursor-pointer"
        >
          <div className="flex items-center gap-3.5">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2.5 text-indigo-600">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">My attendance records</h3>
              <p className="text-xs text-slate-500">View punch history and working hours</p>
            </div>
            <ArrowRight className="ml-auto h-4 w-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
}
