import express from 'express';
import { getDb } from '../database/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// @route   GET /api/audit
// @desc    Retrieve system audit logs (Admin only)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const logs = await db.all(`
      SELECT a.*, e.name AS employee_name, e.department
      FROM audit_logs a
      LEFT JOIN employees e ON a.employee_id = e.id
      ORDER BY a.timestamp DESC
      LIMIT 500
    `);

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

export default router;
