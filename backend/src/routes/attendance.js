import express from 'express';
import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { identifyFace, verifyLiveness, calculateEuclideanDistance } from '../services/faceRecognitionService.js';
import { decryptDescriptor } from '../services/encryption.js';
import { synthesizeVoiceGreeting, triggerAIAnomalyReport } from '../services/aiAgentService.js';
import { calculateDistance } from '../services/geofenceService.js';
import { broadcastEvent } from '../config/socket.js';

const router = express.Router();

// @route   GET /api/attendance
// @desc    Get all attendance logs (Admin)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let logs = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase
        .from('attendance')
        .select(`
          *,
          employees (name, department)
        `)
        .order('date', { ascending: false })
        .order('check_in', { ascending: false });
        
      if (!error && data) {
        logs = data.map(item => ({
          ...item,
          name: item.employees?.name,
          department: item.employees?.department
        }));
        logs.forEach(item => delete item.employees);
      }
    }

    if (logs.length === 0) {
      logs = await db.all(`
        SELECT a.*, e.name, e.department
        FROM attendance a
        JOIN employees e ON a.employee_id = e.id
        ORDER BY a.date DESC, a.check_in DESC
      `);
    }

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/attendance/clear
// @desc    Wipe all attendance records (Admin only)
router.post('/clear', requireAuth, requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();

    await db.run('DELETE FROM attendance');
    await db.run("UPDATE employees SET status = 'Offline'");

    if (isSupabaseLive) {
      // Supabase does not support blanket DELETE without conditions easily via JS client, 
      // but we can delete where id is not null.
      await supabase.from('attendance').delete().not('id', 'is', null);
      await supabase.from('employees').update({ status: 'Offline' }).not('id', 'is', null);
    }

    res.json({ success: true, message: 'All attendance records have been wiped successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/attendance/my-history
// @desc    Get the authenticated user's own attendance records (privacy-safe)
router.get('/my-history', requireAuth, async (req, res, next) => {
  const db = getDb();
  const employeeId = req.user.id;

  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let history = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .order('date', { ascending: false });
      if (!error && data && data.length > 0) {
        history = data;
      }
    }

    if (history.length === 0) {
      history = await db.all(`
        SELECT * FROM attendance
        WHERE employee_id = ?
        ORDER BY date DESC
      `, [employeeId]);
    }

    res.json({ success: true, history });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/attendance/history/:employeeId
// @desc    Get attendance records for a specific employee
router.get(['/history/:employeeId', '/history/OES/:employeeId'], requireAuth, async (req, res, next) => {
  const db = getDb();
  const employeeId = req.originalUrl.includes('/history/OES/') ? `OES/${req.params.employeeId}` : req.params.employeeId;

  try {
    // Basic authorization check: employees can only view their own history unless they are Admin
    if (req.user.role !== 'admin' && req.user.id !== employeeId) {
      return res.status(403).json({ success: false, message: 'Access Denied: Cannot view other profiles.' });
    }

    const isSupabaseLive = await checkSupabaseConnection();
    let history = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('attendance').select('*').eq('employee_id', employeeId).order('date', { ascending: false });
      if (!error && data && data.length > 0) {
        history = data;
      }
    }

    if (history.length === 0) {
      history = await db.all(`
        SELECT * FROM attendance
        WHERE employee_id = ?
        ORDER BY date DESC
      `, [employeeId]);
    }

    res.json({ success: true, history });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/attendance/identities
// @desc    Get all employee identities for biometric dropdown (Authenticated)
router.get('/identities', requireAuth, async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let identities = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('employees').select('id, name, face_data');
      if (!error && data) {
        identities = data.map(emp => ({
          id: emp.id,
          name: emp.name,
          is_face_registered: emp.face_data !== null
        }));
      }
    }

    if (identities.length === 0) {
      identities = await db.all(`
        SELECT id, name, (face_data IS NOT NULL) AS is_face_registered
        FROM employees
      `);
    }

    res.json({ success: true, identities });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/attendance/scan
// @desc    Process camera face scan to record attendance (Enforces authenticated employee face ownership)
router.post('/scan', requireAuth, async (req, res, next) => {
  const { faceDescriptor, faceMetrics, location, userCoords, action } = req.body;
  const db = getDb();

  try {
    if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing biometric descriptor.' });
    }

    if (!req.user.face_data) {
      return res.status(400).json({ success: false, message: 'No enrolled biometrics found for this account. Please enroll your face first.' });
    }

    const dbDescriptor = decryptDescriptor(req.user.face_data);
    if (!dbDescriptor) {
      return res.status(400).json({ success: false, message: 'Enrolled biometrics signature is corrupt.' });
    }

    const distance = calculateEuclideanDistance(faceDescriptor, dbDescriptor);
    const threshold = 0.70;

    const isMatch = distance <= threshold;
    const confidence = distance !== Infinity ? Math.max(0, 1 - distance) : 0;

    const isSupabaseLive = await checkSupabaseConnection();

    // 2. Handle Face Mismatch
    if (!isMatch) {
      // Record unauthorized scan in logs
      await db.run(
        `INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)`,
        [req.user.id, 'UNAUTHORIZED_SCAN', location || 'Front Desk Camera', JSON.stringify({ confidence, error: 'Face biometrics ownership mismatch' })]
      );

      if (isSupabaseLive) {
        await supabase.from('logs').insert({
          employee_id: req.user.id,
          event_type: 'UNAUTHORIZED_SCAN',
          location: location || 'Front Desk Camera',
          details: JSON.stringify({ confidence, error: 'Face biometrics ownership mismatch' })
        });
      }

      // Broadcast alert to admin panel
      broadcastEvent('unauthorized:alert', {
        timestamp: new Date().toISOString(),
        location: location || 'Front Desk Camera',
        confidence
      });

      const voiceMessage = `Access denied. Biometrics mismatch. Captured face does not belong to logged in account for ${req.user.name}.`;
      return res.status(401).json({
        success: false,
        message: `Face Mismatch: Captured face does not belong to employee account ${req.user.name}.`,
        voiceMessage
      });
    }

    // 3. Handle Identified Employee: Liveness verification (Anti-spoof)
    const employeeId = req.user.id;
    const name = req.user.name;
    const department = req.user.department;
    const liveness = verifyLiveness(faceMetrics || { spoofIndex: 0.1 });
    
    if (!liveness.passed) {
      // Record security anomaly
      await triggerAIAnomalyReport('SPOOF_ATTEMPT', {
        employeeId,
        spoofIndex: faceMetrics?.spoofIndex || 0.9,
        location: location || 'Front Desk Camera'
      });

      const voiceMessage = synthesizeVoiceGreeting(name, { eventType: 'UNAUTHORIZED_SCAN' });
      return res.status(403).json({
        success: false,
        message: 'Biometric Scanner Blocked: Anti-Spoof Check Flagged.',
        voiceMessage
      });
    }

    // 3b. Geofencing & Strict Location Validation
    const userLat = parseFloat(userCoords?.latitude);
    const userLng = parseFloat(userCoords?.longitude);

    if (!userCoords || isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
      await db.run(
        `INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)`,
        [employeeId, 'GPS_ERROR', location || 'Front Desk Camera', 'Attendance rejected: Missing or invalid GPS telemetry.']
      );
      if (isSupabaseLive) {
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'GPS_ERROR',
          location: location || 'Front Desk Camera',
          details: 'Attendance rejected: Missing or invalid GPS telemetry.'
        });
      }

      return res.status(403).json({
        success: false,
        message: 'Location access is required for attendance validation. Missing GPS coordinates.'
      });
    }

    const { processGeofenceUpdate } = await import('../services/geofenceService.js');
    const geoStatus = await processGeofenceUpdate(employeeId, userLat, userLng, req.body.timezone);

    if (!geoStatus.isInside) {
      let breachDetails = geoStatus.polygonBased 
        ? `Geofence breach: employee outside mapped office polygon boundary.`
        : `Geofence breach: employee outside by ${Math.round(geoStatus.distance - geoStatus.radius)}m (Distance: ${Math.round(geoStatus.distance)}m).`;

      if (geoStatus.reason === 'velocity_breach' || geoStatus.reason === 'timezone_mismatch') {
        breachDetails = geoStatus.message;
      }

      // Record geofence breach in logs
      await db.run(
        `INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)`,
        [employeeId, 'GEOFENCE_VIOLATION', location || 'Front Desk Camera', breachDetails]
      );
      if (isSupabaseLive) {
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'GEOFENCE_VIOLATION',
          location: location || 'Front Desk Camera',
          details: breachDetails
        });
      }

      // Broadcast update to tracking systems about employee coordinates status
      broadcastEvent('employee:status', {
        id: employeeId,
        name,
        status: 'Outside Office Limit',
        latitude: userLat,
        longitude: userLng
      });

      return res.status(403).json({
        success: false,
        message: geoStatus.message || 'You are outside office premises.',
        details: {
          polygonBased: geoStatus.polygonBased,
          distance: geoStatus.distance,
          allowedRadius: geoStatus.radius
        }
      });
    }

    // 4. Update Database Attendance Ledger
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Check if employee has a record for today
    // Try Supabase first
    let attendanceRecord = null;
    if (isSupabaseLive) {
      const { data } = await supabase.from('attendance').select('*').eq('employee_id', employeeId).eq('date', today).single();
      attendanceRecord = data;
    }
    
    if (!attendanceRecord) {
      attendanceRecord = await db.get(
        `SELECT * FROM attendance WHERE employee_id = ? AND date = ?`,
        [employeeId, today]
      );
    }

    // Explicit Action Validation Safeguards
    if (action === 'CHECK_IN') {
      if (attendanceRecord) {
        return res.status(400).json({
          success: false,
          message: 'You have already checked in for today.'
        });
      }
    } else if (action === 'CHECK_OUT') {
      if (!attendanceRecord) {
        return res.status(400).json({
          success: false,
          message: 'You must check in first before checking out.'
        });
      }
      if (attendanceRecord.check_out) {
        return res.status(400).json({
          success: false,
          message: 'You have already checked out for today.'
        });
      }
    }

    let eventType = 'CHECK_IN';
    let responseMessage = '';
    let lateMinutes = 0;
    let logDetails = {};

    const formatLateDuration = (minutes) => {
      if (minutes <= 0) return 'On Time';
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      if (hrs > 0) {
        return `${hrs} hr${hrs > 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
      }
      return `${mins} min${mins !== 1 ? 's' : ''}`;
    };

    if (!attendanceRecord) {
      // Mark Check-In
      const checkInHour = new Date().getHours();
      const checkInMinute = new Date().getMinutes();
      const isLate = checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0);
      const status = isLate ? 'Late Arrival' : 'On Time';
      
      if (isLate) {
        lateMinutes = (checkInHour - 10) * 60 + checkInMinute;
      }

      await db.run(
        `INSERT INTO attendance (employee_id, date, check_in, status) VALUES (?, ?, ?, ?)`,
        [employeeId, today, now, status]
      );

      if (isSupabaseLive) {
        await supabase.from('attendance').insert({
          employee_id: employeeId,
          date: today,
          check_in: now,
          status: status
        });
      }

      const durationStr = formatLateDuration(lateMinutes);
      logDetails = {
        coordinates: { latitude: userLat, longitude: userLng },
        face_confidence: confidence,
        attendance_type: 'CHECK_IN',
        geofence_status: 'INSIDE',
        status_text: isLate ? `Late Arrival by ${durationStr}` : 'On Time'
      };

      // Record log entry with full rich telemetry
      await db.run(
        `INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)`,
        [employeeId, 'CHECK_IN', location || 'Front Desk Camera', JSON.stringify(logDetails)]
      );
      await db.run(`UPDATE employees SET status = 'Inside Office' WHERE id = ?`, [employeeId]);

      if (isSupabaseLive) {
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_IN',
          location: location || 'Front Desk Camera',
          details: JSON.stringify(logDetails)
        });
        await supabase.from('employees').update({ status: 'Inside Office' }).eq('id', employeeId);
      }

      responseMessage = isLate ? `Successfully Checked-In. Status: Late Arrival by ${durationStr}.` : 'Successfully Checked-In. Status: On Time.';
    } else {
      // Mark Check-Out (if already checked in)
      if (attendanceRecord.check_out) {
        return res.status(422).json({
          success: false,
          message: 'Attendance processing completed: Checked-in and Checked-out indices are both satisfied for today.'
        });
      }

      eventType = 'CHECK_OUT';
      
      // Calculate working hours
      const checkInTime = new Date(attendanceRecord.check_in);
      const checkOutTime = new Date(now);
      const diffMs = checkOutTime - checkInTime;
      const hours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
      const overtime = hours > 8 ? parseFloat((hours - 8).toFixed(2)) : 0;
      
      // Basic checkout status evaluation
      const status = hours < 6 ? 'Early Exit' : attendanceRecord.status;

      await db.run(
        `UPDATE attendance SET check_out = ?, working_hours = ?, overtime = ?, status = ? WHERE id = ?`,
        [now, hours, overtime, status, attendanceRecord.id]
      );

      if (isSupabaseLive) {
        // Find the matching attendance ID for Supabase based on employeeId and date
        await supabase.from('attendance').update({
          check_out: now,
          working_hours: hours,
          overtime: overtime,
          status: status
        }).eq('employee_id', employeeId).eq('date', today).is('check_out', null);
      }

      logDetails = {
        coordinates: { latitude: userLat, longitude: userLng },
        face_confidence: confidence,
        attendance_type: 'CHECK_OUT',
        geofence_status: 'INSIDE',
        status_text: `Shift logged: ${hours}h`
      };

      // Record log entry with full rich telemetry
      await db.run(
        `INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)`,
        [employeeId, 'CHECK_OUT', location || 'Front Desk Camera', JSON.stringify(logDetails)]
      );
      await db.run(`UPDATE employees SET status = 'Offline' WHERE id = ?`, [employeeId]);

      if (isSupabaseLive) {
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_OUT',
          location: location || 'Front Desk Camera',
          details: JSON.stringify(logDetails)
        });
        await supabase.from('employees').update({ status: 'Offline' }).eq('id', employeeId);
      }

      responseMessage = `Successfully Checked-Out. Working hours logged: ${hours}h.`;
    }

    const durationStr = formatLateDuration(lateMinutes);

    // 5. Generate voice greetings and broadcast real-time update
    const voiceMessage = synthesizeVoiceGreeting(name, {
      eventType,
      timeString,
      lateMinutes,
      lateDuration: durationStr
    });

    // Broadcast update to tracking systems (send parsed logDetails in details)
    broadcastEvent('logs:new', {
      employee_id: employeeId,
      name,
      event_type: eventType,
      timestamp: now,
      location: location || 'Front Desk Camera',
      details: logDetails
    });

    broadcastEvent('employee:status', {
      id: employeeId,
      name,
      status: eventType === 'CHECK_IN' ? 'Inside Office' : 'Offline'
    });

    res.json({
      success: true,
      message: responseMessage,
      employee: { id: employeeId, name, department },
      eventType,
      voiceMessage,
      lateDuration: durationStr,
      isLate: lateMinutes > 0,
      confidence: confidence
    });
  } catch (error) {
    next(error);
  }
});

export default router;
