import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiCall } from '../services/api.js';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, AlertOctagon, Clock, Activity, Database, Fingerprint, ShieldCheck, TrendingUp, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';

const parseDetails = (details) => {
  if (!details) return null;
  if (typeof details === 'object') return details;
  try {
    return JSON.parse(details);
  } catch {
    return { status_text: details };
  }
};

const renderTelemetryDetails = (details) => {
  const parsed = parseDetails(details);
  if (!parsed) return <span className="text-xs text-slate-500">No telemetry</span>;

  const chips = [];
  if (parsed.status_text) chips.push({ label: parsed.status_text, tone: 'accent' });
  if (parsed.face_confidence !== undefined) chips.push({ label: `${Math.round(parsed.face_confidence * 100)}% match`, tone: parsed.face_confidence >= 0.82 ? 'success' : 'accent' });
  if (parsed.geofence_status) chips.push({ label: parsed.geofence_status, tone: 'blue' });
  if (parsed.coordinates?.latitude !== undefined && parsed.coordinates?.longitude !== undefined) {
    chips.push({ label: `${Number(parsed.coordinates.latitude).toFixed(4)}, ${Number(parsed.coordinates.longitude).toFixed(4)}`, tone: 'muted' });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            chip.tone === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' :
            chip.tone === 'blue' ? 'bg-sky-50 border-sky-100 text-sky-700' :
            chip.tone === 'muted' ? 'bg-slate-50 border-slate-200 text-slate-500' :
            'bg-indigo-50 border-indigo-100 text-indigo-700'
          }`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { user } = useAuth();
  const { socket, connected } = useSocket();
  const [metrics, setMetrics] = useState({
    activeEmployees: 0,
    totalLogsCount: 0,
    securityAlerts: 0,
    averageHours: 0
  });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = React.useRef(true);

  // Excel Exporter States & Helpers
  const [exportMode, setExportMode] = useState('current');
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1);
  const [selYear, setSelYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handleExcelExport = async () => {
    setExportError('');
    setExportSuccess('');
    setExporting(true);

    try {
      // Fetch unified attendance records (Admin only)
      const res = await apiCall('/attendance', 'GET');
      if (!res.success) {
        throw new Error(res.message || 'Failed to fetch attendance ledger');
      }

      const records = res.logs || [];
      if (records.length === 0) {
        throw new Error('No attendance records found to export');
      }

      let filtered = [];
      let filename = 'Attendance-All.xlsx';

      if (exportMode === 'current') {
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        const monthName = monthNames[currentMonth - 1];
        
        filtered = records.filter(rec => {
          if (!rec.date) return false;
          const [year, month] = rec.date.split('-').map(Number);
          return year === currentYear && month === currentMonth;
        });
        filename = `Attendance-${monthName}-${currentYear}.xlsx`;
      } else if (exportMode === 'selected') {
        const monthName = monthNames[selMonth - 1];
        filtered = records.filter(rec => {
          if (!rec.date) return false;
          const [year, month] = rec.date.split('-').map(Number);
          return year === selYear && month === selMonth;
        });
        filename = `Attendance-${monthName}-${selYear}.xlsx`;
      } else {
        filtered = records;
      }

      if (filtered.length === 0) {
        throw new Error('No records matched the selected export month');
      }

      // Format records as JSON rows for SheetJS, mapping strictly to employee_id
      const rows = filtered.map(log => ({
        'Employee ID': log.employee_id || 'N/A',
        'Employee Name': log.name || 'Unknown',
        'Date': log.date || '',
        'Check In': log.check_in || '--',
        'Check Out': log.check_out || '--',
        'Hours Worked': log.working_hours !== undefined ? log.working_hours : 0,
        'Attendance Status': log.status || 'N/A'
      }));

      // Generate Workbook
      const ws = XLSX.utils.json_to_sheet(rows);
      
      // Auto width formatting for premium visual elegance
      const colWidths = [
        { wch: 15 }, // Employee ID
        { wch: 22 }, // Employee Name
        { wch: 14 }, // Date
        { wch: 12 }, // Check In
        { wch: 12 }, // Check Out
        { wch: 15 }, // Hours Worked
        { wch: 18 }  // Attendance Status
      ];
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Attendance Report");
      
      // Trigger download
      XLSX.writeFile(wb, filename);

      setExportSuccess(`Exported ${filtered.length} records to ${filename}!`);
      setTimeout(() => setExportSuccess(''), 4000);
    } catch (err) {
      console.error('[EXCEL EXPORT ERROR]:', err);
      setExportError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!user) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const fetchDashboardData = async () => {
      try {
        if (mountedRef.current) setLoading(true);
        const endpoint = user?.role === 'admin' ? '/logs' : '/logs/my-logs';
        const response = await apiCall(endpoint, 'GET');

        if (controller.signal.aborted || !mountedRef.current) return;

        if (response.success) {
          const fetchedLogs = response.logs || response.history || [];
          setLogs(fetchedLogs);

          if (user?.role === 'admin') {
            const employeesRes = await apiCall('/employees', 'GET');
            if (controller.signal.aborted || !mountedRef.current) return;
            const employeesList = employeesRes.employees || [];
            const active = employeesList.filter(e => e.status === 'Inside Office').length;
            const alerts = fetchedLogs.filter(l => l.event_type === 'SECURITY_ALERT' || l.event_type === 'UNAUTHORIZED_SCAN').length;
            setMetrics({ activeEmployees: active, totalLogsCount: fetchedLogs.length, securityAlerts: alerts, averageHours: 0 });
          } else {
            setMetrics({ activeEmployees: 0, totalLogsCount: fetchedLogs.length, securityAlerts: 0, averageHours: 0 });
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error('[DASHBOARD ERROR]: Failed to fetch operational logs:', err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    fetchDashboardData();
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [user]);

  useEffect(() => {
    if (!socket) return;
    const isAdmin = user?.role === 'admin';

    const handleNewLog = (newLog) => {
      // Data isolation: employees only see their own events
      if (!isAdmin && newLog.employee_id !== user?.id) return;

      setLogs(prev => [newLog, ...prev].slice(0, 50));
      setMetrics(prev => {
        const update = { ...prev, totalLogsCount: prev.totalLogsCount + 1 };
        if (isAdmin) {
          if (newLog.event_type === 'ENTER_GEOFENCE' || newLog.event_type === 'CHECK_IN') update.activeEmployees = prev.activeEmployees + 1;
          if (newLog.event_type === 'EXIT_GEOFENCE' || newLog.event_type === 'CHECK_OUT') update.activeEmployees = Math.max(0, prev.activeEmployees - 1);
        }
        return update;
      });
    };

    const handleUnauthorizedAlert = (alert) => {
      // Security alerts are admin-only — never leak to employees
      if (!isAdmin) return;
      setMetrics(prev => ({ ...prev, securityAlerts: prev.securityAlerts + 1 }));
      setLogs(prev => [{
        id: Date.now(),
        employee_id: 'UNKNOWN',
        employee_name: 'Unauthorized Person',
        event_type: 'UNAUTHORIZED_SCAN',
        timestamp: alert.timestamp,
        location: alert.location,
        details: { face_confidence: alert.confidence, status_text: 'Unauthorized Scan' }
      }, ...prev].slice(0, 50));
    };

    socket.on('logs:new', handleNewLog);
    socket.on('unauthorized:alert', handleUnauthorizedAlert);

    return () => {
      socket.off('logs:new', handleNewLog);
      socket.off('unauthorized:alert', handleUnauthorizedAlert);
    };
  }, [socket, user]);

  const metricCards = user?.role === 'admin'
    ? [
        { label: 'Inside office', value: metrics.activeEmployees, helper: 'Employees currently present', icon: Users, tone: 'emerald', bars: [18, 24, 15, 28, 21, 32, 20, 26, 34, 25, 30, 22], barA: '#10B981', barB: '#14B8A6' },
        { label: 'Activity logs', value: metrics.totalLogsCount, helper: 'Attendance and geofence events', icon: Database, tone: 'blue', bars: [16, 20, 28, 18, 33, 22, 30, 36, 24, 29, 19, 34], barA: '#3B82F6', barB: '#06B6D4' },
        { label: 'Security alerts', value: metrics.securityAlerts, helper: 'Unauthorized or suspicious scans', icon: AlertOctagon, tone: 'rose', bars: [14, 22, 18, 26, 16, 31, 20, 24, 15, 28, 18, 21], barA: '#EC4899', barB: '#EF4444' },
        { label: 'Average hours', value: '--', helper: 'Shift analytics ready for reports', icon: Clock, tone: 'amber', bars: [20, 14, 25, 31, 22, 18, 34, 28, 19, 30, 24, 27], barA: '#F59E0B', barB: '#F97316' },
      ]
    : [
        { label: 'Profile status', value: user?.department || 'Assigned', helper: `${user?.role || 'employee'} access`, icon: Fingerprint, tone: 'violet', wide: true, bars: [22, 16, 30, 25, 34, 20, 28, 18, 31, 24, 29, 21], barA: '#8B5CF6', barB: '#4F46E5' },
        { label: 'My logs', value: metrics.totalLogsCount, helper: 'Personal attendance events', icon: Database, tone: 'blue', bars: [18, 21, 26, 17, 32, 24, 29, 35, 20, 28, 23, 31], barA: '#3B82F6', barB: '#06B6D4' },
        { label: 'Last event', value: logs[0] ? logs[0].event_type : 'None', helper: logs[0] ? new Date(logs[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No scan recorded', icon: Activity, tone: 'emerald', bars: [15, 19, 27, 22, 33, 25, 18, 30, 24, 36, 28, 21], barA: '#10B981', barB: '#14B8A6' },
      ];

  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-sky-50 text-sky-700 border-sky-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
  };

  return (
    <div className="space-y-6">
      <div className="hero-band relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-80">Overview</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Attendance intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 opacity-85">Live attendance, location, biometric quality, and operations health in one modern AI workspace.</p>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/16 px-3 py-1.5 text-xs font-semibold backdrop-blur-md ${connected ? '' : 'opacity-90'}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-200' : 'bg-amber-200'} shadow-[0_0_0_4px_rgba(255,255,255,0.14)]`} />
            {connected ? 'Realtime connected' : 'Connecting realtime'}
          </span>
        </div>
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Active now', value: user?.role === 'admin' ? metrics.activeEmployees : user?.role || 'Employee' },
            { label: 'Audit events', value: metrics.totalLogsCount },
            { label: 'Alerts', value: metrics.securityAlerts },
            { label: 'Workspace', value: user?.department || 'AI ops' },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/20 bg-white/14 p-3 backdrop-blur-md">
              <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{item.label}</p>
              <p className="mt-1 truncate text-lg font-semibold">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <motion.div initial="hidden" animate="show" variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div key={card.label} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className={`glass-card metric-card ${card.tone} p-5 ${card.wide ? 'lg:col-span-2' : ''}`}>
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

      {/* Admin Attendance Export Panel */}
      {user?.role === 'admin' && (
        <div className="glass-panel-heavy p-5 rounded-xl space-y-4 relative overflow-hidden">
          <div className="spectrum-bar absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-violet-500 to-indigo-500" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-violet-100 bg-violet-50 p-2 text-violet-700">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Attendance Excel Exporter</h3>
                <p className="text-xs text-slate-500">Generate fully formatted spreadsheet reports</p>
              </div>
            </div>
            {exportError && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 px-3 py-1.5 rounded-xl font-sans">
                {exportError}
              </span>
            )}
            {exportSuccess && (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl font-sans">
                {exportSuccess}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pt-2">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Export Filter Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExportMode('current')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    exportMode === 'current'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Current Month
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('selected')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    exportMode === 'selected'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Custom Month
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('all')}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                    exportMode === 'all'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  All Records
                </button>
              </div>
            </div>

            {exportMode === 'selected' && (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Select Month</label>
                <select
                  value={selMonth}
                  onChange={(e) => setSelMonth(Number(e.target.value))}
                  className="w-full py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none font-bold text-slate-700"
                >
                  {monthNames.map((name, idx) => (
                    <option key={name} value={idx + 1}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {exportMode === 'selected' && (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Select Year</label>
                <select
                  value={selYear}
                  onChange={(e) => setSelYear(Number(e.target.value))}
                  className="w-full py-2 px-3 bg-white border border-slate-200 rounded-xl text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none font-bold text-slate-700"
                >
                  {[2025, 2026, 2027, 2028].map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={`sm:col-span-1 ${exportMode !== 'selected' ? 'sm:col-span-2' : ''}`}>
              <button
                type="button"
                onClick={handleExcelExport}
                disabled={exporting}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-[0_4px_12px_rgba(79,70,229,0.2)] flex items-center justify-center gap-2 transition hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer border border-indigo-400/20"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                {exporting ? 'Generating Report...' : 'Export Attendance'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel-heavy relative overflow-hidden rounded-xl">
        <div className="spectrum-bar absolute left-0 right-0 top-0 h-1" />
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-700">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Operations audit log</h3>
              <p className="text-xs text-slate-500">Recent biometric and geofence activity</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">{logs.length} records</span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
            <p className="mt-4 text-sm text-slate-500">Loading attendance activity...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Activity className="mb-3 h-7 w-7 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">No activity yet</p>
            <p className="mt-1 text-sm text-slate-500">New scans and geofence events will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Timestamp</th>
                  <th className="px-5 py-3">Employee ID</th>
                  <th className="px-5 py-3">Identity</th>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <AnimatePresence initial={false}>
                  {logs.map((log) => (
                    <motion.tr key={log.id || log.timestamp} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-5 py-4 text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString([], { hourCycle: 'h23' })}</td>
                      <td className="px-5 py-4 font-medium text-slate-700">{log.employee_id || 'Guest'}</td>
                      <td className="px-5 py-4 font-medium text-slate-900">{log.employee_name || log.name || 'Unknown'}</td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          log.event_type === 'CHECK_IN' || log.event_type === 'ENTER_GEOFENCE' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' :
                          log.event_type === 'CHECK_OUT' || log.event_type === 'EXIT_GEOFENCE' ? 'bg-sky-50 border-sky-100 text-sky-700' :
                          log.event_type === 'UNAUTHORIZED_SCAN' || log.event_type === 'SECURITY_ALERT' || log.event_type === 'SPOOF_ATTEMPT' ? 'bg-rose-50 border-rose-100 text-rose-700' :
                          'bg-slate-50 border-slate-200 text-slate-600'
                        }`}>
                          {log.event_type}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-500 whitespace-nowrap">{log.location || 'Front Desk Camera'}</td>
                      <td className="px-5 py-4">{renderTelemetryDetails(log.details)}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
