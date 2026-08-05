import express from 'express';
import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Apply global Auth check
router.use(requireAuth);

// @route   GET /api/logs
// @desc    Retrieve all system logs (Admin view)
router.get('/', requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let logs = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase
        .from('logs')
        .select(`
          *,
          employees (name, department)
        `)
        .order('timestamp', { ascending: false })
        .limit(250);

      if (!error && data) {
        logs = data.map(item => ({
          ...item,
          employee_name: item.employees?.name,
          department: item.employees?.department
        }));
        logs.forEach(item => delete item.employees);
      }
    }

    if (logs.length === 0) {
      logs = await db.all(`
        SELECT l.*, e.name as employee_name, e.department
        FROM logs l
        LEFT JOIN employees e ON l.employee_id = e.id
        ORDER BY l.timestamp DESC
        LIMIT 250
      `);
    }

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/logs/clear
// @desc    Wipe all system activity logs (Admin only)
router.post('/clear', requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();

    await db.run('DELETE FROM logs');

    if (isSupabaseLive) {
      await supabase.from('logs').delete().not('id', 'is', null);
    }

    res.json({ success: true, message: 'All activity logs have been wiped successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/logs/my-logs
// @desc    Retrieve logs for current employee
router.get('/my-logs', async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let logs = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .eq('employee_id', req.user.id)
        .order('timestamp', { ascending: false })
        .limit(50);
        
      if (!error && data && data.length > 0) {
        logs = data;
      }
    }

    if (logs.length === 0) {
      logs = await db.all(`
        SELECT * FROM logs
        WHERE employee_id = ?
        ORDER BY timestamp DESC
        LIMIT 50
      `, [req.user.id]);
    }

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

export default router;
