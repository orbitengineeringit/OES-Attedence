import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SocketProvider, useSocket } from '../context/SocketContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, 
  LayoutDashboard, 
  ScanFace, 
  MapPin, 
  UserSquare2, 
  Users2, 
  LogOut, 
  Wifi, 
  WifiOff, 
  Bell, 
  Menu, 
  X, 
  Radio, 
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon, 
  ShieldAlert, 
  Calendar, 
  FileText 
} from 'lucide-react';
import { UserAvatar } from '../components/common/CommonUI.jsx';

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
    // Admin Items (Sentence case)
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['admin'] },
    { name: 'Scanner', path: '/scanner', icon: ScanFace, roles: ['admin'] },
    { name: 'Geofence sandbox', path: '/sandbox', icon: MapPin, roles: ['admin'] },
    { name: 'Admin control', path: '/admin', icon: Users2, roles: ['admin'] },
    { name: 'Profile', path: '/profile', icon: UserSquare2, roles: ['admin'] },

    // Employee Items (Sentence case)
    { name: 'Dashboard', path: '/employee-dashboard', icon: LayoutDashboard, roles: ['employee'] },
    { name: 'Scanner', path: '/scanner', icon: ScanFace, roles: ['employee'] },
    { name: 'My attendance', path: '/my-attendance', icon: Calendar, roles: ['employee'] },
    { name: 'Profile', path: '/profile', icon: UserSquare2, roles: ['employee'] },
  ];
  const allowedMenuItems = menuItems.filter(item => item.roles.includes(user?.role));
  const currentRouteName = menuItems.find(item => item.path === location.pathname)?.name || 'Workspace';

  useEffect(() => {
    if (!socket) return;
    const isAdmin = user?.role === 'admin';
    const handleNewLog = (data) => {
      // Employees only see their own activity in the notification feed
      if (!isAdmin && data.employee_id !== user?.id) return;
      setAlerts(prev => ([{ 
        id: Date.now(), 
        title: `Activity: ${data.event_type}`, 
        message: `${data.name || 'Unknown'} - ${data.details?.status_text || 'Boundary trigger'}`, 
        type: 'info', 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      }, ...prev]).slice(0, 10));
    };
    const handleUnauthorized = () => {
      // Security alerts are admin-only
      if (!isAdmin) return;
      setAlerts(prev => ([{ 
        id: Date.now(), 
        title: 'Security alert', 
        message: 'Unauthorized face scan detected.', 
        type: 'danger', 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      }, ...prev]).slice(0, 10));
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
    <div className="h-screen w-full flex overflow-hidden bg-slate-50 dark:bg-slate-950 transition-colors">
      {/* Desktop Collapsible Sidebar */}
      <motion.aside 
        animate={{ width: isCollapsed ? 80 : 260 }} 
        transition={{ duration: 0.2, ease: 'easeOut' }} 
        className="app-sidebar-shell hidden lg:flex flex-col border-r border-slate-200 shrink-0 h-full relative z-20"
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center px-4 border-b border-slate-200 justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <div className="whitespace-nowrap">
                <h1 className="text-sm font-semibold text-slate-900 tracking-tight">Smart Attendance</h1>
                <span className="text-[11px] text-slate-500 block leading-tight">AI enterprise platform</span>
              </div>
            )}
          </div>
          <button 
            onClick={() => { const next = !isCollapsed; setIsCollapsed(next); localStorage.setItem('quantum_sidebar_collapsed', String(next)); }} 
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm transition-colors cursor-pointer"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {allowedMenuItems.map(item => {
            const Icon = item.icon;
            return (
              <NavLink 
                key={item.name} 
                to={item.path} 
                title={isCollapsed ? item.name : ''} 
                className={({ isActive }) => 
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive 
                      ? 'bg-indigo-50 text-indigo-700 font-semibold' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                    {!isCollapsed && <span className="truncate">{item.name}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User profile & sign out */}
        <div className="p-3 border-t border-slate-200 bg-white">
          <div className="flex items-center gap-2.5 px-1 py-1 mb-3 overflow-hidden">
            <UserAvatar name={user?.name} avatar={user?.avatar} size="sm" />
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate leading-tight">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate capitalize leading-tight mt-0.5">{user?.role} · {user?.department}</p>
              </div>
            )}
          </div>
          <button 
            onClick={handleLogoutClick} 
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors text-xs font-medium cursor-pointer ${isCollapsed ? 'px-0' : ''}`}
          >
            <LogOut className="w-3.5 h-3.5" />
            {!isCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </motion.aside>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 flex lg:hidden bg-slate-900/30 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ x: -280 }} 
              animate={{ x: 0 }} 
              exit={{ x: -280 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }} 
              className="bg-white w-72 h-full flex flex-col relative shadow-xl"
            >
              <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="font-semibold text-slate-900 text-sm">Smart Attendance</span>
                </div>
                <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
                {allowedMenuItems.map(item => {
                  const Icon = item.icon;
                  return (
                    <NavLink 
                      key={item.path} 
                      to={item.path} 
                      onClick={() => setMobileOpen(false)} 
                      className={({ isActive }) => 
                        `flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-colors min-h-[44px] ${
                          isActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                          {item.name}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-200">
                <button 
                  onClick={handleLogoutClick} 
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-sm font-medium min-h-[44px]"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Top bar */}
        <header className="app-topbar-shell h-16 border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0 z-30">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setMobileOpen(true)} 
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 bg-white min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 capitalize flex items-center gap-2">
                {currentRouteName}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Live Connection Status Badge */}
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium select-none ${
              connected 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              <span className="relative flex h-1.5 w-1.5">
                {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </span>
              <span className="hidden sm:inline">{connected ? 'Live connected' : 'Offline'}</span>
            </div>

            {/* Theme Toggle */}
            <button 
              onClick={toggleTheme} 
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer bg-white min-h-[40px] min-w-[40px] flex items-center justify-center" 
              title={theme === 'dark' ? 'Activate light mode' : 'Activate dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-indigo-600" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowAlertDropdown(!showAlertDropdown)} 
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors relative cursor-pointer bg-white min-h-[40px] min-w-[40px] flex items-center justify-center"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {alerts.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
              </button>
              
              <AnimatePresence>
                {showAlertDropdown && (
                  <motion.div 
                    initial={{ opacity: 0, y: 8 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    exit={{ opacity: 0, y: 8 }} 
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4 overflow-hidden z-50"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-indigo-600" /> Live activity feed
                      </span>
                      {alerts.length > 0 && (
                        <button onClick={() => setAlerts([])} className="text-xs text-slate-400 hover:text-slate-700">
                          Clear all
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                      {alerts.length === 0 ? (
                        <div className="py-6 text-center">
                          <ShieldAlert className="w-5 h-5 text-slate-300 mx-auto mb-1.5" />
                          <p className="text-xs text-slate-500">System secure. No new events.</p>
                        </div>
                      ) : (
                        alerts.map(a => (
                          <div 
                            key={a.id} 
                            className={`p-2.5 rounded-lg border text-xs ${
                              a.type === 'danger' 
                                ? 'bg-red-50 border-red-200 text-red-800' 
                                : 'bg-slate-50 border-slate-200 text-slate-700'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <span className="font-semibold text-[11px]">{a.title}</span>
                              <span className="text-[10px] text-slate-400">{a.time}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-600 leading-snug">{a.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  return (
    <SocketProvider>
      <DashboardLayoutInner />
    </SocketProvider>
  );
}
