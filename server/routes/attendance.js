import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { getDb } from '../database/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { verifyLiveness } from '../services/faceRecognitionService.js';
import { synthesizeVoiceGreeting, triggerAIAnomalyReport } from '../services/aiAgentService.js';
import { processGeofenceUpdate, calculateDistance } from '../services/geofenceService.js';
import { broadcastEvent } from '../config/socket.js';
import { descriptorCache } from '../services/descriptorCache.js';
import { saveAttendancePhoto } from '../services/photoStorage.js';
import { logAuditEvent } from '../services/auditLogger.js';

import { challengeStore } from '../services/challengeStore.js';
import { checkRateLimit } from '../services/rateLimiter.js';

const router = express.Router();

// @route   GET /api/attendance/challenge
// @desc    Generate a random active liveness challenge and store a secure server-side session nonce
router.get('/challenge', async (req, res) => {
  const sessionId = crypto.randomUUID();
  const challenges = ['blink', 'turn_left', 'turn_right'];
  const challengeType = challenges[Math.floor(Math.random() * challenges.length)];
  
  await challengeStore.set(sessionId, challengeType);

  res.json({ challengeSessionId: sessionId, challengeType });
});

const personalScanLimiter = async (req, res, next) => {
  let key = req.ip;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.split(' ')[1];
  }
  
  try {
    const limit = await checkRateLimit(`limit:personal:${key}`, 10, 60000);
    if (!limit.passed) {
      return res.status(429).json({
        success: false,
        reason: 'RATE_LIMITED',
        message: 'Too many scan attempts. Please wait before trying again.'
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

const kioskScanLimiter = async (req, res, next) => {
  let key = req.ip;
  const id = req.body?.deviceId || req.body?.device_id;
  if (id) {
    key = String(id);
  }
  
  try {
    const limit = await checkRateLimit(`limit:kiosk:${key}`, 100, 60000);
    if (!limit.passed) {
      return res.status(429).json({
        success: false,
        reason: 'RATE_LIMITED',
        message: 'Too many scan attempts from this kiosk. Please wait.'
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

// @route   GET /api/attendance
// @desc    Get all attendance logs (Admin)
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  const db = getDb();
  try {
    const logs = await db.all(`
      SELECT a.*, e.name, e.department, e.profile_image, e.avatar
      FROM attendance a
      JOIN employees e ON a.employee_id = e.id
      ORDER BY a.date DESC, a.check_in DESC
    `);

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
    await db.run('DELETE FROM attendance');
    await db.run("UPDATE employees SET status = 'Offline'");

    await logAuditEvent(req.user.id, 'ATTENDANCE_CLEARED', { message: 'All attendance records wiped by admin' }, req.ip);

    res.json({ success: true, message: 'All attendance records have been wiped successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/attendance/my-history
// @desc    Get the authenticated user's own attendance records
router.get('/my-history', requireAuth, async (req, res, next) => {
  const db = getDb();
  const employeeId = req.user.id;

  try {
    const history = await db.all(`
      SELECT * FROM attendance
      WHERE employee_id = ?
      ORDER BY date DESC
    `, [employeeId]);

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
    if (req.user.role !== 'admin' && req.user.id !== employeeId) {
      return res.status(403).json({ success: false, message: 'Access Denied: Cannot view other profiles.' });
    }

    const history = await db.all(`
      SELECT * FROM attendance
      WHERE employee_id = ?
      ORDER BY date DESC
    `, [employeeId]);

    res.json({ success: true, history });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/attendance/identities
// @desc    Get all employee identities for biometric dropdown
router.get('/identities', requireAuth, async (req, res, next) => {
  const db = getDb();
  try {
    const identities = await db.all(`
      SELECT e.id, e.name, 
             (e.face_data IS NOT NULL OR f.descriptor_json IS NOT NULL) AS is_face_registered
      FROM employees e
      LEFT JOIN face_descriptors f ON e.id = f.employee_id
    `);

    res.json({ success: true, identities });
  } catch (error) {
    next(error);
  }
});
// @route   POST /api/attendance/scan
// @desc    Process authenticated face scan on personal device
router.post('/scan', personalScanLimiter, requireAuth, async (req, res, next) => {
  const { faceDescriptor, faceMetrics, userCoords, capturedImage } = req.body;
  const db = getDb();
  const employeeId = req.user.id;
  const name = req.user.name;

  try {
    // [H-04 FIX]: Replay protection — reject requests with stale or future timestamps.
    const clientTimestamp = req.body.clientTimestamp;
    if (clientTimestamp) {
      const clientTime = new Date(clientTimestamp).getTime();
      const serverTime = Date.now();
      const diffMs = serverTime - clientTime;
      if (diffMs > 120000 || diffMs < -30000) { // >2 min old or >30s in future
        await logAuditEvent(employeeId, 'REPLAY_ATTEMPT', { 
          location: 'Personal Device',
          clientTimestamp,
          serverTime: new Date().toISOString(),
          diffMs
        }, req.ip);
        return res.status(400).json({
          success: false,
          reason: 'STALE_REQUEST',
          message: 'Request timestamp is stale or invalid. Please retry.',
          voiceMessage: 'Request expired. Please scan again.'
        });
      }
    }

    // [Priority 2]: Temporal active challenge binding validation via server-side session nonce
    const challengeSessionId = req.body.challengeSessionId;
    if (!challengeSessionId) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', {
        location: 'Personal Device',
        reason: 'Missing challenge session ID',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Missing challenge session ID.',
        voiceMessage: 'Liveness verification failed.'
      });
    }
    const session = await challengeStore.get(challengeSessionId);
    if (!session) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', {
        location: 'Personal Device',
        reason: 'Invalid or expired challenge session',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Invalid or expired challenge session.',
        voiceMessage: 'Liveness verification failed.'
      });
    }
    // One-time use: immediately invalidate session to prevent replay
    await challengeStore.delete(challengeSessionId);
    
    const durationMs = Date.now() - session.createdAt;
    if (durationMs > 15000) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', { 
        location: 'Personal Device',
        reason: `Liveness challenge expired (duration: ${(durationMs / 1000).toFixed(1)}s, limit: 15s)` 
      }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Challenge session expired. Please perform the action within 15 seconds.',
        voiceMessage: 'Liveness check expired. Please try again.'
      });
    }
    const activeChallenge = faceMetrics?.challengeType;
    if (activeChallenge !== session.challengeType) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', {
        location: 'Personal Device',
        reason: `Active challenge type mismatch (expected ${session.challengeType}, performed ${activeChallenge || 'none'})`,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: `Liveness Detection: Failed - Active challenge type mismatch (expected ${session.challengeType}, performed ${activeChallenge}).`,
        voiceMessage: 'Liveness verification failed.'
      });
    }

    // 1. GPS Availability Check
    const userLat = parseFloat(userCoords?.latitude);
    const userLng = parseFloat(userCoords?.longitude);

    if (!userCoords || isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
      await logAuditEvent(employeeId, 'GPS_UNAVAILABLE', {
        location: 'Personal Device',
        reason: 'Missing or invalid GPS telemetry',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'GPS_UNAVAILABLE',
        message: 'GPS Available: Failed - Missing or invalid GPS telemetry. Please enable location permissions.',
        voiceMessage: 'GPS location access is required.'
      });
    }

    // 2. Geofence & Office Radius Validation
    const accuracy = userCoords?.accuracy ? parseFloat(userCoords.accuracy) : null;
    const geoStatus = await processGeofenceUpdate(employeeId, userLat, userLng, req.body.timezone, accuracy, req.ip);
    if (!geoStatus.isInside) {
      const breachMsg = geoStatus.message || 'Geofence Valid: Failed - You are outside office premises.';
      await logAuditEvent(employeeId, geoStatus.reason === 'static_gps_detected' ? 'STATIC_GPS_DETECTED' : (geoStatus.reason === 'office_ip_mismatch' ? 'OFFICE_IP_MISMATCH' : 'GEOFENCE_VIOLATION'), { location: 'Personal Device', details: breachMsg }, req.ip);

      return res.status(403).json({
        success: false,
        reason: geoStatus.reason || 'GEOFENCE_INVALID',
        message: breachMsg,
        voiceMessage: geoStatus.reason === 'static_gps_detected' 
          ? 'GPS anomaly detected. Please move slightly.' 
          : (geoStatus.reason === 'office_ip_mismatch' ? 'Network verification failed.' : 'Access denied. You are outside office premises.')
      });
    }

    // 3. Anti-Spoof Liveness Verification
    const blinkDetected = faceMetrics?.blinkDetected;
    if (!blinkDetected) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', { location: 'Personal Device', reason: 'Blink not detected by EAR detector' }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - No blink detected. Please blink naturally during scan.',
        voiceMessage: 'Liveness check failed. Please blink during the scan.'
      });
    }

    const liveness = verifyLiveness(faceMetrics || {});
    if (!liveness.passed) {
      await logAuditEvent(employeeId, 'LIVENESS_FAILED', { location: 'Personal Device' }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Anti-spoof check flagged.',
        voiceMessage: 'Liveness check failed.'
      });
    }

    // 4. Biometric Face Match Ownership Verification
    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
      await logAuditEvent(employeeId, 'INVALID_DESCRIPTOR', {
        location: 'Personal Device',
        reason: 'Invalid biometric face descriptor',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'INVALID_DESCRIPTOR',
        message: 'Invalid biometric face descriptor.',
        voiceMessage: 'Invalid face scan.'
      });
    }

    // Fetch this specific employee's enrolled face descriptor from DB
    const empDetails = await db.get(`
      SELECT e.id, e.name, e.department, e.avatar, e.profile_image, e.face_data, f.descriptor_json
      FROM employees e
      LEFT JOIN face_descriptors f ON e.id = f.employee_id
      WHERE e.id = ?
    `, [employeeId]);

    if (!empDetails) {
      await logAuditEvent(employeeId, 'PROFILE_NOT_FOUND', {
        location: 'Personal Device',
        reason: 'Employee profile not found',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(404).json({
        success: false,
        message: 'Employee profile not found.'
      });
    }

    let enrolledDescriptor = null;
    if (empDetails.descriptor_json) {
      try {
        enrolledDescriptor = JSON.parse(empDetails.descriptor_json);
      } catch (e) {}
    }

    if (!enrolledDescriptor && empDetails.face_data) {
      try {
        const { decryptDescriptor } = await import('../services/encryption.js');
        enrolledDescriptor = decryptDescriptor(empDetails.face_data);
      } catch (e) {}
    }

    if (!enrolledDescriptor) {
      await logAuditEvent(employeeId, 'NO_ENROLLED_TEMPLATE', {
        location: 'Personal Device',
        reason: 'No enrolled face template found',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        message: 'No enrolled face template found. Please register your face first.'
      });
    }

    // Compare face descriptor
    const { calculateEuclideanDistance } = await import('../services/faceRecognitionService.js');
    const distance = calculateEuclideanDistance(faceDescriptor, enrolledDescriptor);
    const threshold = 0.70; // Configured matching threshold for personal device scans
    const isMatch = distance <= threshold;

    if (!isMatch) {
      await logAuditEvent(employeeId, 'UNAUTHORIZED_SCAN', { location: 'Personal Device', reason: 'Biometrics mismatch against own face template' }, req.ip);
      return res.status(401).json({
        success: false,
        reason: 'FACE_NOT_RECOGNIZED',
        message: 'Face Mismatch: Scanned face does not match your enrolled biometrics.',
        voiceMessage: 'Face mismatch. Access denied.'
      });
    }

    const confidenceScore = Math.max(0, Math.min(100, Math.round((1 - (distance / threshold)) * 100)));

    // Retrieve last location to run velocity breach checks
    try {
      const prevEmp = await db.get(
        'SELECT last_latitude, last_longitude, last_location_time FROM employees WHERE id = ?',
        [employeeId]
      );
      if (prevEmp && prevEmp.last_latitude && prevEmp.last_longitude && prevEmp.last_location_time) {
        const lastTime = new Date(prevEmp.last_location_time).getTime();
        const nowTime = Date.now();
        const timeDelta = (nowTime - lastTime) / 1000; // in seconds
        
        if (timeDelta > 0 && timeDelta < 7200) { // 2-hour window
          const dist = calculateDistance(userLat, userLng, prevEmp.last_latitude, prevEmp.last_longitude);
          const speedKmh = (dist / timeDelta) * 3.6;
          
          if (speedKmh > 150) {
            const breachMsg = `Impossible travel speed: ${speedKmh.toFixed(1)} km/h. Distance: ${dist.toFixed(0)}m in ${timeDelta.toFixed(0)}s.`;
            console.warn(`[VELOCITY BREACH] Employee ${employeeId} travelled at impossible speed: ${speedKmh.toFixed(2)} km/h`);
            await logAuditEvent(employeeId, 'VELOCITY_BREACH', { location: 'Personal Device', details: breachMsg }, req.ip);
            return res.status(403).json({
              success: false,
              reason: 'VELOCITY_BREACH',
              message: 'Biometric Scanner Blocked: Impossible location travel velocity detected.',
              voiceMessage: 'Access denied. Travel velocity anomaly detected.'
            });
          }
        }
      }
    } catch (err) {
      console.error('[VELOCITY CHECK ERROR IN SCAN]:', err);
    }

    const department = empDetails.department || 'General';
    const avatar = empDetails.profile_image || empDetails.avatar || null;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // IST date
    const now = new Date().toISOString();
    const timeString = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
    const timeShort = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dateString = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Kolkata' });

    // Save Attendance Evidence Photo
    let savedEvidencePath = null;
    if (capturedImage) {
      savedEvidencePath = await saveAttendancePhoto(employeeId, capturedImage, today, timeShort);
    }

    const attendanceRecord = await db.get(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ?`,
      [employeeId, today]
    );

    let eventType = 'CHECK_IN';
    let statusText = 'Attendance Marked Successfully';

    if (!attendanceRecord) {
      // Check-In
      const checkInHour = new Date().getHours();
      const checkInMinute = new Date().getMinutes();
      const isLate = checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0);
      const status = isLate ? 'Late Arrival' : 'On Time';

      await db.run(
        `INSERT INTO attendance (employee_id, date, check_in, status, latitude, longitude, confidence_score, captured_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, today, now, status, userLat, userLng, confidenceScore, savedEvidencePath]
      );

      await db.run(`UPDATE employees SET status = 'Inside Office' WHERE id = ?`, [employeeId]);

      eventType = 'CHECK_IN';
      statusText = `Welcome ${name}! Attendance Marked Successfully.`;

      await logAuditEvent(employeeId, 'CHECK_IN', {
        location: 'Personal Device',
        confidenceScore,
        evidencePath: savedEvidencePath,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
    } else if (!attendanceRecord.check_out) {
      // Check-Out
      eventType = 'CHECK_OUT';
      const checkInTime = new Date(attendanceRecord.check_in);
      const checkOutTime = new Date(now);
      const diffMs = checkOutTime - checkInTime;
      const hours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
      const overtime = hours > 8 ? parseFloat((hours - 8).toFixed(2)) : 0;
      const status = hours < 6 ? 'Early Exit' : attendanceRecord.status;

      await db.run(
        `UPDATE attendance SET check_out = ?, working_hours = ?, overtime = ?, status = ?, captured_image = COALESCE(captured_image, ?) WHERE id = ?`,
        [now, hours, overtime, status, savedEvidencePath, attendanceRecord.id]
      );

      await db.run(`UPDATE employees SET status = 'Offline' WHERE id = ?`, [employeeId]);

      statusText = `Goodbye ${name}! Check-out Marked Successfully (${hours}h).`;

      await logAuditEvent(employeeId, 'CHECK_OUT', {
        location: 'Personal Device',
        hoursLogged: hours,
        evidencePath: savedEvidencePath,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
    } else {
      return res.json({
        success: true,
        alreadyCompleted: true,
        employee: { id: employeeId, name, department, avatar },
        date: dateString,
        time: timeString,
        status: 'Attendance Already Marked Today',
        message: `Attendance for ${name} is already marked for today.`
      });
    }

    // Broadcast Socket.IO events for real-time dashboard updates
    broadcastEvent('logs:new', {
      employee_id: employeeId,
      name,
      event_type: eventType,
      timestamp: now,
      location: 'Personal Device',
      details: { coordinates: { latitude: userLat, longitude: userLng }, face_confidence: confidenceScore, evidence: savedEvidencePath }
    });

    broadcastEvent('employee:status', {
      id: employeeId,
      name,
      status: eventType === 'CHECK_IN' ? 'Inside Office' : 'Offline'
    });

    res.json({
      success: true,
      employee: { id: employeeId, name, department, avatar },
      date: dateString,
      time: timeString,
      status: 'Attendance Marked Successfully',
      eventType,
      message: statusText,
      confidenceScore,
      evidencePath: savedEvidencePath,
      voiceMessage: `${name}, attendance marked successfully.`
    });

  } catch (error) {
    next(error);
  }
});

// @route   POST /api/attendance/public-scan
// @desc    Process unauthenticated face scan for single employee attendance link (/attendance)
router.post('/public-scan', kioskScanLimiter, async (req, res, next) => {
  const { faceDescriptor, faceMetrics, userCoords, capturedImage } = req.body;
  const db = getDb();

  try {
    // [H-04 FIX]: Replay protection — reject requests with stale or future timestamps.
    const clientTimestamp = req.body.clientTimestamp;
    if (clientTimestamp) {
      const clientTime = new Date(clientTimestamp).getTime();
      const serverTime = Date.now();
      const diffMs = serverTime - clientTime;
      if (diffMs > 120000 || diffMs < -30000) { // >2 min old or >30s in future
        await logAuditEvent(null, 'REPLAY_ATTEMPT', { 
          location: 'Public Kiosk',
          clientTimestamp,
          serverTime: new Date().toISOString(),
          diffMs
        }, req.ip);
        return res.status(400).json({
          success: false,
          reason: 'STALE_REQUEST',
          message: 'Request timestamp is stale or invalid. Please retry.',
          voiceMessage: 'Request expired. Please scan again.'
        });
      }
    }

    // [Priority 2]: Temporal active challenge binding validation via server-side session nonce
    const challengeSessionId = req.body.challengeSessionId;
    if (!challengeSessionId) {
      await logAuditEvent('unrecognized', 'LIVENESS_FAILED', {
        location: 'Public Kiosk',
        reason: 'Missing challenge session ID',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Missing challenge session ID.',
        voiceMessage: 'Liveness verification failed.'
      });
    }
    const session = await challengeStore.get(challengeSessionId);
    if (!session) {
      await logAuditEvent('unrecognized', 'LIVENESS_FAILED', {
        location: 'Public Kiosk',
        reason: 'Invalid or expired challenge session',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Invalid or expired challenge session.',
        voiceMessage: 'Liveness verification failed.'
      });
    }
    // One-time use: immediately invalidate session to prevent replay
    await challengeStore.delete(challengeSessionId);
    
    const durationMs = Date.now() - session.createdAt;
    if (durationMs > 15000) {
      await logAuditEvent(null, 'LIVENESS_FAILED', { 
        location: 'Public Kiosk',
        reason: `Liveness challenge expired (duration: ${(durationMs / 1000).toFixed(1)}s, limit: 15s)` 
      }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Challenge session expired. Please perform the action within 15 seconds.',
        voiceMessage: 'Liveness check expired. Please try again.'
      });
    }
    const activeChallenge = faceMetrics?.challengeType;
    if (activeChallenge !== session.challengeType) {
      await logAuditEvent('unrecognized', 'LIVENESS_FAILED', {
        location: 'Public Kiosk',
        reason: `Active challenge type mismatch (expected ${session.challengeType}, performed ${activeChallenge || 'none'})`,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: `Liveness Detection: Failed - Active challenge type mismatch (expected ${session.challengeType}, performed ${activeChallenge}).`,
        voiceMessage: 'Liveness verification failed.'
      });
    }

    // 1. GPS Availability Check
    const userLat = parseFloat(userCoords?.latitude);
    const userLng = parseFloat(userCoords?.longitude);

    if (!userCoords || isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
      await logAuditEvent('unrecognized', 'GPS_UNAVAILABLE', {
        location: 'Public Kiosk',
        reason: 'Missing or invalid GPS telemetry',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'GPS_UNAVAILABLE',
        message: 'GPS Available: Failed - Missing or invalid GPS telemetry. Please enable location permissions.',
        voiceMessage: 'GPS location access is required.'
      });
    }


    // 2. Geofence & Office Radius Validation
    const accuracy = userCoords?.accuracy ? parseFloat(userCoords.accuracy) : null;
    const geoStatus = await processGeofenceUpdate(null, userLat, userLng, req.body.timezone, accuracy, req.ip);
    if (!geoStatus.isInside) {
      const breachMsg = geoStatus.message || 'Geofence Valid: Failed - You are outside office premises.';
      await logAuditEvent(null, geoStatus.reason === 'static_gps_detected' ? 'STATIC_GPS_DETECTED' : (geoStatus.reason === 'office_ip_mismatch' ? 'OFFICE_IP_MISMATCH' : 'GEOFENCE_VIOLATION'), { location: 'Public Kiosk', details: breachMsg }, req.ip);

      return res.status(403).json({
        success: false,
        reason: geoStatus.reason || 'GEOFENCE_INVALID',
        message: breachMsg,
        voiceMessage: geoStatus.reason === 'static_gps_detected' 
          ? 'GPS anomaly detected. Please move slightly.' 
          : (geoStatus.reason === 'office_ip_mismatch' ? 'Network verification failed.' : 'Access denied. You are outside office premises.')
      });
    }

    // 3. Anti-Spoof Liveness Verification
    // [C-01 + H-01 SERVER FIX]: Server-side blink check for public scan.
    // The client sends blinkDetected from the genuine EAR-based blink detector.
    // We enforce it here — no hardcoded spoofIndex accepted from client.
    const blinkDetected = faceMetrics?.blinkDetected;
    if (!blinkDetected) {
      await logAuditEvent(null, 'LIVENESS_FAILED', { location: 'Public Kiosk', reason: 'Blink not detected by EAR detector' }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - No blink detected. Please blink naturally during scan.',
        voiceMessage: 'Liveness check failed. Please blink during the scan.'
      });
    }

    // Legacy spoofIndex check (if populated by a future server-generated value)
    const liveness = verifyLiveness(faceMetrics || {});
    if (!liveness.passed) {
      await logAuditEvent(null, 'LIVENESS_FAILED', { location: 'Public Kiosk' }, req.ip);
      return res.status(403).json({
        success: false,
        reason: 'LIVENESS_FAILED',
        message: 'Liveness Detection: Failed - Anti-spoof check flagged.',
        voiceMessage: 'Liveness check failed.'
      });
    }

    // 4. Eye Blink & Liveness Detection Verified
    // (Blink detection is handled dynamically on client stream and auto-passed upon liveness verification)

    // 5. In-Memory Descriptor Matching (< 3ms latency for 10,000+ employees)
    if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
      await logAuditEvent('unrecognized', 'INVALID_DESCRIPTOR', {
        location: 'Public Kiosk',
        reason: 'Invalid biometric face descriptor',
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
      return res.status(400).json({
        success: false,
        reason: 'INVALID_DESCRIPTOR',
        message: 'Invalid biometric face descriptor.',
        voiceMessage: 'Invalid face scan.'
      });
    }

    const matchResult = await descriptorCache.match(db, faceDescriptor, 0.68);
    if (!matchResult.success) {
      await logAuditEvent(null, 'UNAUTHORIZED_SCAN', { location: 'Public Kiosk', reason: matchResult.reason }, req.ip);
      return res.status(401).json({
        success: false,
        reason: 'FACE_NOT_RECOGNIZED',
        message: 'Face Not Recognized. Please Contact Administrator.',
        voiceMessage: 'Face Not Recognized. Please Contact Administrator.'
      });
    }

    const matchedEmp = matchResult.match;
    const employeeId = matchedEmp.id;
    const name = matchedEmp.name;
    const confidenceScore = matchResult.confidenceScore;

    // Retrieve last location to run velocity breach checks
    try {
      const prevEmp = await db.get(
        'SELECT last_latitude, last_longitude, last_location_time FROM employees WHERE id = ?',
        [employeeId]
      );
      if (prevEmp && prevEmp.last_latitude && prevEmp.last_longitude && prevEmp.last_location_time) {
        const lastTime = new Date(prevEmp.last_location_time).getTime();
        const nowTime = Date.now();
        const timeDelta = (nowTime - lastTime) / 1000; // in seconds
        
        if (timeDelta > 0 && timeDelta < 7200) { // 2-hour window
          const dist = calculateDistance(userLat, userLng, prevEmp.last_latitude, prevEmp.last_longitude);
          const speedKmh = (dist / timeDelta) * 3.6;
          
          if (speedKmh > 150) {
            const breachMsg = `Impossible travel speed: ${speedKmh.toFixed(1)} km/h. Distance: ${dist.toFixed(0)}m in ${timeDelta.toFixed(0)}s.`;
            console.warn(`[VELOCITY BREACH] Employee ${employeeId} travelled at impossible speed: ${speedKmh.toFixed(2)} km/h`);
            await logAuditEvent(employeeId, 'VELOCITY_BREACH', { location: 'Public Kiosk', details: breachMsg }, req.ip);
            return res.status(403).json({
              success: false,
              reason: 'VELOCITY_BREACH',
              message: 'Biometric Scanner Blocked: Impossible location travel velocity detected.',
              voiceMessage: 'Access denied. Travel velocity anomaly detected.'
            });
          }
        }
      }
    } catch (err) {
      console.error('[VELOCITY CHECK ERROR IN PUBLIC-SCAN]:', err);
    }

    // Retrieve department & profile image from database
    const empDetails = await db.get(`SELECT department, avatar, profile_image FROM employees WHERE id = ?`, [employeeId]);
    const department = empDetails?.department || 'General';
    const avatar = empDetails?.profile_image || empDetails?.avatar || null;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // [H-05 FIX]: IST date, not UTC
    const now = new Date().toISOString();
    const timeString = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' });
    const timeShort = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const dateString = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Kolkata' });

    // Save Attendance Evidence Photo to local storage disk (uploads/attendance/YYYY/MM/DD/)
    let savedEvidencePath = null;
    if (capturedImage) {
      savedEvidencePath = await saveAttendancePhoto(employeeId, capturedImage, today, timeShort);
    }

    const attendanceRecord = await db.get(
      `SELECT * FROM attendance WHERE employee_id = ? AND date = ?`,
      [employeeId, today]
    );

    let eventType = 'CHECK_IN';
    let statusText = 'Attendance Marked Successfully';

    if (!attendanceRecord) {
      // Check-In
      const checkInHour = new Date().getHours();
      const checkInMinute = new Date().getMinutes();
      const isLate = checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0);
      const status = isLate ? 'Late Arrival' : 'On Time';

      await db.run(
        `INSERT INTO attendance (employee_id, date, check_in, status, latitude, longitude, confidence_score, captured_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [employeeId, today, now, status, userLat, userLng, confidenceScore, savedEvidencePath]
      );

      await db.run(`UPDATE employees SET status = 'Inside Office' WHERE id = ?`, [employeeId]);

      eventType = 'CHECK_IN';
      statusText = `Welcome ${name}! Attendance Marked Successfully.`;

      await logAuditEvent(employeeId, 'CHECK_IN', {
        location: 'Public Kiosk',
        confidenceScore,
        evidencePath: savedEvidencePath,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
    } else if (!attendanceRecord.check_out) {
      // Check-Out
      eventType = 'CHECK_OUT';
      const checkInTime = new Date(attendanceRecord.check_in);
      const checkOutTime = new Date(now);
      const diffMs = checkOutTime - checkInTime;
      const hours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));
      const overtime = hours > 8 ? parseFloat((hours - 8).toFixed(2)) : 0;
      const status = hours < 6 ? 'Early Exit' : attendanceRecord.status;

      await db.run(
        `UPDATE attendance SET check_out = ?, working_hours = ?, overtime = ?, status = ?, captured_image = COALESCE(captured_image, ?) WHERE id = ?`,
        [now, hours, overtime, status, savedEvidencePath, attendanceRecord.id]
      );

      await db.run(`UPDATE employees SET status = 'Offline' WHERE id = ?`, [employeeId]);

      statusText = `Goodbye ${name}! Check-out Marked Successfully (${hours}h).`;

      await logAuditEvent(employeeId, 'CHECK_OUT', {
        location: 'Public Kiosk',
        hoursLogged: hours,
        evidencePath: savedEvidencePath,
        userCoords,
        userAgent: req.headers['user-agent']
      }, req.ip);
    } else {
      return res.json({
        success: true,
        alreadyCompleted: true,
        employee: { id: employeeId, name, department, avatar },
        date: dateString,
        time: timeString,
        status: 'Attendance Already Marked Today',
        message: `Attendance for ${name} is already marked for today.`
      });
    }

    // Broadcast Socket.IO events for real-time dashboard updates
    broadcastEvent('logs:new', {
      employee_id: employeeId,
      name,
      event_type: eventType,
      timestamp: now,
      location: 'Public Attendance Link',
      details: { coordinates: { latitude: userLat, longitude: userLng }, face_confidence: confidenceScore, evidence: savedEvidencePath }
    });

    broadcastEvent('employee:status', {
      id: employeeId,
      name,
      status: eventType === 'CHECK_IN' ? 'Inside Office' : 'Offline'
    });

    res.json({
      success: true,
      employee: { id: employeeId, name, department, avatar },
      date: dateString,
      time: timeString,
      status: 'Attendance Marked Successfully',
      eventType,
      message: statusText,
      confidenceScore,
      evidencePath: savedEvidencePath,
      voiceMessage: `${name}, attendance marked successfully.`
    });

  } catch (error) {
    next(error);
  }
});

export default router;
