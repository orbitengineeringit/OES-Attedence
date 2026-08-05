import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SocketProvider, useSocket } from '../context/SocketContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, LayoutDashboard, ScanFace, MapPin, UserSquare2, Users2, LogOut, Wifi, WifiOff, Bell, Menu, X, Radio, ChevronLeft, ChevronRight, Sun, Moon, ShieldAlert, Calendar, Home, FileText } from 'lucide-react';

function DashboardLayoutInner() {
  const { user, logout, loading } = useAuth();
  const { connected, socket } = useSocket();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [showAlertDropdown, setShowAlertDropdown] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('quantum_sidebar_collapsed') === 'true');

  const menuItems = [
    // Admin Items
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['admin'], accent: '#4F46E5' },
    { name: 'Scanner', path: '/scanner', icon: ScanFace, roles: ['admin'], accent: '#06B6D4' },
    { name: 'Geofence', path: '/sandbox', icon: MapPin, roles: ['admin'], accent: '#10B981' },
    { name: 'Admin Control', path: '/admin', icon: Users2, roles: ['admin'], accent: '#EC4899' },
    { name: 'Reports', path: '/dashboard', icon: FileText, roles: ['admin'], accent: '#8B5CF6' },
    { name: 'Profile', path: '/profile', icon: UserSquare2, roles: ['admin'], accent: '#F59E0B' },

    // Employee Items
    { name: 'Scanner', path: '/scanner', icon: ScanFace, roles: ['employee'], accent: '#06B6D4' },
    { name: 'My Attendance', path: '/my-attendance', icon: Calendar, roles: ['employee'], accent: '#8B5CF6' },
    { name: 'My Profile', path: '/profile', icon: UserSquare2, roles: ['employee'], accent: '#F59E0B' },
  ];
  const allowedMenuItems = menuItems.filter(item => item.roles.includes(user?.role));
  const currentRouteName = menuItems.find(item => item.path === location.pathname)?.name || 'Workspace';

  useEffect(() => {
    if (!socket) return;
    const isAdmin = user?.role === 'admin';
    const handleNewLog = (data) => {
      // Employees only see their own activity in the notification feed
      if (!isAdmin && data.employee_id !== user?.id) return;
      setAlerts(prev => ([{ id: Date.now(), title: `Activity: ${data.event_type}`, message: `${data.name || 'Unknown'} - ${data.details?.status_text || 'Boundary trigger'}`, type: 'info', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...prev]).slice(0, 10));
    };
    const handleUnauthorized = () => {
      // Security alerts are admin-only
      if (!isAdmin) return;
      setAlerts(prev => ([{ id: Date.now(), title: 'Security alert', message: 'Unauthorized face scan detected.', type: 'danger', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...prev]).slice(0, 10));
    };
    socket.on('logs:new', handleNewLog);
    socket.on('unauthorized:alert', handleUnauthorized);
    return () => {
      socket.off('logs:new', handleNewLog);
      socket.off('unauthorized:alert', handleUnauthorized);
    };
  }, [socket, user]);

  if (loading) return null;

  const handleLogoutClick = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      <div className="absolute inset-0 soft-grid opacity-[0.18] pointer-events-none" />

      <motion.aside animate={{ width: isCollapsed ? 80 : 280 }} transition={{ duration: 0.25 }} className="app-sidebar-shell hidden lg:flex flex-col border-r border-slate-200/80 shrink-0 relative z-20 backdrop-blur-xl">
        <div className="h-20 flex items-center px-4 border-b border-slate-200 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="spectrum-logo w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-white force-white" />
            </div>
            {!isCollapsed && (
              <div className="whitespace-nowrap">
                <h1 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">Smart<span className="text-indigo-600">Attendance</span></h1>
                <span className="text-[11px] text-slate-500 uppercase block -mt-0.5">Enterprise AI Platform</span>
              </div>
            )}
          </div>
          <button onClick={() => { const next = !isCollapsed; setIsCollapsed(next); localStorage.setItem('quantum_sidebar_collapsed', String(next)); }} className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-900 shadow-sm">
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {allowedMenuItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} title={isCollapsed ? item.name : ''} style={{ '--nav-accent': item.accent }} className={({ isActive }) => `nav-item flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 border text-sm font-medium ${isActive ? 'nav-item-active' : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>
                <Icon className="w-4 h-4 shrink-0" style={{ color: item.accent }} />
                {!isCollapsed && <span className="truncate">{item.name}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 bg-white/80">
          <div className="flex items-center gap-3 px-1 py-1 mb-4 overflow-hidden">
            <div className="spectrum-logo w-9 h-9 rounded-full flex items-center justify-center uppercase font-semibold text-white text-xs shrink-0 force-white">{(user?.name || '').slice(0, 2)}</div>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate leading-none">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate capitalize mt-1">{user?.role} / {user?.department}</p>
              </div>
            )}
          </div>
          <button onClick={handleLogoutClick} className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-red-600 hover:bg-red-50 hover:border-red-100 transition-all duration-200 text-xs font-semibold ${isCollapsed ? 'px-0' : ''}`}>
            <LogOut className="w-3.5 h-3.5" />
            {!isCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex lg:hidden bg-slate-900/15 backdrop-blur-sm">
            <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="app-sidebar-shell w-72 h-full flex flex-col relative shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
              <div className="h-20 flex items-center justify-between px-6 border-b border-slate-200">
                <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-600" /><span className="font-semibold text-slate-900 text-sm tracking-wide">SmartAttendance</span></div>
                <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
              <nav className="flex-1 px-4 py-5 space-y-1">
                {allowedMenuItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path} onClick={() => setMobileOpen(false)} style={{ '--nav-accent': item.accent }} className={({ isActive }) => `nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border text-sm font-medium ${isActive ? 'nav-item-active' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                      <Icon className="w-4 h-4" style={{ color: item.accent }} />
                      {item.name}
                    </NavLink>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-200"><button onClick={handleLogoutClick} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-red-600 hover:bg-red-100 transition-all duration-200 text-sm font-semibold"><LogOut className="w-4 h-4" /> Sign out</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="app-topbar-shell h-20 border-b border-slate-200 flex items-center justify-between px-6 lg:px-8 backdrop-blur-xl sticky top-0 z-30">
          <div className="spectrum-bar absolute left-0 right-0 top-0 h-1" />
          <div className="flex items-center gap-4">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 bg-white"><Menu className="w-5 h-5" /></button>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 uppercase flex items-center gap-2 tracking-wide"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />{currentRouteName}</h2>
              <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">Operational intelligence workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-medium select-none ${connected ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{connected ? <><Wifi className="w-3.5 h-3.5" /><span className="hidden sm:inline">Sync active</span></> : <><WifiOff className="w-3.5 h-3.5" /><span className="hidden sm:inline">Offline</span></>}</div>
            <button onClick={toggleTheme} className="p-2 rounded-xl border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-slate-500 hover:text-slate-900 cursor-pointer bg-white" title={theme === 'dark' ? 'Activate Light Mode' : 'Activate Dark Mode'}>{theme === 'dark' ? <Sun className="w-4.5 h-4.5 text-indigo-600" /> : <Moon className="w-4.5 h-4.5 text-indigo-600" />}</button>
            <div className="relative">
              <button onClick={() => setShowAlertDropdown(!showAlertDropdown)} className="p-2 rounded-xl border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 transition-all text-slate-500 hover:text-slate-900 relative cursor-pointer bg-white"><Bell className="w-4 h-4" />{alerts.length > 0 && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />}</button>
              <AnimatePresence>
                {showAlertDropdown && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute right-0 mt-3 w-80 bg-white border border-slate-200 rounded-2xl shadow-[0_16px_36px_rgba(15,23,42,0.08)] p-4 overflow-hidden z-50">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-2"><span className="text-[10px] font-semibold tracking-wider uppercase text-slate-700 flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-indigo-500" /> Live logs feed</span><button onClick={() => setAlerts([])} className="text-[11px] text-slate-500 hover:text-slate-900">Clear</button></div>
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1.5">
                      {alerts.length === 0 ? <div className="py-8 text-center"><ShieldAlert className="w-5 h-5 text-slate-400 mx-auto mb-2" /><p className="text-xs text-slate-500">System secure. No events detected.</p></div> : alerts.map(a => <div key={a.id} className={`p-3 rounded-xl border text-xs ${a.type === 'danger' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-slate-50 border-slate-100 text-slate-600'}`}><div className="flex justify-between items-start"><span className="font-semibold uppercase">{a.title}</span><span className="text-[11px] text-slate-400">{a.time}</span></div><p className="mt-1 leading-relaxed">{a.message}</p></div>)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  return <SocketProvider><DashboardLayoutInner /></SocketProvider>;
}
