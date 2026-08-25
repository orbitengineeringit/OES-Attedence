import { supabase } from './supabaseClient.js';

/**
 * Sanitize employee ID for directory safety (e.g. 'OES/001' -> 'OES001')
 */
export function sanitizeFolderId(employeeId) {
  if (!employeeId) return 'UNKNOWN';
  return employeeId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Convert Base64 string to Uint8Array / Blob for Supabase Storage Upload
 */
function base64ToBlob(base64Data, contentType = 'image/jpeg') {
  if (!base64Data) return null;
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const byteCharacters = atob(cleanBase64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
}

/**
 * Check if image is empty or pitch black
 */
export function isPitchBlackImage(base64Data) {
  if (!base64Data || base64Data.length < 500) return true;
  return false;
}

/**
 * Client-Side Direct Upload: Employee Profile Photo to Supabase Storage ('avatars' bucket)
 * Returns the public HTTPS URL on success or null on failure.
 */
export async function uploadEmployeePhotoClient(employeeId, base64OrUrl, filename = 'profile.jpg') {
  if (!base64OrUrl) return null;
  if (base64OrUrl.startsWith('http://') || base64OrUrl.startsWith('https://')) {
    return base64OrUrl; // Already a URL
  }

  try {
    const cleanId = sanitizeFolderId(employeeId);
    const storagePath = `employees/${cleanId}/${Date.now()}_${filename}`;
    const blob = base64ToBlob(base64OrUrl, 'image/jpeg');

    if (!blob) return null;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.warn('[CLIENT STORAGE WARN]: Upload to avatars failed:', uploadError.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(storagePath);

    if (urlData?.publicUrl) {
      console.log(`[CLIENT STORAGE SUCCESS]: Profile photo uploaded -> ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }

    return null;
  } catch (err) {
    console.error('[CLIENT STORAGE ERROR]: Profile photo upload failed:', err);
    return null;
  }
}

/**
 * Client-Side Direct Upload: Attendance Scan Evidence to Supabase Storage ('attendance-evidence' bucket)
 * Returns public HTTPS URL on success or null on failure.
 */
export async function uploadAttendancePhotoClient(employeeId, base64OrUrl, dateStr, timeStr) {
  if (!base64OrUrl) return null;
  if (base64OrUrl.startsWith('http://') || base64OrUrl.startsWith('https://')) {
    return base64OrUrl; // Already a URL
  }

  try {
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
    const blob = base64ToBlob(base64OrUrl, 'image/jpeg');

    if (!blob) return null;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attendance-evidence')
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.warn('[CLIENT EVIDENCE STORAGE WARN]: Upload to attendance-evidence failed:', uploadError.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('attendance-evidence')
      .getPublicUrl(storagePath);

    if (urlData?.publicUrl) {
      console.log(`[CLIENT EVIDENCE STORAGE SUCCESS]: ${urlData.publicUrl}`);
      return urlData.publicUrl;
    }

    return null;
  } catch (err) {
    console.error('[CLIENT EVIDENCE STORAGE ERROR]: Evidence upload failed:', err);
    return null;
  }
}
