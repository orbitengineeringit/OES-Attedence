import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthLayout() {
  const { isAuthenticated, loading } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f3f8fc]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-3 border-blue-100 border-t-blue-600 animate-spin"></div>
          <p className="text-sm font-semibold text-slate-650 uppercase tracking-wider font-mono">Restoring secure session...</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
