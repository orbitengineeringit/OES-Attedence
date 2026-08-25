import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { apiCall } from '../services/api.js';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  AlertOctagon, 
  Clock, 
  Activity, 
  Database, 
  Fingerprint, 
  ShieldCheck, 
  Download, 
  FileText,
  Trash2,
  Search,
  CheckCircle2,
  UserX,
  X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { UserAvatar, LiveIndicator, EmptyState, SkeletonTable } from '../components/common/CommonUI.jsx';

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
  if (!parsed) return <span className="text-xs text-slate-400">No telemetry</span>;

  const chips = [];
  if (parsed.status_text) chips.push({ label: parsed.status_text, tone: 'neutral' });
  if (parsed.face_confidence !== undefined) {
    chips.push({ 
      label: `${Math.round(parsed.face_confidence * 100)}% match`, 
      tone: parsed.face_confidence >= 0.82 ? 'success' : 'neutral' 
    });
  }
  if (parsed.geofence_status) chips.push({ label: parsed.geofence_status, tone: 'info' });
  if (parsed.coordinates?.latitude !== undefined && parsed.coordinates?.longitude !== undefined) {
    chips.push({ 
      label: `${Number(parsed.coordinates.latitude).toFixed(4)}, ${Number(parsed.coordinates.longitude).toFixed(4)}`, 
      tone: 'neutral' 
    });
  }

  const toneClassMap = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
    neutral: 'bg-slate-50 border-slate-200 text-slate-600',
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClassMap[chip.tone] || toneClassMap.neutral}`}
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
  const [employees, setEmployees] = useState([]);
  const [empSearch, setEmpSearch] = useState('');
  const [deleteConfirmEmp, setDeleteConfirmEmp] = useState(null);
  const [deletingEmpId, setDeletingEmpId] = useState(null);
  const [deleteFeedback, setDeleteFeedback] = useState('');
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

  const handleDeleteEmployee = async (emp) => {
    if (!emp) return;
    setDeletingEmpId(emp.id);
    try {
      const res = await apiCall(`/employees/${encodeURIComponent(emp.id)}`, 'DELETE');
      if (res.success) {
        setDeleteFeedback(`Employee profile for ${emp.name} (${emp.id}) was permanently deleted along with all biometric data.`);
        setTimeout(() => setDeleteFeedback(''), 5000);
        setDeleteConfirmEmp(null);

        // Refresh employees and logs
        const employeesRes = await apiCall('/employees', 'GET');
        if (employeesRes.success) {
          setEmployees(employeesRes.employees || []);
        }
        const endpoint = user?.role === 'admin' ? '/logs' : '/logs/my-logs';
        const logsRes = await apiCall(endpoint, 'GET');
        if (logsRes.success) {
          setLogs(logsRes.logs || logsRes.history || []);
        }
      }
    } catch (err) {
      console.error('[DELETE EMPLOYEE ERROR]:', err);
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingEmpId(null);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    if (!empSearch.trim()) return true;
    const q = empSearch.toLowerCase();
    return (
      emp.name?.toLowerCase().includes(q) ||
      emp.id?.toLowerCase().includes(q) ||
      emp.email?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.role?.toLowerCase().includes(q)
    );
  });

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
            setEmployees(employeesList);

            let attendanceRecords = [];
            try {
              const attRes = await apiCall('/attendance', 'GET');
              if (attRes.success && attRes.logs) {
                attendanceRecords = attRes.logs;
              }
            } catch (e) {
              console.warn('[DASHBOARD] Attendance records fetch for stats:', e);
            }

            const todayUTC = new Date().toISOString().split('T')[0];
            const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

            // Active Now count:
            // Employees marked 'Online' / 'Inside Office' OR having a check_in today without check_out
            const checkedInTodayIds = new Set(
              attendanceRecords
                .filter(a => (a.date === todayUTC || a.date === todayIST) && a.check_in && !a.check_out)
                .map(a => a.employee_id)
            );
            const activeCount = employeesList.filter(e => 
              e.status === 'Online' || e.status === 'Inside Office' || checkedInTodayIds.has(e.id)
            ).length;

            // Average Working Hours:
            // Calculate average working hours from completed records with safe float parsing
            const completedRecords = attendanceRecords.filter(a => {
              const hrs = parseFloat(a.working_hours);
              return !isNaN(hrs) && hrs > 0;
            });
            let avgHours = '0.0';
            if (completedRecords.length > 0) {
              const total = completedRecords.reduce((sum, r) => sum + parseFloat(r.working_hours), 0);
              avgHours = (total / completedRecords.length).toFixed(1);
            }

            const alertEventTypes = new Set([
              'SECURITY_ALERT',
              'UNAUTHORIZED_SCAN',
              'SPOOF_ATTEMPT',
              'VELOCITY_BREACH',
              'REPLAY_ATTEMPT',
              'GEOFENCE_VIOLATION',
              'GPS_ERROR'
            ]);
            const alerts = fetchedLogs.filter(l => alertEventTypes.has(l.event_type)).length;

            setMetrics({ 
              activeEmployees: activeCount, 
              totalLogsCount: fetchedLogs.length, 
              securityAlerts: alerts, 
              averageHours: avgHours 
            });
          } else {
            // Employee specific stats
            let avgHours = '0.0';
            try {
              const myAttRes = await apiCall('/attendance/my-history', 'GET');
              if (myAttRes.success && myAttRes.history) {
                const completed = myAttRes.history.filter(a => typeof a.working_hours === 'number' && a.working_hours > 0);
                if (completed.length > 0) {
                  const total = completed.reduce((sum, r) => sum + r.working_hours, 0);
                  avgHours = (total / completed.length).toFixed(1);
                }
              }
            } catch (e) {}

            setMetrics({ 
              activeEmployees: 0, 
              totalLogsCount: fetchedLogs.length, 
              securityAlerts: 0, 
              averageHours: avgHours 
            });
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

  // Restrained semantic stat cards: icons tinted strictly by their status meaning
  const metricCards = user?.role === 'admin'
    ? [
        { 
          label: 'Active now', 
          value: metrics.activeEmployees, 
          helper: 'Employees currently present', 
          icon: Users, 
          iconStyle: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        },
        { 
          label: 'Audit events', 
          value: metrics.totalLogsCount, 
          helper: 'Attendance and geofence events', 
          icon: Database, 
          iconStyle: 'bg-indigo-50 text-indigo-600 border-indigo-100',
        },
        { 
          label: 'Security alerts', 
          value: metrics.securityAlerts, 
          helper: 'Unauthorized or suspicious scans', 
          icon: AlertOctagon, 
          iconStyle: metrics.securityAlerts > 0 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200',
        },
        { 
          label: 'Average hours', 
          value: metrics.averageHours ? `${metrics.averageHours}h` : '0.0h', 
          helper: 'Average daily shift duration', 
          icon: Clock, 
          iconStyle: 'bg-indigo-50 text-indigo-600 border-indigo-100',
        },
      ]
    : [
        { 
          label: 'Profile status', 
          value: user?.department || 'Assigned', 
          helper: `${user?.role || 'employee'} access`, 
          icon: Fingerprint, 
          iconStyle: 'bg-indigo-50 text-indigo-600 border-indigo-100',
          wide: true 
        },
        { 
          label: 'My logs', 
          value: metrics.totalLogsCount, 
          helper: 'Personal attendance events', 
          icon: Database, 
          iconStyle: 'bg-slate-50 text-slate-600 border-slate-200',
        },
        { 
          label: 'Last event', 
          value: logs[0] ? logs[0].event_type : 'None', 
          helper: logs[0] ? new Date(logs[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No scan recorded', 
          icon: Activity, 
          iconStyle: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        },
      ];

  const getEventBadgeClass = (eventType) => {
    switch (eventType) {
      case 'CHECK_IN':
      case 'ENTER_GEOFENCE':
        return 'badge-success';
      case 'CHECK_OUT':
      case 'EXIT_GEOFENCE':
        return 'badge-info';
      case 'UNAUTHORIZED_SCAN':
      case 'SECURITY_ALERT':
      case 'SPOOF_ATTEMPT':
        return 'badge-error';
      default:
        return 'badge-neutral';
    }
  };

  return (
    <div className="space-y-6">
      {/* Clean White Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">Attendance intelligence</h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">Live attendance, location verification, and operations status.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
            <LiveIndicator connected={connected} label={connected ? 'Realtime connected' : 'Connecting realtime...'} />
          </div>
        </div>

        {/* Top Summary Badges */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
          {[
            { label: 'Active now', value: user?.role === 'admin' ? metrics.activeEmployees : user?.role || 'Employee' },
            { label: 'Audit events', value: metrics.totalLogsCount },
            { label: 'Alerts', value: metrics.securityAlerts },
            { label: 'Workspace', value: user?.department || 'Operations' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900 truncate">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div 
              key={card.label} 
              className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md ${card.wide ? 'sm:col-span-2' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">{card.label}</p>
                  <h2 className="mt-1.5 text-2xl sm:text-3xl font-semibold text-slate-900 truncate">{card.value}</h2>
                </div>
                <div className={`rounded-lg border p-2 shrink-0 ${card.iconStyle}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
                <span>{card.helper}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Attendance Excel Exporter Panel (Admin only) */}
      {user?.role === 'admin' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Attendance report exporter</h3>
                <p className="text-xs text-slate-500">Generate formatted spreadsheet reports</p>
              </div>
            </div>
            {exportError && (
              <span className="ui-badge badge-error">
                {exportError}
              </span>
            )}
            {exportSuccess && (
              <span className="ui-badge badge-success">
                {exportSuccess}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pt-1">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-xs font-medium text-slate-600">Export filter mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExportMode('current')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    exportMode === 'current'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Current month
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('selected')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    exportMode === 'selected'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Custom month
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('all')}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    exportMode === 'all'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  All records
                </button>
              </div>
            </div>

            {exportMode === 'selected' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Select month</label>
                <select
                  value={selMonth}
                  onChange={(e) => setSelMonth(Number(e.target.value))}
                  className="w-full py-2 px-3 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
                >
                  {monthNames.map((name, idx) => (
                    <option key={name} value={idx + 1}>{name}</option>
                  ))}
                </select>
              </div>
            )}

            {exportMode === 'selected' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-600">Select year</label>
                <select
                  value={selYear}
                  onChange={(e) => setSelYear(Number(e.target.value))}
                  className="w-full py-2 px-3 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
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
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                {exporting ? 'Generating report...' : 'Export attendance (.xlsx)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Management & Directory (Admin only) */}
      {user?.role === 'admin' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden space-y-0">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Employee directory & management</h3>
                <p className="text-xs text-slate-500">View enterprise profiles, biometric status, and delete accounts</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search name, ID, department..."
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  className="w-full pl-8.5 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white transition-colors"
                />
              </div>
              <span className="ui-badge badge-neutral shrink-0">{filteredEmployees.length} employees</span>
            </div>
          </div>

          {deleteFeedback && (
            <div className="p-3 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium">{deleteFeedback}</span>
              </div>
              <button 
                type="button" 
                onClick={() => setDeleteFeedback('')}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {loading ? (
            <SkeletonTable rows={3} cols={6} />
          ) : filteredEmployees.length === 0 ? (
            <EmptyState
              icon={Users}
              title={empSearch ? "No employees match your search" : "No employees registered yet"}
              description={empSearch ? "Try searching for a different employee name, ID, or department." : "Add employees from the Admin Control panel."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500">
                    <th className="px-5 py-3 font-medium">Employee</th>
                    <th className="px-5 py-3 font-medium">Employee ID</th>
                    <th className="px-5 py-3 font-medium">Email address</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Department</th>
                    <th className="px-5 py-3 font-medium">Face biometrics</th>
                    <th className="px-5 py-3 font-medium text-right">Delete option</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <AnimatePresence initial={false}>
                    {filteredEmployees.map((emp) => (
                      <motion.tr
                        key={emp.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="transition-colors hover:bg-slate-50/70"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={emp.name} avatar={emp.avatar || emp.profile_image} size="xs" />
                            <div>
                              <span className="font-medium text-slate-900 block">{emp.name}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-600 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-xs font-mono">
                            {emp.id}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs">
                          {emp.email}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`ui-badge ${emp.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>
                            {emp.role}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 text-xs">
                          {emp.department || 'Engineering'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`ui-badge ${emp.is_face_registered ? 'badge-success' : 'badge-neutral'}`}>
                            {emp.is_face_registered ? 'Registered' : 'Not Enrolled'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmEmp(emp)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 font-medium text-xs transition-colors shadow-xs cursor-pointer"
                            title={`Completely delete ${emp.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Operations Audit Log Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Operations audit log</h3>
              <p className="text-xs text-slate-500">Recent biometric and geofence activity</p>
            </div>
          </div>
          <span className="ui-badge badge-neutral">{logs.length} records</span>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity recorded yet"
            description="New biometric scans and geofence events will appear here in realtime."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Employee ID</th>
                  <th className="px-5 py-3 font-medium">Identity</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Location</th>
                  <th className="px-5 py-3 font-medium">Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence initial={false}>
                  {logs.map((log) => {
                    const employeeName = log.employee_name || log.name || 'Unknown';
                    return (
                      <motion.tr 
                        key={log.id || log.timestamp} 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="transition-colors hover:bg-slate-50/70"
                      >
                        <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap text-xs">
                          {new Date(log.timestamp).toLocaleString([], { hourCycle: 'h23' })}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-600">
                          {log.employee_id || 'Guest'}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={employeeName} avatar={log.avatar || log.employees?.avatar} size="xs" />
                            <span className="font-medium text-slate-900">{employeeName}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`ui-badge ${getEventBadgeClass(log.event_type)}`}>
                            {log.event_type}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap text-xs">
                          {log.location || 'Front Desk Camera'}
                        </td>
                        <td className="px-5 py-3.5">
                          {renderTelemetryDetails(log.details)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Employee Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmEmp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
                  <UserX className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Delete employee profile</h3>
                  <p className="text-xs text-slate-500">Permanent data deletion</p>
                </div>
              </div>

              <div className="bg-red-50/80 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 space-y-1.5">
                <p className="font-semibold text-red-900">
                  Are you sure you want to completely delete {deleteConfirmEmp.name}?
                </p>
                <p className="text-red-700 leading-relaxed text-[11px]">
                  Employee ID: <code className="font-mono font-semibold bg-white/70 px-1.5 py-0.5 rounded border border-red-200">{deleteConfirmEmp.id}</code>
                </p>
                <p className="text-red-700 leading-relaxed text-[11px]">
                  This will permanently wipe their account, face biometric descriptors, encrypted photo assets, and all attendance logs from the system.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={deletingEmpId !== null}
                  onClick={() => setDeleteConfirmEmp(null)}
                  className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingEmpId !== null}
                  onClick={() => handleDeleteEmployee(deleteConfirmEmp)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-xs"
                >
                  {deletingEmpId === deleteConfirmEmp.id ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Deleting profile...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete employee</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
