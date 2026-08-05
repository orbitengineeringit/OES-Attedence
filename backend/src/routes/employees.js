import express from 'express';
import bcrypt from 'bcryptjs';
import { getDb, initializeDatabase } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { registerFaceData } from '../services/faceRecognitionService.js';
import { processGeofenceUpdate } from '../services/geofenceService.js';

const router = express.Router();

// Helper to reconstruct OES/XXX IDs that contain slashes
const getFullEmpId = (req) => {
  if (req.originalUrl.includes('/OES/')) {
    return `OES/${req.params.id}`;
  }
  return req.params.id;
};

// Apply global Auth check
router.use(requireAuth);

// @route   POST /api/employees/reset-db
// @desc    Wipe all tables and re-seed the SQLite database safely (Admin only)
router.post('/reset-db', requireAdmin, async (req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'test';
  
  if (isProd || !isDevOrTest) {
    return res.status(403).json({ 
      success: false, 
      message: 'Database reset is blocked in non-development/production environments for data safety.' 
    });
  }

  const db = getDb();
  try {
    console.log('[DATABASE RESET REQUESTED]: Purging tables...');
    await db.run('DELETE FROM logs');
    await db.run('DELETE FROM attendance');
    await db.run('DELETE FROM employees');
    await db.run('DELETE FROM settings');
    
    // Call initializeDatabase to re-seed default admin and employee
    await initializeDatabase();
    
    // If Supabase is connected, we might want to wipe it too, but that's destructive.
    // For safety, we'll only wipe SQLite here during hybrid mode unless we add Supabase wiping.
    
    res.json({ success: true, message: 'Database reset successfully and default accounts re-seeded.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/:id/reset-face
// @desc    Clear face data for a single employee (Admin only)
router.post(['/:id/reset-face', '/OES/:id/reset-face'], requireAdmin, async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);
  try {
    const isSupabaseLive = await checkSupabaseConnection();

    // SQLite
    await db.run(`UPDATE employees SET face_data = NULL WHERE id = ?`, [empId]);

    // Supabase
    if (isSupabaseLive) {
      try {
        await supabase.from('employees').update({ face_data: null }).eq('id', empId);
      } catch (err) {
        console.warn('[SUPABASE SYNC WARNING]: Failed to reset face in Supabase:', err.message);
      }
    }

    res.json({ success: true, message: 'Biometric face descriptor removed successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/employees
// @desc    Retrieve all employees (Admin view)
router.get('/', requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let employees = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('employees').select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data');
      if (!error && data) {
        employees = data.map(emp => ({
          ...emp,
          is_face_registered: emp.face_data !== null
        }));
        // Remove face_data from response
        employees.forEach(emp => delete emp.face_data);
      }
    }

    if (employees.length === 0) {
      employees = await db.all(`
        SELECT id, name, email, role, department, avatar, status, latitude, longitude, created_at,
               (face_data IS NOT NULL) AS is_face_registered
        FROM employees
      `);
    }

    res.json({ success: true, employees });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/employees/me
// @desc    Retrieve the authenticated user's own profile
router.get('/me', async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let emp = null;

    if (isSupabaseLive) {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data')
        .eq('id', req.user.id)
        .single();
      if (!error && data) {
        emp = { ...data, is_face_registered: data.face_data !== null };
        delete emp.face_data;
      }
    }

    if (!emp) {
      emp = await db.get(`
        SELECT id, name, email, role, department, avatar, status, latitude, longitude, created_at,
               (face_data IS NOT NULL) AS is_face_registered
        FROM employees WHERE id = ?
      `, [req.user.id]);
    }

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    res.json({ success: true, employee: emp });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/employees/:id
// @desc    Retrieve details for a single employee
router.get(['/:id', '/OES/:id'], async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);
  try {
    // Privacy check: standard employees can only view their own profile
    if (req.user.role !== 'admin' && req.user.id !== empId) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only view your own profile.' });
    }
    const isSupabaseLive = await checkSupabaseConnection();
    let emp = null;

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('employees').select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data').eq('id', req.params.id).single();
      if (!error && data) {
        emp = {
          ...data,
          is_face_registered: data.face_data !== null
        };
        delete emp.face_data;
      }
    }

    if (!emp) {
      emp = await db.get(`
        SELECT id, name, email, role, department, avatar, status, latitude, longitude, created_at,
               (face_data IS NOT NULL) AS is_face_registered
        FROM employees WHERE id = ?
      `, [req.params.id]);
    }

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    res.json({ success: true, employee: emp });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees
// @desc    Add employee (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  const { id, name, email, password, role, department } = req.body;
  const db = getDb();

  try {
    if (!id || !name || !email || !password || !role || !department) {
      return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const isSupabaseLive = await checkSupabaseConnection();

    // Check existing in SQLite
    const existing = await db.get(`SELECT id FROM employees WHERE email = ? OR id = ?`, [email, id]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'ID or Email already in use.' });
    }

    // If Supabase is live, we check there too
    if (isSupabaseLive) {
      const { data: existSupabase } = await supabase.from('employees').select('id').or(`email.eq.${email},id.eq.${id}`);
      if (existSupabase && existSupabase.length > 0) {
        return res.status(409).json({ success: false, message: 'ID or Email already in use in Supabase.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Write SQLite
    await db.run(
      `INSERT INTO employees (id, name, email, password, role, department) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, hashedPassword, role, department]
    );

    // Write Supabase
    if (isSupabaseLive) {
      try {
        await supabase.from('employees').insert({
          id, name, email, password: hashedPassword, role, department
        });
      } catch (err) {
        console.warn('[SUPABASE SYNC WARNING]: Failed to insert employee into Supabase:', err.message);
      }
    }

    res.status(201).json({ success: true, message: 'Employee profile created successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/employees/:id
// @desc    Update employee profile (Admin only)
router.put(['/:id', '/OES/:id'], requireAdmin, async (req, res, next) => {
  const { name, email, role, department, password } = req.body;
  const db = getDb();
  const empId = getFullEmpId(req);

  try {
    const isSupabaseLive = await checkSupabaseConnection();

    const emp = await db.get(`SELECT id FROM employees WHERE id = ?`, [empId]);
    if (!emp && !isSupabaseLive) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    let hashedPassword = undefined;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    // SQLite update
    if (emp) {
      if (hashedPassword) {
        await db.run(
          `UPDATE employees SET name = ?, email = ?, role = ?, department = ?, password = ? WHERE id = ?`,
          [name, email, role, department, hashedPassword, empId]
        );
      } else {
        await db.run(
          `UPDATE employees SET name = ?, email = ?, role = ?, department = ? WHERE id = ?`,
          [name, email, role, department, empId]
        );
      }
    }

    // Supabase update
    if (isSupabaseLive) {
      try {
        const updates = { name, email, role, department };
        if (hashedPassword) updates.password = hashedPassword;
        await supabase.from('employees').update(updates).eq('id', empId);
      } catch (err) {
        console.warn('[SUPABASE SYNC WARNING]: Failed to update employee in Supabase:', err.message);
      }
    }

    res.json({ success: true, message: 'Employee profile updated successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee (Admin only)
router.delete(['/:id', '/OES/:id'], requireAdmin, async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);

  try {
    const isSupabaseLive = await checkSupabaseConnection();

    // SQLite
    await db.run(`DELETE FROM employees WHERE id = ?`, [empId]);

    // Supabase
    if (isSupabaseLive) {
      try {
        await supabase.from('employees').delete().eq('id', empId);
      } catch (err) {
        console.warn('[SUPABASE SYNC WARNING]: Failed to delete employee from Supabase:', err.message);
      }
    }

    res.json({ success: true, message: 'Employee profile deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/:id/face
// @desc    Register face biometrics (employee can enroll own face; admin can enroll any)
router.post(['/:id/face', '/OES/:id/face'], requireAuth, async (req, res, next) => {
  const { faceDescriptor } = req.body;
  const empId = getFullEmpId(req);

  // Authorization: employee can only enroll their own face, admin can enroll anyone
  const isSelf = req.user.id === empId;
  const isAdmin = req.user.role === 'admin';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Access Denied: You can only enroll your own face.'
    });
  }

  try {
    const result = await registerFaceData(empId, faceDescriptor);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/:id/coordinates
// @desc    Update employee live location coordinates and recalculate geofence boundary calculations
router.post(['/:id/coordinates', '/OES/:id/coordinates'], async (req, res, next) => {
  const { latitude, longitude } = req.body;
  const empId = getFullEmpId(req);

  try {
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude coordinates are required.' });
    }

    // processGeofenceUpdate inside geofenceService.js will also need a hybrid update.
    const result = await processGeofenceUpdate(empId, parseFloat(latitude), parseFloat(longitude));
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
