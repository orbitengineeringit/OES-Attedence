import jwt from 'jsonwebtoken';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { getDb } from '../database/db.js';

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
    const isSupabaseLive = await checkSupabaseConnection();

    // 1. Try Supabase Auth verification first
    if (isSupabaseLive) {
      const { data, error } = await supabase.auth.getUser(token);
      
      if (!error && data?.user) {
        // Supabase token verified successfully
        // Extract metadata which contains our custom payload (name, role, department)
        req.user = {
          id: data.user.id, // wait, auth.user.id is UUID. Our employee id is custom text! 
          // But our login creates user_metadata, which we can rely on, or we can just fetch from employees table.
          // Wait, we need to map to public.employees
        };
        
        // Since Supabase Auth user.id is UUID but our legacy employee ID is string (e.g. "EMP001")
        // we should query the employees table to get the full profile based on email.
        const { data: emp } = await supabase.from('employees').select('*').eq('email', data.user.email).single();
        if (emp) {
          req.user = emp;
          return next();
        } else {
          // Fallback to SQLite if missing in public.employees (due to lazy migration only creating Auth identity)
          const db = getDb();
          const localUser = await db.get(`SELECT * FROM employees WHERE email = ?`, [data.user.email]);
          if (localUser) {
            req.user = localUser;
            return next();
          }
        }
      }
    }

    // 2. Fallback to Legacy JWT verification
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super-secure-neon-quantum-jwt-secret-key-9824');
    req.user = decoded;
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
