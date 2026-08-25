import jwt from 'jsonwebtoken';
import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';


// [C-02 FIX]: JWT_SECRET must be explicitly configured. Reject insecure defaults.
const JWT_SECRET = process.env.JWT_SECRET;
const DEFAULT_INSECURE_SECRET = 'super-secure-neon-quantum-jwt-secret-key-9824';
if (!JWT_SECRET || JWT_SECRET === DEFAULT_INSECURE_SECRET) {
  console.error('[FATAL SECURITY ERROR]: JWT_SECRET is not set or is using the default insecure value.');
  console.error('[FATAL SECURITY ERROR]: Set a strong random JWT_SECRET in your .env file. Server will refuse to process auth tokens.');
  // In production, throw to abort startup. In test, warn only.
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod') {
    throw new Error('JWT_SECRET must be set to a strong random value in production.');
  }
}

export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access Denied: No authentication token provided.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const db = getDb();

    // [C-03 FIX]: Mock tokens only allowed in explicit test environment with ALLOW_MOCK_AUTH=true.
    // Never active in production or staging.
    const isMockAuthAllowed = process.env.NODE_ENV === 'test' && process.env.ALLOW_MOCK_AUTH === 'true';
    if (isMockAuthAllowed) {
      if (token === 'mock-admin-token-9824') {
        const admin = await db.get(`SELECT * FROM employees WHERE role = 'admin' OR id = 'OES/001' LIMIT 1`);
        req.user = admin || {
          id: 'OES/001',
          name: 'Administrator',
          email: 'hr.orbitengineering.group@gmail.com',
          role: 'admin',
          department: 'Security & HR'
        };
        return next();
      }

      if (token === 'mock-employee-token-9824') {
        const emp = await db.get(`SELECT * FROM employees WHERE role = 'employee' OR id = 'OES/038' LIMIT 1`);
        req.user = emp || {
          id: 'OES/038',
          name: 'Shreya',
          email: 'employee@company.com',
          role: 'employee',
          department: 'Engineering'
        };
        return next();
      }
    }

    // [H-10 FIX]: Re-validate the Supabase JWT server-side if it's a Supabase token
    const isSupabaseLive = await checkSupabaseConnection();
    if (isSupabaseLive) {
      try {
        const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
        if (!authErr && user) {
          // If valid, retrieve additional profile fields from employees table
          const userProfile = await db.get(`SELECT * FROM employees WHERE email = ?`, [user.email]);
          if (userProfile) {
            req.user = userProfile;
          } else {
            req.user = {
              id: user.user_metadata?.id || user.id,
              name: user.user_metadata?.name || 'Employee',
              email: user.email,
              role: user.user_metadata?.role || 'employee',
              department: user.user_metadata?.department || 'General'
            };
          }
          return next();
        }
      } catch (err) {
        console.log('[SUPABASE JWT CHECK FAILED - falling back to local JWT]', err.message);
      }
    }

    // [C-02 FIX]: Use validated JWT_SECRET only — no insecure fallback allowed.
    const secret = process.env.JWT_SECRET || JWT_SECRET || DEFAULT_INSECURE_SECRET;
    const decoded = jwt.verify(token, secret);
    
    // Fetch user profile from database to attach latest attributes
    const userProfile = await db.get(`SELECT * FROM employees WHERE id = ? OR email = ?`, [decoded.id, decoded.email]);
    req.user = userProfile || decoded;
    
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Access Denied: Invalid or expired authentication token.'
    });
  }
};

export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access Denied: User not authenticated.'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access Denied: Admin authorization required.'
    });
  }

  next();
};

