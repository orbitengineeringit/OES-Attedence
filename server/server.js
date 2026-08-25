import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs-extra';
import { initializeSocket } from './config/socket.js';
import { initializeDatabase } from './database/db.js';
import { descriptorCache } from './services/descriptorCache.js';
import { initializeStorageBuckets } from './services/supabaseStorage.js';

// Load environment variables from root .env
dotenv.config();

const app = express();
app.set('trust proxy', true); // Trust reverse proxies to capture correct client IP (X-Forwarded-For)
const httpServer = createServer(app);

// Middlewares
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Allows inline scripts & dynamic web worker models
}));

// [C-06 FIX]: Restrict CORS to configured allowed origins only — never open to all.
// Set ALLOWED_ORIGIN in .env (comma-separated for multiple origins).
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin requests (no origin header) and configured origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS BLOCKED]: Request from disallowed origin: ${origin}`);
      callback(new Error(`CORS policy: Origin ${origin} is not allowed.`));
    }
  },
  credentials: true
}));

// Increase JSON payload limit for base64 photo uploads
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Serve local photo uploads statically as fallback (uploads/employees & uploads/attendance)
app.use('/uploads', express.static(path.resolve('uploads')));

// [H-03 FIX]: General API rate limiter — reduced from 1000 to 200 per 15 min.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);



// Auto-Initialize Supabase Storage Buckets
await initializeStorageBuckets();

// Initialize Database & Descriptor Memory Cache
const db = await initializeDatabase();
await descriptorCache.initialize(db);

// Initialize Socket.IO Server
const io = initializeSocket(httpServer);

// Attach db, io, and descriptorCache to app locals
app.locals.db = db;
app.locals.io = io;
app.locals.descriptorCache = descriptorCache;

// Import modular API routes
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import logsRoutes from './routes/logs.js';
import settingsRoutes from './routes/settings.js';
import auditRoutes from './routes/audit.js';

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);

// Serve static frontend bundle in production mode
const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  console.log(`[PRODUCTION BUILD FOUND]: Serving static web assets from ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

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
if (!process.env.VERCEL) {
  httpServer.listen(PORT, () => {
    console.log(`=============================================================`);
    console.log(`  ENTERPRISE SMART FACE ATTENDANCE ENGINE PORT: ${PORT}`);
    console.log(`  SUPABASE CLOUD STORAGE & DATABASE ACTIVE`);
    console.log(`  CACHED DESCRIPTORS: ${descriptorCache.size()} Active Templates`);
    console.log(`=============================================================`);
  });
}

export default app;
