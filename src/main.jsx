import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';
import 'leaflet/dist/leaflet.css';
import './index.css';

// NOTE: SocketProvider has been moved into DashboardLayout.jsx
// This ensures Supabase Realtime only initializes AFTER auth hydration is complete,
// preventing the WebSocket from racing against getSession() and causing deadlocks.

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  </ThemeProvider>
);
