import { supabase } from '../database/supabaseClient.js';
import fs from 'fs-extra';
import path from 'path';

const UPLOADS_ROOT = path.resolve('uploads');

// Ensure fallback upload directories exist locally just in case
fs.ensureDirSync(path.join(UPLOADS_ROOT, 'employees'));
fs.ensureDirSync(path.join(UPLOADS_ROOT, 'attendance'));

/**
 * Sanitize employee ID for path safety (e.g. 'OES/001' -> 'OES001')
 */
export function sanitizeFolderId(employeeId) {
  if (!employeeId) return 'UNKNOWN';
  return employeeId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Check if image buffer is suspiciously small or pitch black empty frame
 */
export function isPitchBlackImage(buffer) {
  if (!buffer || buffer.length < 500) return true;
  let zeroCount = 0;
  const sampleSize = Math.min(200, buffer.length);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0) zeroCount++;
  }
  return zeroCount > sampleSize * 0.95;
}

/**
 * Auto-initialize public Supabase Storage Buckets
 */
export async function initializeStorageBuckets() {
  const buckets = ['avatars', 'attendance-evidence'];
  for (const bucketName of buckets) {
    try {
      const { data, error } = await supabase.storage.getBucket(bucketName);
      if (error || !data) {
        console.log(`[SUPABASE STORAGE]: Bucket '${bucketName}' not found. Creating public bucket...`);
        await supabase.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 10485760 // 10MB
        });
      }
    } catch (err) {
      console.warn(`[SUPABASE STORAGE BUCKET INIT WARN]: Could not check/create bucket '${bucketName}':`, err.message);
    }
  }
}

/**
 * Convert base64 string or buffer to standard Buffer instance
 */
function toBuffer(base64OrBuffer) {
  if (!base64OrBuffer) return null;
  if (Buffer.isBuffer(base64OrBuffer)) return base64OrBuffer;
  if (typeof base64OrBuffer === 'string') {
    // Return null if it is already a URL or local file path to avoid corruption
    if (/^https?:\/\//i.test(base64OrBuffer) || base64OrBuffer.startsWith('uploads/')) {
      return null;
    }
    const base64Data = base64OrBuffer.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }
  return null;
}

/**
 * Save / Upload Employee Profile Photo to Supabase Storage ('avatars' bucket)
 * Returns the public URL on success or relative path on fallback.
 */
export async function saveEmployeePhoto(employeeId, base64OrBuffer, filename = 'profile.jpg') {
  try {
    const buffer = toBuffer(base64OrBuffer);
    if (!buffer || isPitchBlackImage(buffer)) {
      console.warn(`[PHOTO STORAGE SKIPPED]: Empty/invalid image detected for ${employeeId}.`);
      return null;
    }

    const cleanId = sanitizeFolderId(employeeId);
    const storagePath = `employees/${cleanId}/${Date.now()}_${filename}`;

    // Attempt Supabase Storage Upload
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (!uploadError && uploadData) {
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(storagePath);

      if (urlData?.publicUrl) {
        console.log(`[SUPABASE STORAGE SUCCESS]: Uploaded employee photo for ${employeeId} -> ${urlData.publicUrl}`);
        return urlData.publicUrl;
      }
    }

    if (uploadError) {
      console.warn(`[SUPABASE STORAGE WARN]: Upload failed (${uploadError.message}). Falling back to local storage...`);
    }

    // Local Disk Fallback
    const targetDir = path.join(UPLOADS_ROOT, 'employees', cleanId);
    await fs.ensureDir(targetDir);
    const targetPath = path.join(targetDir, filename);
    await fs.writeFile(targetPath, buffer);
    const relativePath = `uploads/employees/${cleanId}/${filename}`;
    console.log(`[LOCAL STORAGE FALLBACK]: Saved employee photo to ${relativePath}`);
    return relativePath;
  } catch (err) {
    console.error(`[SAVE EMPLOYEE PHOTO ERROR]:`, err);
    return null;
  }
}

/**
 * Save / Upload Attendance Evidence Photo to Supabase Storage ('attendance-evidence' bucket)
 * Returns public URL on success or relative path on fallback.
 */
export async function saveAttendancePhoto(employeeId, base64OrBuffer, dateStr, timeStr) {
  try {
    const buffer = toBuffer(base64OrBuffer);
    if (!buffer || isPitchBlackImage(buffer)) {
      console.warn(`[ATTENDANCE PHOTO SKIPPED]: Empty/invalid evidence frame detected.`);
      return null;
    }

    const cleanId = sanitizeFolderId(employeeId);
    const now = new Date();
    let year = now.getFullYear().toString();
    let month = String(now.getMonth() + 1).padStart(2, '0');
    let day = String(now.getDate()).padStart(2, '0');

    if (dateStr && dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        year = parts[0];
        month = parts[1].padStart(2, '0');
        day = parts[2].padStart(2, '0');
      }
    }

    const cleanTime = (timeStr || now.toLocaleTimeString([], { hour12: false })).replace(/[^0-9]/g, '');
    const fileName = `${cleanId}_${cleanTime || 'scan'}_${Date.now()}.jpg`;
    const storagePath = `${year}/${month}/${day}/${fileName}`;

    // Attempt Supabase Storage Upload
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attendance-evidence')
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (!uploadError && uploadData) {
      const { data: urlData } = supabase.storage
        .from('attendance-evidence')
        .getPublicUrl(storagePath);

      if (urlData?.publicUrl) {
        console.log(`[SUPABASE ATTENDANCE EVIDENCE SAVED]: ${urlData.publicUrl}`);
        return urlData.publicUrl;
      }
    }

    if (uploadError) {
      console.warn(`[SUPABASE EVIDENCE STORAGE WARN]: Upload failed (${uploadError.message}). Falling back to local disk...`);
    }

    // Local Disk Fallback
    const targetDir = path.join(UPLOADS_ROOT, 'attendance', year, month, day);
    await fs.ensureDir(targetDir);
    const targetPath = path.join(targetDir, fileName);
    await fs.writeFile(targetPath, buffer);
    const relativePath = `uploads/attendance/${year}/${month}/${day}/${fileName}`;
    console.log(`[LOCAL ATTENDANCE EVIDENCE FALLBACK]: ${relativePath}`);
    return relativePath;
  } catch (err) {
    console.error(`[SAVE ATTENDANCE PHOTO ERROR]:`, err);
    return null;
  }
}

/**
 * Save Face Descriptor JSON file (optional local backup)
 */
export async function saveDescriptorFile(employeeId, descriptorArr) {
  try {
    const cleanId = sanitizeFolderId(employeeId);
    const targetDir = path.join(UPLOADS_ROOT, 'employees', cleanId);
    await fs.ensureDir(targetDir);
    const targetPath = path.join(targetDir, 'descriptor.json');
    await fs.writeJson(targetPath, descriptorArr, { spaces: 2 });
    return `uploads/employees/${cleanId}/descriptor.json`;
  } catch (err) {
    console.error(`[DESCRIPTOR FILE SAVE ERROR]:`, err);
    return null;
  }
}
