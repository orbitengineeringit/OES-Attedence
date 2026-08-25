import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs-extra';
import path from 'path';
import { getDb, initializeDatabase } from '../database/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { registerFaceData } from '../services/faceRecognitionService.js';
import { processGeofenceUpdate } from '../services/geofenceService.js';
import { descriptorCache } from '../services/descriptorCache.js';
import { saveEmployeePhoto, saveDescriptorFile, sanitizeFolderId } from '../services/photoStorage.js';
import { logAuditEvent } from '../services/auditLogger.js';
import { encryptDescriptor } from '../services/encryption.js';
import jpeg from 'jpeg-js';

const router = express.Router();

const getFullEmpId = (req) => {
  const urlParts = req.originalUrl.split('/employees/');
  if (urlParts[1]) {
    const subPath = urlParts[1].split('?')[0];
    // Remove action suffixes like /face, /reset-face, /coordinates, /avatar
    let clean = subPath.replace(/\/face$/, '').replace(/\/reset-face$/, '').replace(/\/coordinates$/, '').replace(/\/avatar$/, '');
    return decodeURIComponent(clean);
  }
  return req.params.id || req.params[0];
};

// Apply global Auth check
router.use(requireAuth);

// @route   POST /api/employees/reset-db
// @desc    Wipe all tables and re-seed the database safely (Admin only)
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
    await db.run('DELETE FROM audit_logs');
    await db.run('DELETE FROM attendance');
    await db.run('DELETE FROM face_descriptors');
    await db.run('DELETE FROM employees');
    await db.run('DELETE FROM settings');
    
    await initializeDatabase();
    await descriptorCache.initialize(db);

    await logAuditEvent(req.user?.id, 'DATABASE_RESET', { message: 'Database reset & re-seeded by admin' }, req.ip);
    
    res.json({ success: true, message: 'Database reset successfully and default accounts re-seeded.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST or DELETE /api/employees/:id/reset-face or /face
router.all(['/:id/reset-face', '/*/reset-face'], requireAdmin, async (req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return next();
  }
  if (req.method === 'POST' && req.body && (req.body.faceDescriptor || req.body.descriptor)) {
    return next();
  }

  const db = getDb();
  const empId = getFullEmpId(req);
  try {
    await db.run(`UPDATE employees SET face_data = NULL, avatar = NULL WHERE id = ?`, [empId]);
    await db.run(`DELETE FROM face_descriptors WHERE employee_id = ?`, [empId]);

    descriptorCache.remove(empId);

    const cleanId = sanitizeFolderId(empId);
    const descFilePath = path.resolve('uploads', 'employees', cleanId, 'descriptor.json');
    await fs.remove(descFilePath).catch(() => {});

    await logAuditEvent(req.user?.id, 'FACE_DATA_RESET', { target_employee: empId }, req.ip);

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
    const employees = await db.all(`
      SELECT e.id, e.name, e.email, e.role, e.department, e.avatar, e.profile_image, e.status, e.latitude, e.longitude, e.created_at,
             (e.face_data IS NOT NULL OR f.descriptor_json IS NOT NULL) AS is_face_registered
      FROM employees e
      LEFT JOIN face_descriptors f ON e.id = f.employee_id
    `);

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
    const emp = await db.get(`
      SELECT e.id, e.name, e.email, e.role, e.department, e.avatar, e.profile_image, e.status, e.latitude, e.longitude, e.created_at,
             (e.face_data IS NOT NULL OR f.descriptor_json IS NOT NULL) AS is_face_registered
      FROM employees e
      LEFT JOIN face_descriptors f ON e.id = f.employee_id
      WHERE e.id = ?
    `, [req.user.id]);

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    res.json({ success: true, employee: emp });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees
// @desc    Add employee profile with local disk image saving (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  const { id, name, email, password, role, department, profile_image } = req.body;
  const db = getDb();

  try {
    if (!id || !name || !email || !password || !role || !department) {
      return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const existing = await db.get(`SELECT id FROM employees WHERE email = ? OR id = ?`, [email, id]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'ID or Email already in use.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let savedImagePath = null;
    if (profile_image) {
      savedImagePath = await saveEmployeePhoto(id, profile_image, 'profile.jpg');
    }

    await db.run(
      `INSERT INTO employees (id, name, email, password, role, department, profile_image) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, hashedPassword, role, department, savedImagePath]
    );

    await logAuditEvent(req.user.id, 'EMPLOYEE_CREATED', { created_employee_id: id, name, email, role }, req.ip);

    res.status(201).json({ success: true, message: 'Employee profile created successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/employees/*
// @desc    Retrieve details for a single employee
router.get('/*', async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);
  try {
    if (!empId) return next();
    if (req.user.role !== 'admin' && req.user.id !== empId) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only view your own profile.' });
    }

    const emp = await db.get(`
      SELECT e.id, e.name, e.email, e.role, e.department, e.avatar, e.profile_image, e.status, e.latitude, e.longitude, e.created_at,
             (e.face_data IS NOT NULL OR f.descriptor_json IS NOT NULL) AS is_face_registered
      FROM employees e
      LEFT JOIN face_descriptors f ON e.id = f.employee_id
      WHERE e.id = ?
    `, [empId]);

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    res.json({ success: true, employee: emp });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/employees/*
// @desc    Update employee profile (Admin only)
router.put('/*', requireAdmin, async (req, res, next) => {
  const { name, email, role, department, password, profile_image } = req.body;
  const db = getDb();
  const empId = getFullEmpId(req);

  try {
    const emp = await db.get(`SELECT id FROM employees WHERE id = ?`, [empId]);
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    let hashedPassword = undefined;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    let savedImagePath = undefined;
    if (profile_image) {
      savedImagePath = await saveEmployeePhoto(empId, profile_image, 'profile.jpg');
    }

    if (hashedPassword && savedImagePath) {
      await db.run(
        `UPDATE employees SET name = ?, email = ?, role = ?, department = ?, password = ?, profile_image = ? WHERE id = ?`,
        [name, email, role, department, hashedPassword, savedImagePath, empId]
      );
    } else if (hashedPassword) {
      await db.run(
        `UPDATE employees SET name = ?, email = ?, role = ?, department = ?, password = ? WHERE id = ?`,
        [name, email, role, department, hashedPassword, empId]
      );
    } else if (savedImagePath) {
      await db.run(
        `UPDATE employees SET name = ?, email = ?, role = ?, department = ?, profile_image = ? WHERE id = ?`,
        [name, email, role, department, savedImagePath, empId]
      );
    } else {
      await db.run(
        `UPDATE employees SET name = ?, email = ?, role = ?, department = ? WHERE id = ?`,
        [name, email, role, department, empId]
      );
    }

    // Update descriptor cache details in-memory if employee is cached to prevent stale biometrics
    if (descriptorCache.cache.has(empId)) {
      const cached = descriptorCache.cache.get(empId);
      descriptorCache.set(empId, name || cached.name, email || cached.email, role || cached.role, cached.descriptor);
    }

    await logAuditEvent(req.user.id, 'EMPLOYEE_UPDATED', { updated_employee_id: empId, name, email }, req.ip);

    res.json({ success: true, message: 'Employee profile updated successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/*/avatar
// @desc    Update employee profile photo (Owner or Admin)
router.post('/*/avatar', requireAuth, async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);
  const { avatar } = req.body;

  // Authorization check: User can only update own avatar, unless Admin
  if (req.user.id !== empId && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Access denied. You can only update your own profile avatar.' });
  }

  try {
    const emp = await db.get(`SELECT id, name FROM employees WHERE id = ?`, [empId]);
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    let sanitizedAvatar = null;
    if (avatar && typeof avatar === 'string' && avatar.trim().length > 0) {
      // Security validations
      const isAllowedFormat = avatar.startsWith('data:image/jpeg;base64,') || 
                              avatar.startsWith('data:image/png;base64,') || 
                              avatar.startsWith('data:image/webp;base64,');
      if (!isAllowedFormat) {
        return res.status(400).json({ success: false, message: 'Security check failed: Only base64 JPEG, PNG, or WebP images are allowed.' });
      }
      if (avatar.includes('<script') || avatar.includes('javascript:') || avatar.includes('data:image/svg+xml')) {
        return res.status(400).json({ success: false, message: 'Security violation: Malicious payload detected.' });
      }
      if (avatar.length > 5 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Avatar image payload exceeds 5MB limit.' });
      }
      sanitizedAvatar = avatar;
    }

    await db.run(`UPDATE employees SET avatar = ? WHERE id = ?`, [sanitizedAvatar, empId]);
    await logAuditEvent(req.user.id, 'AVATAR_UPDATED', { target_employee_id: empId, name: emp.name }, req.ip);

    res.json({ success: true, message: 'Profile avatar updated successfully.', avatar: sanitizedAvatar });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/employees/*
// @desc    Delete employee & purge disk images (Admin only)
router.delete('/*', requireAdmin, async (req, res, next) => {
  const db = getDb();
  const empId = getFullEmpId(req);

  try {
    if (!empId) {
      return res.status(400).json({ success: false, message: 'Employee ID parameter required for deletion.' });
    }

    await db.run(`DELETE FROM employees WHERE id = ?`, [empId]);
    await db.run(`DELETE FROM face_descriptors WHERE employee_id = ?`, [empId]);
    await db.run(`DELETE FROM attendance WHERE employee_id = ?`, [empId]);

    descriptorCache.remove(empId);

    const cleanId = sanitizeFolderId(empId);
    const empDir = path.resolve('uploads', 'employees', cleanId);
    await fs.remove(empDir).catch(() => {});

    // [L-04 FIX]: Log biometric deletion as a separate BIOMETRIC_DATA_DELETED audit event.
    // This creates a compliance trail for DPDP Act 2023 / biometric data governance.
    await logAuditEvent(req.user.id, 'BIOMETRIC_DATA_DELETED', { 
      deleted_employee_id: empId, 
      biometric_type: 'face_descriptor_128d',
      storage_cleared: 'face_descriptors table + employees.face_data + uploads directory'
    }, req.ip);

    await logAuditEvent(req.user.id, 'EMPLOYEE_DELETED', { deleted_employee_id: empId }, req.ip);


    res.json({ success: true, message: 'Employee profile deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/*/face
// @desc    Register face biometrics & save photos to local storage (Admin only)
router.post('/*/face', requireAdmin, async (req, res, next) => {
  const { faceDescriptor, descriptor, avatar, faceImage } = req.body;
  const empId = getFullEmpId(req);
  const db = getDb();

  try {
    const rawDesc = faceDescriptor || descriptor;
    if (!rawDesc) {
      return res.status(400).json({ success: false, message: 'Biometric face descriptor vector is required.' });
    }

    let descriptorArr = [];
    if (typeof rawDesc === 'string') {
      descriptorArr = JSON.parse(rawDesc);
    } else if (Array.isArray(rawDesc)) {
      descriptorArr = rawDesc;
    }

    if (descriptorArr.length !== 128) {
      return res.status(400).json({ success: false, message: 'Invalid face descriptor dimensions. Expected 128-float array.' });
    }

    const emp = await db.get(`SELECT id, name, email, role FROM employees WHERE id = ?`, [empId]);
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee profile not found.' });
    }

    // [QUALITY GATE CHECK]: Check image brightness and blurriness server-side
    const enrollPhotoData = avatar || faceImage;
    if (enrollPhotoData && typeof enrollPhotoData === 'string' && enrollPhotoData.startsWith('data:image/jpeg;base64,')) {
      const base64Data = enrollPhotoData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      try {
        const rawImageData = jpeg.decode(buffer);
        const pixels = rawImageData.data;
        const width = rawImageData.width;
        const height = rawImageData.height;

        let totalLuminance = 0;
        let edgeVal = 0;
        let count = 0;

        for (let i = 0; i < pixels.length; i += 4) {
          totalLuminance += (0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]);
        }
        const brightness = totalLuminance / (width * height);

        const getGray = (px, py) => {
          const id = (py * width + px) * 4;
          return 0.299 * pixels[id] + 0.587 * pixels[id+1] + 0.114 * pixels[id+2];
        };

        for (let y = 1; y < height - 1; y += 2) {
          for (let x = 1; x < width - 1; x += 2) {
            const gx = 
              -1 * getGray(x - 1, y - 1) + 1 * getGray(x + 1, y - 1) +
              -2 * getGray(x - 1, y)     + 2 * getGray(x + 1, y) +
              -1 * getGray(x - 1, y + 1) + 1 * getGray(x + 1, y + 1);
            const gy = 
              -1 * getGray(x - 1, y - 1) - 2 * getGray(x, y - 1) - 1 * getGray(x + 1, y - 1) +
               1 * getGray(x - 1, y + 1) + 2 * getGray(x, y + 1) + 1 * getGray(x + 1, y + 1);
            edgeVal += Math.sqrt(gx * gx + gy * gy);
            count++;
          }
        }
        const sharpness = count > 0 ? (edgeVal / count) : 0;

        console.log(`[SERVER QUALITY GATE] Brightness: ${brightness.toFixed(2)}, Sharpness: ${sharpness.toFixed(2)}`);

        if (brightness < 20) {
          return res.status(400).json({
            success: false,
            reason: 'ENROLLMENT_QUALITY_FAILED',
            message: `Face photo is too dark (brightness: ${brightness.toFixed(1)} < 20.0). Please ensure better lighting.`
          });
        }
        if (brightness > 245) {
          return res.status(400).json({
            success: false,
            reason: 'ENROLLMENT_QUALITY_FAILED',
            message: `Face photo is too bright (brightness: ${brightness.toFixed(1)} > 245.0). Please avoid direct glare.`
          });
        }
        if (sharpness < 4.0) {
          return res.status(400).json({
            success: false,
            reason: 'ENROLLMENT_QUALITY_FAILED',
            message: `Face photo is too blurry (sharpness: ${sharpness.toFixed(1)} < 4.0). Please stand still and retry.`
          });
        }
      } catch (gateErr) {
        console.error('[SERVER QUALITY GATE EXCEPTION]:', gateErr.message);
      }
    }

    // Configurable duplicate threshold check (from settings table or default 0.58)
    const thresholdSetting = await db.get(`SELECT value FROM settings WHERE key = 'duplicate_face_threshold'`);
    const DUPLICATE_FACE_THRESHOLD = thresholdSetting ? parseFloat(thresholdSetting.value) : 0.58;

    const dupCheck = await descriptorCache.checkForDuplicate(db, descriptorArr, empId, DUPLICATE_FACE_THRESHOLD);
    if (dupCheck.isDuplicate) {
      const existingEmp = dupCheck.matchedEmp;
      const rejectMessage = `Duplicate Face Detected. This face is already registered for Employee ID: ${existingEmp.id} (Name: ${existingEmp.name}). Face registration has been cancelled.`;

      await logAuditEvent(req.user.id, 'DUPLICATE_FACE_REJECTED', {
        target_employee_id: empId,
        existing_employee_id: existingEmp.id,
        existing_employee_name: existingEmp.name,
        distance: dupCheck.distance
      }, req.ip);

      return res.status(409).json({
        success: false,
        reason: 'DUPLICATE_FACE_DETECTED',
        message: rejectMessage,
        existingEmployee: {
          id: existingEmp.id,
          name: existingEmp.name
        }
      });
    }

    const encryptedFace = encryptDescriptor(descriptorArr);

    let photoPath = null;
    const photoData = avatar || faceImage;
    if (photoData) {
      photoPath = await saveEmployeePhoto(empId, photoData, 'face.jpg');
    }

    await saveDescriptorFile(empId, descriptorArr);

    await db.run(
      `UPDATE employees SET face_data = ?, avatar = ?, profile_image = COALESCE(profile_image, ?) WHERE id = ?`,
      [encryptedFace, photoPath || avatar, photoPath, empId]
    );

    await db.run(`
      INSERT OR REPLACE INTO face_descriptors (employee_id, descriptor_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `, [empId, JSON.stringify(descriptorArr)]);

    descriptorCache.set(empId, emp.name, emp.email, emp.role, descriptorArr);

    await logAuditEvent(req.user.id, 'FACE_REGISTERED', { registered_employee_id: empId, name: emp.name }, req.ip);

    res.json({
      success: true,
      message: 'Biometric face template registered and cached successfully.',
      is_face_registered: true,
      profile_image: photoPath
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/employees/*/coordinates
// @desc    Update employee live location coordinates & geofence status
router.post('/*/coordinates', async (req, res, next) => {
  const { latitude, longitude } = req.body;
  const empId = getFullEmpId(req);

  try {
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude coordinates are required.' });
    }

    const result = await processGeofenceUpdate(empId, parseFloat(latitude), parseFloat(longitude));
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
