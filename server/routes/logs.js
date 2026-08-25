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

// @route   GET /api/logs/audit
// @desc    Retrieve system audit logs with optional CSV export (Admin only)
router.get('/audit', requireAdmin, async (req, res, next) => {
  const db = getDb();
  const { startDate, endDate, format } = req.query;

  try {
    let query = `
      SELECT a.*, e.name as employee_name, e.department
      FROM audit_logs a
      LEFT JOIN employees e ON a.employee_id = e.id
    `;
    const params = [];
    const conditions = [];

    if (startDate) {
      conditions.push("a.timestamp >= ?");
      params.push(startDate);
    }
    if (endDate) {
      const end = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
      conditions.push("a.timestamp <= ?");
      params.push(end);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY a.timestamp DESC LIMIT 1000";

    const logs = await db.all(query, params);

    // CSV format check
    if (format === 'csv') {
      const escapeCsvValue = (val) => {
        if (val === null || val === undefined) return '';
        let str = String(val);
        // Formula injection mitigation: if value starts with any formula-triggering character, prefix with single quote
        if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
          str = `'${str}`;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const headers = ['ID', 'Timestamp', 'Employee ID', 'Employee Name', 'Department', 'Event Type', 'IP Address', 'Details', 'User Agent', 'Latitude', 'Longitude', 'Accuracy'];
      const csvRows = [headers.join(',')];

      for (const log of logs) {
        let parsedDetails = {};
        try {
          parsedDetails = JSON.parse(log.details);
        } catch (e) {
          parsedDetails = { raw: log.details };
        }

        const userAgentVal = parsedDetails.userAgent || '';
        const userLatVal = parsedDetails.userCoords?.latitude || '';
        const userLngVal = parsedDetails.userCoords?.longitude || '';
        const userAccVal = parsedDetails.userCoords?.accuracy || '';

        const cleanedDetails = { ...parsedDetails };
        delete cleanedDetails.userAgent;
        delete cleanedDetails.userCoords;

        const detailsText = cleanedDetails.reason || cleanedDetails.details || cleanedDetails.raw || JSON.stringify(cleanedDetails);

        csvRows.push([
          escapeCsvValue(log.id),
          escapeCsvValue(log.timestamp),
          escapeCsvValue(log.employee_id),
          escapeCsvValue(log.employee_name),
          escapeCsvValue(log.department),
          escapeCsvValue(log.event_type),
          escapeCsvValue(log.ip_address),
          escapeCsvValue(detailsText),
          escapeCsvValue(userAgentVal),
          escapeCsvValue(userLatVal),
          escapeCsvValue(userLngVal),
          escapeCsvValue(userAccVal)
        ].join(','));
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit_logs.csv');
      return res.send(csvRows.join('\r\n'));
    }

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

export default router;
