import { getDb } from '../database/db.js';

/**
 * Audit Logger Service
 * Records system actions, logins, biometric scans, geofence breaches, employee edits, and deletions
 */
export async function logAuditEvent(employeeId, eventType, details = {}, ipAddress = '127.0.0.1') {
  try {
    const db = getDb();
    const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);

    await db.run(`
      INSERT INTO audit_logs (employee_id, event_type, details, ip_address)
      VALUES (?, ?, ?, ?)
    `, [employeeId || null, eventType, detailsStr, ipAddress]);

    // [L-03 FIX]: Log only the event type and employee ID to stdout, NOT the full details payload.
    // Details may contain GPS coordinates, names, or other PII captured by log aggregators.
    console.log(`[AUDIT LOG]: [${eventType}] Employee: ${employeeId || 'SYSTEM'} | IP: ${ipAddress}`);
  } catch (err) {
    console.error(`[AUDIT LOG ERROR]: Failed to insert audit log`, err);
  }
}
