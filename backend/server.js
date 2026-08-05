import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeSocket } from './src/config/socket.js';
import { initializeDatabase } from './src/database/db.js';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);

// Middlewares
app.use(helmet()); // Basic security headers

app.use(cors({
  origin: true, // Allow all origins for local dev
  credentials: true
}));
app.use(express.json());

// Basic Rate Limiter for all routes to prevent brute force
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api/', apiLimiter);

// Initialize SQLite Database
const db = await initializeDatabase();

// Initialize Socket.IO Server
const io = initializeSocket(httpServer);

// Attach db and io to app local state for easy access in routes/controllers
app.locals.db = db;
app.locals.io = io;

// Import modular routes
import authRoutes from './src/routes/auth.js';
import employeeRoutes from './src/routes/employees.js';
import attendanceRoutes from './src/routes/attendance.js';
import logsRoutes from './src/routes/logs.js';
import settingsRoutes from './src/routes/settings.js';

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/settings', settingsRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`=============================================================`);
  console.log(`  AI FACE ATTENDANCE & GEOFENCING BACKEND RUNNING ON PORT ${PORT}`);
  console.log(`=============================================================`);
});
