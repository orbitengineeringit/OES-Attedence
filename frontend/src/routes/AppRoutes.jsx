import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

// Layouts (Keep these synchronous as they wrap everything)
import AuthLayout from '../layouts/AuthLayout.jsx';
import DashboardLayout from '../layouts/DashboardLayout.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';
import ErrorBoundary from '../context/ErrorBoundary.jsx';

// Lazy loaded Views
const Login = React.lazy(() => import('../views/Login.jsx'));
const Dashboard = React.lazy(() => import('../views/Dashboard.jsx'));
const EmployeeDashboard = React.lazy(() => import('../views/EmployeeDashboard.jsx'));
const FaceEnrollment = React.lazy(() => import('../views/FaceEnrollment.jsx'));
const MyAttendance = React.lazy(() => import('../views/MyAttendance.jsx'));
const BiometricScanner = React.lazy(() => import('../views/BiometricScanner.jsx'));
const GeofenceSandbox = React.lazy(() => import('../views/GeofenceSandbox.jsx'));
const AdminPanel = React.lazy(() => import('../views/AdminPanel.jsx'));
const Profile = React.lazy(() => import('../views/Profile.jsx'));

// Loading Fallback Component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
  </div>
);

// Role-aware catch-all redirect component
function RoleRedirect() {
  try {
    const raw = localStorage.getItem('quantum_user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.role === 'admin') return <Navigate to="/dashboard" replace />;
    }
  } catch { /* fall through */ }
  return <Navigate to="/employee-dashboard" replace />;
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Authentication Layout Routes */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Main Dashboard Layout Protected Routes */}
        <Route element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
          {/* Admin-only: Full dashboard */}
          <Route path="/dashboard" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            </ProtectedRoute>
          } />

          {/* Employee landing page */}
          <Route path="/employee-dashboard" element={
            <ErrorBoundary>
              <EmployeeDashboard />
            </ErrorBoundary>
          } />

          {/* First Login Face Enrollment */}
          <Route path="/enroll-face" element={
            <ErrorBoundary>
              <FaceEnrollment />
            </ErrorBoundary>
          } />

          {/* Employee attendance history */}
          <Route path="/my-attendance" element={
            <ErrorBoundary>
              <MyAttendance />
            </ErrorBoundary>
          } />

          {/* Scanner — accessible by all authenticated users */}
          <Route path="/scanner" element={
            <ErrorBoundary>
              <BiometricScanner />
            </ErrorBoundary>
          } />

          {/* Admin-only: Geofence sandbox */}
          <Route path="/sandbox" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <ErrorBoundary>
                <GeofenceSandbox />
              </ErrorBoundary>
            </ProtectedRoute>
          } />

          {/* Profile — accessible by all authenticated users */}
          <Route path="/profile" element={
            <ErrorBoundary>
              <Profile />
            </ErrorBoundary>
          } />
          
          {/* Admin-only: Admin control panel */}
          <Route path="/admin" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <ErrorBoundary>
                <AdminPanel />
              </ErrorBoundary>
            </ProtectedRoute>
          } />
        </Route>

        {/* Catch-all: redirect based on user role */}
        <Route path="*" element={<RoleRedirect />} />
      </Routes>
    </Suspense>
  );
}
