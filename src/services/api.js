import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabaseClient.js';
import { uploadEmployeePhotoClient, uploadAttendancePhotoClient } from './clientStorage.js';

// URL/key for isolated temp clients (employee signup - no session persistence)
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co').trim();
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder').replace('anon public ', '').trim();

if (supabaseUrl.includes('placeholder.supabase.co')) {
  console.error('[Supabase Configuration Error]: VITE_SUPABASE_URL is missing in api.js. Please restart Vite server.');
}

// ==========================================
// 1. BIOMETRIC CRYPTOGRAPHY (Web Crypto API)
// ==========================================

const ALGORITHM = 'AES-CBC';
const SECRET = 'super-secure-neon-quantum-jwt-secret-key-9824';

/**
 * Derives a secure 256-bit key from the local secret key using SHA-256.
 */
const getCryptoKey = async () => {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(SECRET);
  const hash = await window.crypto.subtle.digest('SHA-256', secretBytes);
  return await window.crypto.subtle.importKey(
    'raw',
    hash,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Encrypts a 128-float array biometric descriptor.
 */
export const encryptDescriptor = async (descriptorArray) => {
  if (!Array.isArray(descriptorArray) || descriptorArray.length === 0) {
    throw new Error('Biometric data must be a valid float array.');
  }

  const text = JSON.stringify(descriptorArray);
  const encoder = new TextEncoder();
  const plainBytes = encoder.encode(text);
  const cryptoKey = await getCryptoKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(16));

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    plainBytes
  );

  // Convert Uint8Arrays to hexadecimal string
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `${toHex(iv)}:${toHex(encryptedBuffer)}`;
};

/**
 * Decrypts a biometric descriptor string to a 128-float array.
 * Supports legacy unencrypted JSON representation fallbacks.
 */
export const decryptDescriptor = async (encryptedString) => {
  if (!encryptedString) return null;

  const trimmed = encryptedString.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.error('[BIOMETRIC DECRYPTION FALLBACK ERROR]: Failed parsing unencrypted JSON:', e);
      return null;
    }
  }

  try {
    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid cipher format. Expected iv:data');
    }

    const hexToBytes = (hex) => {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, (i * 2) + 2), 16);
      }
      return bytes;
    };

    const iv = hexToBytes(parts[0]);
    const encryptedBytes = hexToBytes(parts[1]);
    const cryptoKey = await getCryptoKey();

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      cryptoKey,
      encryptedBytes
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch (error) {
    console.error('[BIOMETRIC DECRYPTION ERROR]: Critical failure during decryption:', error);
    return null;
  }
};

// ==========================================
// 2. MATHEMATICAL GEOFENCING CALCULATIONS
// ==========================================

/**
 * Calculates geodetic distance between coordinates using Haversine formula.
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (
    lat1 === undefined || lon1 === undefined ||
    lat2 === undefined || lon2 === undefined ||
    isNaN(lat1) || isNaN(lon1) ||
    isNaN(lat2) || isNaN(lon2)
  ) {
    return Infinity;
  }

  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
};

/**
 * Validates if coordinates are inside a polygon using Ray-Casting algorithm.
 */
export const isPointInPolygon = (pointLat, pointLng, polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return false;

  let isInside = false;
  const x = pointLng, y = pointLat;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

/**
 * Calculates perpendicular/vertex distance from a point to a line segment in meters.
 */
const getDistanceToSegment = (py, px, y1, x1, y2, x2) => {
  const latToMeters = 111320;
  const lngToMeters = 111320 * Math.cos((y1 * Math.PI) / 180);
  
  const ax = 0;
  const ay = 0;
  const bx = (x2 - x1) * lngToMeters;
  const by = (y2 - y1) * latToMeters;
  const px_m = (px - x1) * lngToMeters;
  const py_m = (py - y1) * latToMeters;
  
  const r_x = bx - ax;
  const r_y = by - ay;
  const len2 = r_x * r_x + r_y * r_y;
  
  let t = 0;
  if (len2 > 0) {
    t = ((px_m - ax) * r_x + (py_m - ay) * r_y) / len2;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
  }
  
  const cx = ax + t * r_x;
  const cy = ay + t * r_y;
  
  const dx = px_m - cx;
  const dy = py_m - cy;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Calculates the minimum distance in meters from a point to a polygon boundary.
 */
export const getDistanceToPolygon = (pointLat, pointLng, polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return Infinity;
  
  let minDistance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    const dist = getDistanceToSegment(pointLat, pointLng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  return minDistance;
};

// ==========================================
// 3. SYSTEM BIOMETRIC ENGINE HELPERS
// ==========================================

export const calculateEuclideanDistance = (vectorA, vectorB) => {
  if (vectorA.length !== vectorB.length) return Infinity;
  let sum = 0.0;
  for (let i = 0; i < vectorA.length; i++) {
    const diff = vectorA[i] - vectorB[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
};

export const verifyLiveness = (faceMetrics) => {
  const { spoofIndex } = faceMetrics || { spoofIndex: 0.1 };
  if (spoofIndex && spoofIndex > 0.4) {
    return {
      passed: false,
      reason: 'Anti-Spoof Check Failed: Low liveness probability.'
    };
  }
  return { passed: true, reason: 'Liveness verified.' };
};

const broadcastRealtimeEvent = async (eventName, payload) => {
  try {
    const channel = supabase.channel('system_events');
    await channel.send({
      type: 'broadcast',
      event: eventName,
      payload
    });
  } catch (err) {
    console.error('[REALTIME BROADCAST ERROR]:', err);
  }
};

// ==========================================
// 4. API CALL INTERCEPT ENGINE (100% Serverless)
// ==========================================

const cache = {
  employees: {}, // id-based cache
  employeesList: null,
  employeeTemplates: null, // Cache for employees with face_data descriptors
  settings: null,
  geofence: null,
  attendance: null,
  logs: null,
  myLogs: {}, // email-based my-logs cache
  attendanceHistory: {} // employeeId-based history cache
};

const matchRoute = (path, pattern) => {
  const cleanPath = path.replace(/^\/+|\/+$/g, '');
  const cleanPattern = pattern.replace(/^\/+|\/+$/g, '');

  const patternParts = cleanPattern.split('/');

  // Special-case handlers for OES/XXX IDs containing slashes
  if (cleanPattern.startsWith('employees/:id/face') && cleanPath.startsWith('employees/') && cleanPath.endsWith('/face')) {
    const id = cleanPath.slice('employees/'.length, -'/face'.length);
    return { id: decodeURIComponent(id) };
  }
  if (cleanPattern.startsWith('employees/:id/reset-face') && cleanPath.startsWith('employees/') && cleanPath.endsWith('/reset-face')) {
    const id = cleanPath.slice('employees/'.length, -'/reset-face'.length);
    return { id: decodeURIComponent(id) };
  }
  if (cleanPattern.startsWith('employees/:id/coordinates') && cleanPath.startsWith('employees/') && cleanPath.endsWith('/coordinates')) {
    const id = cleanPath.slice('employees/'.length, -'/coordinates'.length);
    return { id: decodeURIComponent(id) };
  }
  if (cleanPattern.startsWith('employees/:id/avatar') && cleanPath.startsWith('employees/') && cleanPath.endsWith('/avatar')) {
    const id = cleanPath.slice('employees/'.length, -'/avatar'.length);
    return { id: decodeURIComponent(id) };
  }
  if (cleanPattern.startsWith('attendance/history/:employeeId') && cleanPath.startsWith('attendance/history/')) {
    const employeeId = cleanPath.slice('attendance/history/'.length);
    return { employeeId: decodeURIComponent(employeeId) };
  }
  if (cleanPattern === 'employees/:id' && cleanPath.startsWith('employees/')) {
    if (!cleanPath.endsWith('/face') && !cleanPath.endsWith('/reset-face') && !cleanPath.endsWith('/coordinates') && !cleanPath.endsWith('/avatar')) {
      const id = cleanPath.slice('employees/'.length);
      return { id: decodeURIComponent(id) };
    }
  }

  // Fallback to segment-based matching for other standard routes
  const pathParts = cleanPath.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].substring(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
};

export const apiCall = async (endpoint, method = 'GET', body = null, token = null) => {
  // If explicitly configured to use Express backend server, try HTTP request first
  if (import.meta.env.VITE_USE_EXPRESS_BACKEND === 'true') {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';
    try {
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const authToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('quantum_token') : null);
      
      const response = await fetch(`${BACKEND_URL}${cleanEndpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: body ? JSON.stringify(body) : null
      });

      if (response.ok) {
        return await response.json();
      } else if (response.status < 500) {
        const data = await response.json();
        const err = new Error(data.message || 'API Request Failed');
        err.response = data;
        throw err;
      }
    } catch (backendErr) {
      if (backendErr.response) throw backendErr;
    }
  }

  // 100% Direct Supabase SDK Engine (Default Mode for Vercel & Client Dev)
  console.log(`[DIRECT SUPABASE SDK EXECUTION]: ${method} ${endpoint}`, body);

  const [cleanEndpointPath, queryString] = (endpoint || '').split('?');
  const searchParams = new URLSearchParams(queryString || '');

  // ==========================================
  // ROLE-BASED ACCESS CONTROL GUARD
  // ==========================================
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('quantum_user') || 'null'); } catch { return null; }
  })();
  const isEmployee = currentUser && currentUser.role !== 'admin';

  if (isEmployee) {
    // Block admin-only endpoints for standard employees
    const adminOnlyEndpoints = [
      { path: '/employees', method: 'GET', exact: true },   // employee list
      { path: '/employees', method: 'POST', exact: true },  // add employee
      { path: '/logs', method: 'GET', exact: true },         // all logs
      { path: '/logs/audit', method: 'GET', exact: true },   // diagnostic audit logs
      { path: '/audit', method: 'GET', exact: true },        // audit alias
      { path: '/logs/clear', method: 'POST', exact: true },  // clear logs
      { path: '/attendance', method: 'GET', exact: true },   // organization-wide attendance logs
      { path: '/attendance/clear', method: 'POST', exact: true }, // wipe attendance
      { path: '/settings', method: 'POST', exact: true },   // write settings
      { path: '/settings/geofence', method: 'POST', exact: true }, // write geofence
    ];

    for (const rule of adminOnlyEndpoints) {
      if (rule.exact && (endpoint === rule.path || cleanEndpointPath === rule.path) && method === rule.method) {
        throw new Error('Access denied. This action requires administrator privileges.');
      }
    }

    // Block employee access to other employees' data
    const empIdMatch = matchRoute(endpoint, '/employees/:id');
    if (empIdMatch && empIdMatch.id !== currentUser.id) {
      // Allow only coordinate updates and avatar updates for own profile
      const coordMatch = matchRoute(endpoint, '/employees/:id/coordinates');
      const avatarMatch = matchRoute(endpoint, '/employees/:id/avatar');
      if ((!coordMatch || coordMatch.id !== currentUser.id) && (!avatarMatch || avatarMatch.id !== currentUser.id)) {
        throw new Error('Access denied. You can only view and update your own profile.');
      }
    }

    // Block employee access to other employees' attendance history
    const attHistMatch = matchRoute(endpoint, '/attendance/history/:employeeId');
    if (attHistMatch && attHistMatch.employeeId !== currentUser.id) {
      throw new Error('Access denied. You can only view your own attendance history.');
    }

    // Face enrollment: employees can enroll their OWN face; admin can enroll any
    const faceEndpoint = matchRoute(endpoint, '/employees/:id/face');
    if (faceEndpoint && faceEndpoint.id !== currentUser.id) {
      throw new Error('Access denied. You can only enroll your own face.');
    }

    // Face reset is admin-only
    const faceResetEndpoint = matchRoute(endpoint, '/employees/:id/reset-face');
    if (faceResetEndpoint) {
      throw new Error('Access denied. Face reset requires administrator privileges.');
    }

    // Block employee delete
    const deleteMatch = matchRoute(endpoint, '/employees/:id');
    if (deleteMatch && method === 'DELETE') {
      throw new Error('Access denied. Only administrators can delete employee records.');
    }
  }
  // ==========================================
  // END RBAC GUARD
  // ==========================================

  try {
    // 1. GET /employees (Fetch all employees)
    if (endpoint === '/employees' && method === 'GET') {
      if (cache.employeesList) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data, error } = await supabase
              .from('employees')
              .select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data');
            if (!error && data) {
              const employees = data.map(emp => ({
                ...emp,
                is_face_registered: emp.face_data !== null
              }));
              employees.forEach(emp => delete emp.face_data);
              cache.employeesList = employees;
            }
          } catch (e) {}
        }, 50);
        return { success: true, employees: cache.employeesList };
      }

      const { data, error } = await supabase
        .from('employees')
        .select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data');
      if (error) throw new Error(error.message);
      const employees = (data || []).map(emp => ({
        ...emp,
        is_face_registered: emp.face_data !== null
      }));
      employees.forEach(emp => delete emp.face_data);
      cache.employeesList = employees;
      return { success: true, employees };
    }

    // 2. POST /employees (Add Employee & Silently create in Supabase Auth)
    if (endpoint === '/employees' && method === 'POST') {
      cache.employeesList = null; // Invalidate
      cache.employeeTemplates = null; // Invalidate
      const { id, name, email, password, role, department, face_data } = body;

      // ===== DUPLICATE FACE PROTECTION =====
      // Before registering, check that no existing employee shares this face descriptor.
      if (face_data) {
        try {
          const newDescriptor = await decryptDescriptor(face_data);
          if (newDescriptor) {
            const { data: existingEmps } = await supabase
              .from('employees')
              .select('id, name, face_data')
              .not('face_data', 'is', null);

            const DUPLICATE_THRESHOLD = 0.40;
            for (const emp of (existingEmps || [])) {
              const existingDescriptor = await decryptDescriptor(emp.face_data);
              if (!existingDescriptor) continue;
              const dist = calculateEuclideanDistance(newDescriptor, existingDescriptor);
              if (dist < DUPLICATE_THRESHOLD) {
                throw new Error("Duplicate face detected. This biometric identity already belongs to another employee.");
              }
            }
          }
        } catch (dupErr) {
          if (dupErr.message.includes('Duplicate biometric')) throw dupErr;
          console.warn('[DUPLICATE FACE CHECK WARN]:', dupErr.message);
        }
      }
      // ===== END DUPLICATE FACE PROTECTION =====

      const tempClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });

      const { data: signUpData, error: authError } = await tempClient.auth.signUp({
        email,
        password,
        options: { data: { name, role, department } }
      });

      if (authError && !authError.message.includes('already registered')) {
        console.warn(`Auth Provider registration failed: ${authError.message}`);
      }

      // Use the tempClient's authenticated session for the insert so it satisfies
      // the RLS policy "auth_full_employees" (role = authenticated).
      // The global `supabase` client has no active session here (user not yet logged in)
      // so using it would trigger: "new row violates row-level security policy".
      const insertClient = (signUpData?.session) ? tempClient : supabase;

      const { error: dbError } = await insertClient.from('employees').insert({
        id,
        name,
        email,
        password,
        role,
        department,
        face_data: face_data || null,
        status: 'Offline'
      });

      if (dbError) throw new Error(`Database record insertion failed: ${dbError.message}`);
      return { success: true, message: 'Employee profile created successfully.' };
    }


    // 3. GET /employees/:id (Fetch single employee details)
    const empMatch = matchRoute(endpoint, '/employees/:id');
    if (empMatch && method === 'GET') {
      const empId = empMatch.id;
      if (cache.employees[empId]) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data, error } = await supabase
              .from('employees')
              .select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data')
              .eq('id', empId)
              .single();
            if (!error && data) {
              const employee = {
                ...data,
                is_face_registered: data.face_data !== null
              };
              delete employee.face_data;
              cache.employees[empId] = employee;
            }
          } catch (e) {}
        }, 50);
        return { success: true, employee: cache.employees[empId] };
      }

      const { data, error } = await supabase
        .from('employees')
        .select('id, name, email, role, department, avatar, status, latitude, longitude, created_at, face_data')
        .eq('id', empId)
        .single();
      if (error) throw new Error(error.message);
      const employee = {
        ...data,
        is_face_registered: data.face_data !== null
      };
      delete employee.face_data;
      cache.employees[empId] = employee;
      return { success: true, employee };
    }

    // 4. PUT /employees/:id (Update employee profile details)
    const empUpdateMatch = matchRoute(endpoint, '/employees/:id');
    if (empUpdateMatch && method === 'PUT') {
      const empId = empUpdateMatch.id;
      cache.employeesList = null; // Invalidate
      delete cache.employees[empId]; // Invalidate

      const { name, email, role, department, password } = body;
      const updates = { name, email, role, department };
      if (password) updates.password = password;
      
      const { error } = await supabase.from('employees').update(updates).eq('id', empId);
      if (error) throw new Error(error.message);
      return { success: true, message: 'Employee profile updated successfully.' };
    }

    // 4b. POST /employees/:id/avatar (Update profile avatar)
    const avatarMatch = matchRoute(endpoint, '/employees/:id/avatar');
    if (avatarMatch && method === 'POST') {
      const empId = avatarMatch.id;
      const { avatar } = body;

      let sanitizedAvatar = null;
      if (avatar && typeof avatar === 'string' && avatar.trim().length > 0) {
        const isAllowedFormat = avatar.startsWith('data:image/jpeg;base64,') || 
                                avatar.startsWith('data:image/png;base64,') || 
                                avatar.startsWith('data:image/webp;base64,');
        if (!isAllowedFormat) {
          throw new Error('Security check failed: Only base64 JPEG, PNG, or WebP images are allowed.');
        }
        if (avatar.includes('<script') || avatar.includes('javascript:') || avatar.includes('data:image/svg+xml')) {
          throw new Error('Security violation: Malicious payload detected.');
        }
        if (avatar.length > 5 * 1024 * 1024) {
          throw new Error('Avatar image payload exceeds 5MB limit.');
        }
        sanitizedAvatar = avatar;
      }

      cache.employeesList = null; // Invalidate
      delete cache.employees[empId]; // Invalidate

      const { error } = await supabase
        .from('employees')
        .update({ avatar: sanitizedAvatar })
        .eq('id', empId);
      if (error) throw new Error(error.message);

      // If current user is updated, sync localStorage
      try {
        const rawUser = localStorage.getItem('quantum_user');
        if (rawUser) {
          const u = JSON.parse(rawUser);
          if (u.id === empId) {
            u.avatar = sanitizedAvatar;
            localStorage.setItem('quantum_user', JSON.stringify(u));
          }
        }
      } catch (e) {}

      // Log event
      try {
        await supabase.from('logs').insert({
          employee_id: empId,
          event_type: 'AVATAR_UPDATED',
          location: 'Profile Settings',
          details: 'Profile avatar photo updated securely.'
        });
      } catch (e) {}

      return { success: true, message: 'Profile avatar updated successfully.', avatar: sanitizedAvatar };
    }

    // 5. DELETE /employees/:id (Delete employee record)
    const empDeleteMatch = matchRoute(endpoint, '/employees/:id');
    if (empDeleteMatch && method === 'DELETE') {
      const empId = empDeleteMatch.id;
      cache.employeesList = null; // Invalidate
      cache.employeeTemplates = null; // Invalidate
      delete cache.employees[empId]; // Invalidate

      try {
        await supabase.from('attendance').delete().eq('employee_id', empId);
        await supabase.from('face_descriptors').delete().eq('employee_id', empId);
        await supabase.from('logs').delete().eq('employee_id', empId);
      } catch (e) {}

      const { error } = await supabase.from('employees').delete().eq('id', empId);
      if (error) throw new Error(error.message);
      return { success: true, message: 'Employee profile deleted successfully.' };
    }

    // 6. POST /employees/:id/face (Enroll facial biometric template)
    const faceMatch = matchRoute(endpoint, '/employees/:id/face');
    if (faceMatch && method === 'POST') {
      const empId = faceMatch.id;
      cache.employeesList = null; // Invalidate
      cache.employeeTemplates = null; // Invalidate
      delete cache.employees[empId]; // Invalidate
      const { faceDescriptor } = body;

      // Quality Validation
      if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
        throw new Error('Biometric enrollment requires a non-empty face descriptor array.');
      }
      if (faceDescriptor.length !== 128) {
        throw new Error(`Invalid biometric face descriptor dimension: expected 128, got ${faceDescriptor.length}`);
      }
      if (faceDescriptor.every(val => val === 0)) {
        throw new Error('Biometric descriptor contains only zeros. Invalid face template.');
      }

      // Duplicate Check
      const { data: existingFaces, error: fetchError } = await supabase
        .from('employees')
        .select('id, name, face_data')
        .not('face_data', 'is', null)
        .neq('id', empId);
      if (fetchError) throw new Error(fetchError.message);

      const DUPLICATE_THRESHOLD = 0.55;
      for (const emp of (existingFaces || [])) {
        const dbDescriptor = await decryptDescriptor(emp.face_data);
        if (!dbDescriptor) continue;
        const distance = calculateEuclideanDistance(faceDescriptor, dbDescriptor);
        if (distance <= DUPLICATE_THRESHOLD) {
          throw new Error("Duplicate face detected. This biometric identity already belongs to another employee.");
        }
      }

      const encrypted = await encryptDescriptor(faceDescriptor);
      const { error: updateError } = await supabase
        .from('employees')
        .update({
          face_data: encrypted
        })
        .eq('id', empId);
      if (updateError) throw new Error(updateError.message);

      return { success: true, message: `Face biometrics successfully recorded for Employee ${empId}.` };
    }

    // 7. POST /employees/:id/reset-face (Clear facial template)
    const faceResetMatch = matchRoute(endpoint, '/employees/:id/reset-face');
    if (faceResetMatch && method === 'POST') {
      const empId = faceResetMatch.id;
      cache.employeesList = null; // Invalidate
      cache.employeeTemplates = null; // Invalidate
      delete cache.employees[empId]; // Invalidate

      const { error } = await supabase.from('employees').update({ face_data: null }).eq('id', empId);
      if (error) throw new Error(error.message);
      return { success: true, message: 'Biometric face descriptor removed successfully.' };
    }

    // 8. GET /settings (Fetch settings ledger)
    if (endpoint === '/settings' && method === 'GET') {
      if (cache.settings) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data, error } = await supabase.from('settings').select('*');
            if (!error && data) {
              const settingsObj = {};
              data.forEach(row => { settingsObj[row.key] = row.value; });
              if (Object.keys(settingsObj).length > 0) cache.settings = settingsObj;
            }
          } catch (e) {}
        }, 50);
        return { success: true, settings: cache.settings };
      }

      const { data, error } = await supabase.from('settings').select('*');
      if (error) throw new Error(error.message);
      const settingsObj = {};
      (data || []).forEach(row => {
        settingsObj[row.key] = row.value;
      });
      // Seed default fallbacks
      if (Object.keys(settingsObj).length === 0) {
        settingsObj['geofence_lat'] = '28.6139';
        settingsObj['geofence_lng'] = '77.2090';
        settingsObj['geofence_radius'] = '100';
      }
      cache.settings = settingsObj;
      return { success: true, settings: settingsObj };
    }

    // 9. POST /settings (Writhe settings ledger values)
    if (endpoint === '/settings' && method === 'POST') {
      cache.settings = null; // Invalidate
      const rows = Object.entries(body).map(([key, val]) => ({ key, value: String(val) }));
      const { error } = await supabase.from('settings').upsert(rows);
      if (error) throw new Error(error.message);
      return { success: true, message: 'Settings saved successfully.' };
    }

    // 10. GET /settings/geofence (Get polygon coordinates)
    if (endpoint === '/settings/geofence' && method === 'GET') {
      if (cache.geofence) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data } = await supabase
              .from('office_geofence')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (data) cache.geofence = data;
          } catch (e) {}
        }, 50);
        return { success: true, geofence: cache.geofence };
      }

      const { data, error } = await supabase
        .from('office_geofence')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      cache.geofence = data || null;
      return { success: true, geofence: data || null };
    }

    // 11. POST /settings/geofence (Add geofence polygon)
    if (endpoint === '/settings/geofence' && method === 'POST') {
      cache.geofence = null; // Invalidate
      const { 
        officeName, office_name,
        polygonCoordinates, polygon_coordinates,
        createdBy, created_by 
      } = body || {};

      const officeNameVal = (officeName || office_name || 'Main Office').trim();
      const polygonCoordsVal = polygonCoordinates || polygon_coordinates;
      const createdByVal = createdBy || created_by;

      if (!polygonCoordsVal || !Array.isArray(polygonCoordsVal) || polygonCoordsVal.length < 3) {
        throw new Error('Invalid polygon geometry. At least 3 points are required.');
      }

      const { error } = await supabase.from('office_geofence').insert({
        office_name: officeNameVal,
        polygon_coordinates: polygonCoordsVal,
        created_by: createdByVal || null
      });
      if (error) throw new Error(error.message);
      return { success: true, message: 'Office geofence polygon saved successfully.' };
    }


    // GET /attendance/challenge (Active challenge nonce generator)
    if ((cleanEndpointPath === '/attendance/challenge' || endpoint === '/attendance/challenge') && method === 'GET') {
      const challenges = ['blink', 'turn_left', 'turn_right'];
      const challengeType = challenges[Math.floor(Math.random() * challenges.length)];
      return {
        success: true,
        challengeSessionId: 'session_' + Math.random().toString(36).substring(2) + '_' + Date.now(),
        challengeType
      };
    }

    // 12. GET /attendance (Get unified check in records)
    if ((cleanEndpointPath === '/attendance' || endpoint === '/attendance') && method === 'GET') {
      if (cache.attendance) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data } = await supabase
              .from('attendance')
              .select('*, employees (name, department)')
              .order('date', { ascending: false })
              .order('check_in', { ascending: false });
            if (data) {
              const logs = data.map(item => ({
                ...item,
                name: item.employees?.name,
                department: item.employees?.department
              }));
              logs.forEach(item => delete item.employees);
              cache.attendance = logs;
            }
          } catch (e) {}
        }, 50);
        return { success: true, logs: cache.attendance };
      }

      const { data, error } = await supabase
        .from('attendance')
        .select('*, employees (name, department)')
        .order('date', { ascending: false })
        .order('check_in', { ascending: false });
      if (error) throw new Error(error.message);
      
      const logs = (data || []).map(item => ({
        ...item,
        name: item.employees?.name,
        department: item.employees?.department
      }));
      logs.forEach(item => delete item.employees);
      cache.attendance = logs;
      return { success: true, logs };
    }

    // 13. POST /attendance/clear (Wipe attendance ledger)
    if (endpoint === '/attendance/clear' && method === 'POST') {
      cache.attendance = null; // Invalidate
      cache.employeesList = null; // Invalidate
      cache.employees = {}; // Invalidate
      cache.logs = null; // Invalidate
      
      const { error: attErr } = await supabase.from('attendance').delete().neq('id', 0);
      if (attErr) throw new Error(attErr.message);

      const { error: empErr } = await supabase.from('employees').update({ status: 'Offline' }).neq('id', '0');
      if (empErr) throw new Error(empErr.message);

      return { success: true, message: 'All attendance records have been wiped successfully.' };
    }

    // 13b. GET /attendance/my-history (Employee's own attendance records — for Dashboard avg hours stat)
    // [VERCEL FIX]: This route was missing from api.js — added to fix Dashboard.jsx line 312
    if (endpoint === '/attendance/my-history' && method === 'GET') {
      if (!currentUser) throw new Error('Not authenticated.');
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', currentUser.id)
        .order('date', { ascending: false });
      if (error) throw new Error(error.message);
      return { success: true, history: data || [] };
    }

    // GET /logs (Fetch all logs with employee names)
    if (endpoint === '/logs' && method === 'GET') {
      if (cache.logs) {
        // Background refresh
        setTimeout(async () => {
          try {
            const { data } = await supabase
              .from('logs')
              .select('*, employees(name, department)')
              .order('timestamp', { ascending: false });
            if (data) {
              const formattedLogs = data.map(log => ({
                ...log,
                employee_name: log.employees?.name,
                name: log.employees?.name,
                department: log.employees?.department
              }));
              cache.logs = formattedLogs;
            }
          } catch (e) {}
        }, 50);
        return { success: true, logs: cache.logs };
      }

      const { data, error } = await supabase
        .from('logs')
        .select('*, employees(name, department)')
        .order('timestamp', { ascending: false });
      
      if (error) throw new Error(error.message);
      
      const formattedLogs = (data || []).map(log => ({
        ...log,
        employee_name: log.employees?.name,
        name: log.employees?.name,
        department: log.employees?.department
      }));
      cache.logs = formattedLogs;
      return { success: true, logs: formattedLogs };
    }

    // GET /logs/my-logs (Fetch personal logs for standard employee)
    if (endpoint === '/logs/my-logs' && method === 'GET') {
      // Synchronous LocalStorage session extraction
      const userStr = localStorage.getItem('quantum_user');
      const cachedUser = userStr ? JSON.parse(userStr) : null;
      const myEmail = cachedUser?.email;
      
      if (!myEmail) throw new Error('Not authenticated.');

      if (cache.myLogs[myEmail]) {
        // Background SWR refresh
        setTimeout(async () => {
          try {
            const { data: myEmp } = await supabase
              .from('employees')
              .select('id, name, department')
              .eq('email', myEmail)
              .single();
              
            if (myEmp) {
              const { data } = await supabase
                .from('logs')
                .select('*')
                .eq('employee_id', myEmp.id)
                .order('timestamp', { ascending: false });
                
              if (data) {
                const formattedLogs = data.map(log => ({
                  ...log,
                  employee_name: myEmp.name,
                  name: myEmp.name,
                  department: myEmp.department
                }));
                cache.myLogs[myEmail] = formattedLogs;
              }
            }
          } catch (e) {}
        }, 50);
        return { success: true, logs: cache.myLogs[myEmail] };
      }
      
      const { data: myEmp } = await supabase
        .from('employees')
        .select('id, name, department')
        .eq('email', myEmail)
        .single();
        
      if (!myEmp) throw new Error('Employee profile not found.');

      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .eq('employee_id', myEmp.id)
        .order('timestamp', { ascending: false });
        
      if (error) throw new Error(error.message);
      
      const formattedLogs = (data || []).map(log => ({
        ...log,
        employee_name: myEmp.name,
        name: myEmp.name,
        department: myEmp.department
      }));
      cache.myLogs[myEmail] = formattedLogs;
      return { success: true, logs: formattedLogs };
    }

    // GET /logs/audit or /audit (Fetch system diagnostic audit logs)
    if ((cleanEndpointPath === '/logs/audit' || cleanEndpointPath === '/audit' || endpoint.startsWith('/logs/audit') || endpoint.startsWith('/audit')) && method === 'GET') {
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      let rawLogs = [];
      try {
        const { data, error } = await supabase
          .from('audit_logs')
          .select('*, employees(name, department)')
          .order('timestamp', { ascending: false })
          .limit(500);

        if (!error && data && data.length > 0) {
          rawLogs = data.map(log => ({
            ...log,
            employee_name: log.employees?.name || log.employee_name || 'SYSTEM',
            department: log.employees?.department || log.department || 'Security & HR',
            ip_address: log.ip_address || '127.0.0.1',
            details: typeof log.details === 'object' ? JSON.stringify(log.details) : (log.details || '')
          }));
        }
      } catch (e) {
        console.warn('[AUDIT LOGS FETCH WARN]:', e);
      }

      // If audit_logs table is empty or error, fallback to logs table so records always render
      if (rawLogs.length === 0) {
        try {
          const { data, error } = await supabase
            .from('logs')
            .select('*, employees(name, department)')
            .order('timestamp', { ascending: false })
            .limit(500);

          if (!error && data) {
            rawLogs = data.map(log => ({
              ...log,
              employee_name: log.employees?.name || log.employee_name || 'SYSTEM',
              department: log.employees?.department || log.department || 'Security & HR',
              ip_address: log.ip_address || '127.0.0.1',
              details: typeof log.details === 'object' ? JSON.stringify(log.details) : (log.details || JSON.stringify({ status: log.event_type }))
            }));
          }
        } catch (e) {}
      }

      // Apply date filtering
      let filteredLogs = rawLogs;
      if (startDate) {
        const startTs = new Date(startDate).getTime();
        filteredLogs = filteredLogs.filter(l => new Date(l.timestamp).getTime() >= startTs);
      }
      if (endDate) {
        const endTs = new Date(endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`).getTime();
        filteredLogs = filteredLogs.filter(l => new Date(l.timestamp).getTime() <= endTs);
      }

      return { success: true, logs: filteredLogs };
    }

    // 14. POST /logs/clear (Clear event logs)
    if ((cleanEndpointPath === '/logs/clear' || endpoint === '/logs/clear') && method === 'POST') {
      cache.logs = null; // Invalidate
      cache.myLogs = {}; // Invalidate
      const { error } = await supabase.from('logs').delete().neq('id', 0);
      if (error) throw new Error(error.message);
      return { success: true, message: 'All event logs have been cleared successfully.' };
    }

    // 15. GET /attendance/history/:employeeId (Fetch history for employee)
    const histMatch = matchRoute(endpoint, '/attendance/history/:employeeId');
    if (histMatch && method === 'GET') {
      const empId = histMatch.employeeId;
      if (cache.attendanceHistory[empId]) {
        // Background SWR refresh
        setTimeout(async () => {
          try {
            const { data } = await supabase
              .from('attendance')
              .select('*')
              .eq('employee_id', empId)
              .order('date', { ascending: false });
            if (data) {
              cache.attendanceHistory[empId] = data;
            }
          } catch (e) {}
        }, 50);
        return { success: true, history: cache.attendanceHistory[empId] };
      }

      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', empId)
        .order('date', { ascending: false });
      if (error) throw new Error(error.message);
      cache.attendanceHistory[empId] = data || [];
      return { success: true, history: data || [] };
    }

    // 16. POST /employees/:id/coordinates (Update location and recalculate boundary)
    const coordMatch = matchRoute(endpoint, '/employees/:id/coordinates');
    if (coordMatch && method === 'POST') {
      const { latitude, longitude } = body;
      const empId = coordMatch.id;

      // Update coordinates
      const { error: updateErr } = await supabase.from('employees').update({ latitude, longitude }).eq('id', empId);
      if (updateErr) throw new Error(updateErr.message);

      // Fetch employee name
      const { data: emp, error: empErr } = await supabase.from('employees').select('name').eq('id', empId).single();
      if (empErr) throw new Error(empErr.message);

      // Retrieve settings for logging and fallback
      const { data: settingsData } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['geofence_lat', 'geofence_lng', 'geofence_radius']);
      
      const settingsObj = {};
      (settingsData || []).forEach(row => {
        settingsObj[row.key] = parseFloat(row.value);
      });

      const officeLat = settingsObj.geofence_lat || 28.6139;
      const officeLng = settingsObj.geofence_lng || 77.2090;
      const radius = settingsObj.geofence_radius || 100; // Default to 100m geofence

      // Retrieve polygon geofence
      const { data: activeGeofence } = await supabase
        .from('office_geofence')
        .select('polygon_coordinates')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let insidePolygon = false;
      let polygonBased = false;
      let loadedPolygon = null;

      if (activeGeofence && activeGeofence.polygon_coordinates) {
        try {
          loadedPolygon = typeof activeGeofence.polygon_coordinates === 'string'
            ? JSON.parse(activeGeofence.polygon_coordinates)
            : activeGeofence.polygon_coordinates;

          // Highly defensive coordinate normalization
          const normalizedPolygon = (Array.isArray(loadedPolygon) ? loadedPolygon : []).map(p => {
            if (!p || typeof p !== 'object') return null;
            const lat = p.lat !== undefined ? p.lat : p.latitude;
            const lng = p.lng !== undefined ? p.lng : p.longitude;
            return { lat: parseFloat(lat), lng: parseFloat(lng) };
          }).filter(p => p !== null && !isNaN(p.lat) && !isNaN(p.lng));

          insidePolygon = isPointInPolygon(latitude, longitude, normalizedPolygon);
          polygonBased = true;

          // 50-meter tolerance check if outside polygon
          if (!insidePolygon) {
            const polyDist = getDistanceToPolygon(latitude, longitude, normalizedPolygon);
            if (polyDist <= 50) {
              insidePolygon = true;
            }
          }
        } catch (e) {
          console.error('[GEOFENCE PARSE ERROR]', e);
        }
      }

      // Legacy circular distance check (+50m buffer)
      const distance = calculateDistance(latitude, longitude, officeLat, officeLng);
      const insideRadius = distance <= (radius + 50);

      // Full GPS Debug Logging
      console.log('====================================================');
      console.log('[GEOFENCE COORDINATES UPDATE]');
      console.log('USER LAT:', latitude);
      console.log('USER LNG:', longitude);
      console.log('OFFICE LAT:', officeLat);
      console.log('OFFICE LNG:', officeLng);
      console.log('SETTINGS RADIUS:', settingsObj.geofence_radius);
      console.log('ACTIVE VALIDATION RADIUS:', radius);
      console.log('insidePolygon:', insidePolygon);
      console.log('insideRadius (with 50m buffer):', insideRadius);
      console.log('distance:', distance);
      console.log('allowedRadius:', radius);
      console.log('Loaded polygon:', loadedPolygon);
      console.log('====================================================');

      let isInside = false;
      if (polygonBased) {
        isInside = insidePolygon || insideRadius; // Fallback safety layer
      } else {
        isInside = insideRadius;
      }

      // Temp Test Override (default to false, check test injection)
      const BYPASS_GEOFENCE = typeof window !== 'undefined' && window.__BYPASS_GEOFENCE__ !== undefined ? window.__BYPASS_GEOFENCE__ : false;
      console.log('[GEOFENCE COORDINATES UPDATE] Bypass Status:', BYPASS_GEOFENCE);
      if (BYPASS_GEOFENCE) {
        isInside = true;
      }

      const status = isInside ? 'Online' : 'Outside Office Limit';
      await supabase.from('employees').update({ status }).eq('id', empId);

      // Broadcast new status
      broadcastRealtimeEvent('employee:status', {
        id: empId,
        name: emp.name,
        status,
        latitude,
        longitude
      });

      return {
        success: true,
        data: {
          latitude,
          longitude,
          isInside,
          distance,
          radius,
          polygonBased,
          officeLatitude: officeLat,
          officeLongitude: officeLng
        }
      };
    }

    // 17. POST /employees/reset-db (Database seeder engine client-side)
    if (endpoint === '/employees/reset-db' && method === 'POST') {
      // SECURITY SAFEGUARD: Never wipe a live production/cloud Supabase database client-side
      const isCloudSupabase = supabaseUrl && supabaseUrl.includes('.supabase.co') && 
                              !supabaseUrl.includes('placeholder.supabase.co') && 
                              !supabaseUrl.includes('localhost') && 
                              !supabaseUrl.includes('127.0.0.1');
      if (isCloudSupabase) {
        const errorMsg = `[DATABASE RESET REJECTED]: Refusing to purge database tables on a cloud/live Supabase instance (${supabaseUrl}) to protect production data.`;
        console.error(errorMsg);
        throw new Error('Database reset is disabled on live cloud databases to protect production data.');
      }

      console.log('[DATABASE RESET REQUESTED]: Purging tables...');
      cache.employees = {};
      cache.employeesList = null;
      cache.settings = null;
      cache.geofence = null;
      cache.attendance = null;
      cache.logs = null;
      cache.myLogs = {};
      cache.attendanceHistory = {};
      await supabase.from('logs').delete().neq('id', 0);
      await supabase.from('attendance').delete().neq('id', 0);
      await supabase.from('employees').delete().neq('id', '0');
      await supabase.from('settings').delete().neq('key', '');

      await supabase.from('settings').upsert([
        { key: 'geofence_lat', value: '28.6139' },
        { key: 'geofence_lng', value: '77.2090' },
        { key: 'geofence_radius', value: '100' }
      ]);

      const tempClient = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });

      console.log('[SEEDING]: Creating default Admin in Supabase Auth...');
      const { error: adminErr } = await tempClient.auth.signUp({
        email: 'hr.orbitengineering.group@gmail.com',
        password: 'admin@2026',
        options: { data: { name: 'Administrator', role: 'admin', department: 'Security & HR' } }
      });

      if (!adminErr || adminErr.message.includes('already registered')) {
        const desc = [];
        const lower = 'administrator';
        for (let i = 0; i < 128; i++) {
          let charVal = lower.charCodeAt(i % lower.length) / 128.0;
          desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
        }
        const adminFace = await encryptDescriptor(desc);

        await supabase.from('employees').insert({
          id: 'OES/001',
          name: 'Administrator',
          email: 'hr.orbitengineering.group@gmail.com',
          password: 'admin@2026',
          role: 'admin',
          department: 'Security & HR',
          face_data: adminFace,
          status: 'Offline'
        });
        console.log('[SEEDING]: Admin seeded successfully.');
      }

      console.log('[SEEDING]: Creating default Employee in Supabase Auth...');
      const { error: empErr } = await tempClient.auth.signUp({
        email: 'employee@company.com',
        password: 'employeepassword',
        options: { data: { name: 'Standard Employee', role: 'employee', department: 'Engineering' } }
      });

      if (!empErr || empErr.message.includes('already registered')) {
        const desc = [];
        const lower = 'standard employee';
        for (let i = 0; i < 128; i++) {
          let charVal = lower.charCodeAt(i % lower.length) / 128.0;
          desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
        }
        const empFace = await encryptDescriptor(desc);

        await supabase.from('employees').insert({
          id: 'OES/038',
          name: 'Standard Employee',
          email: 'employee@company.com',
          password: 'employeepassword',
          role: 'employee',
          department: 'Engineering',
          face_data: null,
          status: 'Offline'
        });
        console.log('[SEEDING]: Employee seeded successfully with NO face data.');
      }

      return { success: true, message: 'Database reset successfully and default accounts re-seeded.' };
    }

    // 18. POST /attendance/scan (Face recognition kiosk scan engine client-side)
    if (endpoint === '/attendance/scan' && method === 'POST') {
      cache.attendance = null;
      cache.logs = null;
      cache.myLogs = {};
      cache.attendanceHistory = {};
      const { faceDescriptor, faceMetrics, location, userCoords, action } = body;
      
      console.log('[BIOMETRIC SCAN INTERCEPT]: Received scan request');
      console.log('[BIOMETRIC SCAN INTERCEPT]: Incoming descriptor type:', typeof faceDescriptor, 'isArray:', Array.isArray(faceDescriptor));
      if (faceDescriptor && Array.isArray(faceDescriptor)) {
        console.log('[BIOMETRIC SCAN INTERCEPT]: Incoming descriptor dimensions:', faceDescriptor.length);
        console.log('[BIOMETRIC SCAN INTERCEPT]: Incoming descriptor snippet:', faceDescriptor.slice(0, 5));
      }

      if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
        throw new Error('Invalid or missing biometric descriptor.');
      }
      if (faceDescriptor.length !== 128) {
        throw new Error(`Invalid biometric face descriptor dimension: expected 128, got ${faceDescriptor.length}`);
      }

      // Enforce face ownership: Compare captured face descriptor ONLY against the enrolled descriptor of the currently authenticated employee.
      if (!currentUser) {
        throw new Error('Access denied. No active authenticated session found.');
      }

      console.log(`[BIOMETRIC SCAN INTERCEPT]: Querying biometric data for authenticated employee ID: ${currentUser.id}`);
      const { data: currentDbEmp, error: fetchErr } = await supabase
        .from('employees')
        .select('id, name, department, face_data')
        .eq('id', currentUser.id)
        .single();

      if (fetchErr || !currentDbEmp) {
        console.error('[BIOMETRIC SCAN INTERCEPT ERROR]: Failed fetching authenticated employee profile:', fetchErr);
        throw new Error('Authenticated employee profile not found in database.');
      }

      if (!currentDbEmp.face_data) {
        const error = new Error('No enrolled biometrics found for this account. Please enroll your face first.');
        error.voiceMessage = 'Access denied. Please enroll your face first.';
        throw error;
      }

      let dbDescriptor = null;
      try {
        dbDescriptor = await decryptDescriptor(currentDbEmp.face_data);
      } catch (decErr) {
        console.error('[BIOMETRIC SCAN INTERCEPT ERROR]: Decryption exception:', decErr);
      }

      if (!dbDescriptor) {
        throw new Error('Enrolled biometrics signature is corrupt.');
      }

      const faceDistance = calculateEuclideanDistance(faceDescriptor, dbDescriptor);
      const threshold = 0.70;
      const isMatch = faceDistance <= threshold;
      const confidence = faceDistance !== Infinity ? Math.max(0, 1 - faceDistance) : 0;

      console.log(`[BIOMETRIC SCAN INTERCEPT]: Matching live scan against ${currentDbEmp.name} (ID: ${currentDbEmp.id}). Distance: ${faceDistance.toFixed(4)}, Threshold: ${threshold}`);

      if (!isMatch) {
        console.warn(`[BIOMETRIC SCAN INTERCEPT MATCH FAILURE]: Distance ${faceDistance.toFixed(4)} exceeds threshold ${threshold}`);

        // Insert UNAUTHORIZED_SCAN log tied to the logged-in employee (ownership breach)
        await supabase.from('logs').insert({
          employee_id: currentDbEmp.id,
          event_type: 'UNAUTHORIZED_SCAN',
          location: location || 'Front Desk Camera',
          details: JSON.stringify({ confidence, error: 'Face biometrics ownership mismatch' })
        });

        // Broadcast to Dashboard log feed & Alerts
        const alertData = {
          timestamp: new Date().toISOString(),
          location: location || 'Front Desk Camera',
          confidence
        };
        broadcastRealtimeEvent('unauthorized:alert', alertData);
        
        broadcastRealtimeEvent('logs:new', {
          employee_id: currentDbEmp.id,
          event_type: 'UNAUTHORIZED_SCAN',
          timestamp: new Date().toISOString(),
          location: location || 'Front Desk Camera',
          name: currentDbEmp.name,
          details: JSON.stringify({ confidence, error: 'Face biometrics ownership mismatch' })
        });

        const voiceMessage = `Access denied. Biometrics mismatch. Captured face does not belong to logged in account for ${currentDbEmp.name}.`;
        const error = new Error(`Face Mismatch: Captured face does not belong to employee account ${currentDbEmp.name}.`);
        error.voiceMessage = voiceMessage;
        throw error;
      }

      const employeeId = currentDbEmp.id;
      const name = currentDbEmp.name;
      const department = currentDbEmp.department;
      console.log(`[BIOMETRIC SCAN INTERCEPT MATCH SUCCESS]: Scanned person successfully validated as ${name} (${employeeId}) with confidence ${confidence.toFixed(4)}`);

      // Anti-spoofing check
      const liveness = verifyLiveness(faceMetrics);
      if (!liveness.passed) {
        console.warn(`[BIOMETRIC SCAN INTERCEPT SECURITY]: Liveness check failed for ${name}`);
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'SPOOF_ATTEMPT',
          location: location || 'Front Desk Camera',
          details: `Flagged biometric anti-spoof check: spoof coefficient ${faceMetrics?.spoofIndex || 0.9}`
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'SPOOF_ATTEMPT',
          timestamp: new Date().toISOString(),
          location: location || 'Front Desk Camera',
          name,
          details: 'Flagged biometric anti-spoof check.'
        });

        const error = new Error('Biometric Scanner Blocked: Anti-Spoof Check Flagged.');
        error.voiceMessage = `Access denied. Anti-spoofing alert triggered for ${name}.`;
        throw error;
      }

      // GPS Coordinates Check
      const userLat = parseFloat(userCoords?.latitude);
      const userLng = parseFloat(userCoords?.longitude);

      if (!userCoords || isNaN(userLat) || isNaN(userLng) || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'GPS_ERROR',
          location: location || 'Front Desk Camera',
          details: 'Attendance rejected: Missing or invalid GPS telemetry.'
        });
        
        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'GPS_ERROR',
          timestamp: new Date().toISOString(),
          location: location || 'Front Desk Camera',
          name,
          details: 'Missing GPS telemetry.'
        });

        throw new Error('Location access is required for attendance validation. Missing GPS coordinates.');
      }

      // Timezone check
      const clientTimezone = body.timezone || null;
      const allowedTimezones = ['Asia/Kolkata', 'Asia/Calcutta'];
      if (clientTimezone && !allowedTimezones.includes(clientTimezone)) {
        console.warn(`[GEOFENCE WARNING] Timezone mismatch: Client is ${clientTimezone}, expected Asia/Kolkata or Asia/Calcutta.`);
        throw new Error('Incorrect timezone configuration. Access denied.');
      }

      // 1. Fetch Geofence Circular / Radius Settings First for circular fallback and logging
      const { data: settingsData } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['geofence_lat', 'geofence_lng', 'geofence_radius']);
      
      const settingsObj = {};
      (settingsData || []).forEach(row => {
        settingsObj[row.key] = parseFloat(row.value);
      });

      const officeLat = settingsObj.geofence_lat || 28.6139;
      const officeLng = settingsObj.geofence_lng || 77.2090;
      const radius = settingsObj.geofence_radius || 100; // Default to 100m geofence

      // 2. Retrieve advanced Polygon Geofence
      const { data: activeGeofence } = await supabase
        .from('office_geofence')
        .select('polygon_coordinates')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let insidePolygon = false;
      let polygonBased = false;
      let loadedPolygon = null;

      if (activeGeofence && activeGeofence.polygon_coordinates) {
        try {
          loadedPolygon = typeof activeGeofence.polygon_coordinates === 'string'
            ? JSON.parse(activeGeofence.polygon_coordinates)
            : activeGeofence.polygon_coordinates;

          // Highly defensive coordinate normalization
          const normalizedPolygon = (Array.isArray(loadedPolygon) ? loadedPolygon : []).map(p => {
            if (!p || typeof p !== 'object') return null;
            const lat = p.lat !== undefined ? p.lat : p.latitude;
            const lng = p.lng !== undefined ? p.lng : p.longitude;
            return { lat: parseFloat(lat), lng: parseFloat(lng) };
          }).filter(p => p !== null && !isNaN(p.lat) && !isNaN(p.lng));

          insidePolygon = isPointInPolygon(userLat, userLng, normalizedPolygon);
          polygonBased = true;

          // 50-meter tolerance check if outside polygon
          if (!insidePolygon) {
            const polyDist = getDistanceToPolygon(userLat, userLng, normalizedPolygon);
            if (polyDist <= 50) {
              insidePolygon = true;
            }
          }
        } catch (e) {
          console.error('[GEOFENCE PARSE ERROR]', e);
        }
      }

      // Legacy circular distance check (+50m buffer)
      const distance = calculateDistance(userLat, userLng, officeLat, officeLng);
      const insideRadius = distance <= (radius + 50);

      // 3. Full GPS Debug Logging
      console.log('====================================================');
      console.log('[GEOFENCE VALIDATION]');
      console.log('USER LAT:', userLat);
      console.log('USER LNG:', userLng);
      console.log('OFFICE LAT:', officeLat);
      console.log('OFFICE LNG:', officeLng);
      console.log('SETTINGS RADIUS:', settingsObj.geofence_radius);
      console.log('ACTIVE VALIDATION RADIUS:', radius);
      console.log('insidePolygon:', insidePolygon);
      console.log('insideRadius (with 50m buffer):', insideRadius);
      console.log('distance:', distance);
      console.log('allowedRadius:', radius);
      console.log('Loaded polygon:', loadedPolygon);
      console.log('====================================================');

      // 4. Evaluate Geofence Check with Safe Fallback circular validation
      let isInside = false;
      if (polygonBased) {
        isInside = insidePolygon || insideRadius; // Radius validation acts as fallback safety layer
      } else {
        isInside = insideRadius;
      }

      // 4b. Velocity Check (Only if inside geofence)
      if (isInside) {
        const prevLatStr = localStorage.getItem(`__LAST_LAT_${employeeId}__`);
        const prevLngStr = localStorage.getItem(`__LAST_LNG_${employeeId}__`);
        const prevTimeStr = localStorage.getItem(`__LAST_TIME_${employeeId}__`);
        
        if (prevLatStr && prevLngStr && prevTimeStr) {
          const prevLat = parseFloat(prevLatStr);
          const prevLng = parseFloat(prevLngStr);
          const prevTime = parseInt(prevTimeStr, 10);
          const nowTime = Date.now();
          const timeDelta = (nowTime - prevTime) / 1000;
          
          if (timeDelta > 0 && timeDelta < 7200) {
            const dist = calculateDistance(userLat, userLng, prevLat, prevLng);
            const speedKmh = (dist / timeDelta) * 3.6;
            console.log(`[CLIENT VELOCITY CHECK] Distance: ${dist}m, Time Delta: ${timeDelta}s, Speed: ${speedKmh} km/h`);
            if (speedKmh > 150 && typeof window !== 'undefined' && !window.__MOCK_BIOMETRICS__) {
              console.warn(`[CLIENT VELOCITY BREACH] Impossible speed: ${speedKmh.toFixed(2)} km/h`);
              throw new Error('Biometric Scanner Blocked: Impossible location travel velocity detected.');
            }
          }
        }
        
        localStorage.setItem(`__LAST_LAT_${employeeId}__`, String(userLat));
        localStorage.setItem(`__LAST_LNG_${employeeId}__`, String(userLng));
        localStorage.setItem(`__LAST_TIME_${employeeId}__`, String(Date.now()));
      }

      // Temp Test Override (default to false, check test injection)
      const BYPASS_GEOFENCE = typeof window !== 'undefined' && window.__BYPASS_GEOFENCE__ !== undefined ? window.__BYPASS_GEOFENCE__ : false;
      console.log('[GEOFENCE VALIDATION] Bypass Geofence Status:', BYPASS_GEOFENCE);
      if (BYPASS_GEOFENCE) {
        console.log('[GEOFENCE OVERRIDE ACTIVE] Forcing isInside to true.');
        isInside = true;
      }

      if (!isInside) {
        const breachDetails = polygonBased
          ? 'Geofence breach: employee outside mapped office polygon boundary.'
          : `Geofence breach: employee outside by ${Math.round(distance - radius)}m (Distance: ${Math.round(distance)}m).`;

        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'GEOFENCE_VIOLATION',
          location: location || 'Front Desk Camera',
          details: breachDetails
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'GEOFENCE_VIOLATION',
          timestamp: new Date().toISOString(),
          location: location || 'Front Desk Camera',
          name,
          details: breachDetails
        });

        broadcastRealtimeEvent('employee:status', {
          id: employeeId,
          name,
          status: 'Outside Office Limit',
          latitude: userLat,
          longitude: userLng
        });

        const error = new Error('You are outside office premises.');
        error.details = { polygonBased, distance, allowedRadius: radius };
        throw error;
      }

      // Mark Attendance
      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();
      const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

      const { data: attRecord } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', today)
        .maybeSingle();

      // Explicit Action Validation Safeguards
      if (action === 'CHECK_IN') {
        if (attRecord) {
          throw new Error('You have already checked in for today.');
        }
      } else if (action === 'CHECK_OUT') {
        if (!attRecord) {
          throw new Error('You must check in first before checking out.');
        }
        if (attRecord.check_out) {
          throw new Error('You have already checked out for today.');
        }
      }

      let eventType = 'CHECK_IN';
      let responseMessage = '';
      let lateMinutes = 0;
      let workingHours = 0;

      if (!attRecord) {
        // Mark Check-In
        const checkInHour = new Date().getHours();
        const checkInMinute = new Date().getMinutes();
        const isLate = checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0);
        const status = isLate ? 'Late Arrival' : 'On Time';
        
        if (isLate) {
          lateMinutes = (checkInHour - 10) * 60 + checkInMinute;
        }

        const { error: insertErr } = await supabase.from('attendance').insert({
          employee_id: employeeId,
          date: today,
          check_in: timeString,
          working_hours: 0,
          status
        });
        if (insertErr) throw new Error(insertErr.message);

        await supabase.from('employees').update({ status: 'Online', latitude: userLat, longitude: userLng }).eq('id', employeeId);

        const logMsg = isLate 
          ? `Checked In late by ${lateMinutes} minutes (${timeString}).`
          : `Checked In on time (${timeString}).`;

        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_IN',
          location: location || 'Front Desk Camera',
          details: logMsg
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'CHECK_IN',
          timestamp: now,
          location: location || 'Front Desk Camera',
          name,
          details: logMsg
        });

        broadcastRealtimeEvent('employee:status', {
          id: employeeId,
          name,
          status: 'Online',
          latitude: userLat,
          longitude: userLng
        });

        responseMessage = isLate
          ? `Welcome, ${name}. You are checked in. Late by ${lateMinutes} minutes.`
          : `Welcome, ${name}. You are checked in on time.`;

        // Voice Greeting formatting
        const checkInTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let voiceMessage = `Welcome ${name}. Check-in time: ${checkInTimeStr}.`;
        if (isLate) {
          voiceMessage += ` You are ${lateMinutes} minutes late.`;
        }

        return {
          success: true,
          message: responseMessage,
          employee: { id: employeeId, name, department },
          eventType,
          lateDuration: isLate ? `${lateMinutes} mins` : 'On Time',
          isLate,
          voiceMessage
        };

      } else {
        // Mark Check-Out
        eventType = 'CHECK_OUT';

        const parseTime = (t) => {
          if (!t) return new Date();
          const [h, m] = t.split(':').map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          return d;
        };

        const checkInDate = parseTime(attRecord.check_in);
        const checkOutDate = new Date();
        const diffMs = checkOutDate - checkInDate;
        workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

        const checkOutTimeString = checkOutDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        const { error: updateErr } = await supabase
          .from('attendance')
          .update({
            check_out: checkOutTimeString,
            working_hours: workingHours
          })
          .eq('id', attRecord.id);
        if (updateErr) throw new Error(updateErr.message);

        await supabase.from('employees').update({ status: 'Offline', latitude: userLat, longitude: userLng }).eq('id', employeeId);

        const logMsg = `Checked Out at ${checkOutTimeString}. Worked: ${workingHours} hrs.`;
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_OUT',
          location: location || 'Front Desk Camera',
          details: logMsg
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'CHECK_OUT',
          timestamp: now,
          location: location || 'Front Desk Camera',
          name,
          details: logMsg
        });

        broadcastRealtimeEvent('employee:status', {
          id: employeeId,
          name,
          status: 'Offline',
          latitude: userLat,
          longitude: userLng
        });

        responseMessage = `Goodbye, ${name}. Checked out successfully. Time worked: ${workingHours} hours.`;
        
        // Voice Greeting formatting
        const checkOutTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const voiceMessage = `Goodbye ${name}. Check-out time: ${checkOutTimeStr}.`;

        return {
          success: true,
          message: responseMessage,
          employee: { id: employeeId, name, department },
          eventType,
          workingHours,
          voiceMessage
        };
      }
    }

    // 19. POST /attendance/public-scan (Public Kiosk Attendance Scanner Handler)
    if (endpoint === '/attendance/public-scan' && method === 'POST') {
      cache.attendance = null;
      cache.logs = null;
      cache.myLogs = {};
      cache.attendanceHistory = {};
      const { faceDescriptor, faceMetrics, location, userCoords } = body;

      if (!faceDescriptor || !Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
        throw new Error('Invalid or missing biometric descriptor.');
      }

      // Fetch all employees with registered face_data
      const { data: employeesWithFace, error: fetchErr } = await supabase
        .from('employees')
        .select('id, name, department, avatar, face_data')
        .not('face_data', 'is', null);

      if (fetchErr || !employeesWithFace || employeesWithFace.length === 0) {
        throw new Error('No registered employees found with face biometrics in system database.');
      }

      // Match face against all registered templates
      let bestMatch = null;
      let minDistance = Infinity;
      const MATCH_THRESHOLD = 0.68;

      for (const emp of employeesWithFace) {
        const dbDescriptor = await decryptDescriptor(emp.face_data);
        if (!dbDescriptor) continue;

        const distance = calculateEuclideanDistance(faceDescriptor, dbDescriptor);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = emp;
        }
      }

      if (!bestMatch || minDistance > MATCH_THRESHOLD) {
        console.warn(`[PUBLIC SCAN MISMATCH]: Minimum distance ${minDistance.toFixed(4)} exceeds threshold ${MATCH_THRESHOLD}`);
        
        await supabase.from('logs').insert({
          employee_id: null,
          event_type: 'UNAUTHORIZED_SCAN',
          location: location || 'Public Terminal',
          details: `Unrecognized face scan attempt (Best match distance: ${minDistance.toFixed(4)})`
        });

        const error = new Error('Face Not Recognized. Please contact Administrator.');
        error.reason = 'FACE_NOT_RECOGNIZED';
        throw error;
      }

      const matchedEmployee = bestMatch;
      const employeeId = matchedEmployee.id;
      const name = matchedEmployee.name;
      const department = matchedEmployee.department;
      const avatar = matchedEmployee.avatar;

      console.log(`[PUBLIC SCAN MATCH SUCCESS]: Scanned face matched with ${name} (${employeeId}) - Distance: ${minDistance.toFixed(4)}`);

      // Anti-spoof check
      const liveness = verifyLiveness(faceMetrics);
      if (!liveness.passed) {
        throw new Error('Biometric Scanner Blocked: Anti-Spoof Check Flagged.');
      }

      // Geofence check
      const userLat = parseFloat(userCoords?.latitude);
      const userLng = parseFloat(userCoords?.longitude);

      let isInside = true;
      if (userCoords && !isNaN(userLat) && !isNaN(userLng)) {
        const { data: settingsData } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['geofence_lat', 'geofence_lng', 'geofence_radius']);
        
        const settingsObj = {};
        (settingsData || []).forEach(row => {
          settingsObj[row.key] = parseFloat(row.value);
        });

        const officeLat = settingsObj.geofence_lat || 28.6139;
        const officeLng = settingsObj.geofence_lng || 77.2090;
        const radius = settingsObj.geofence_radius || 100;

        const distance = calculateDistance(userLat, userLng, officeLat, officeLng);
        isInside = distance <= (radius + 50);

        const BYPASS_GEOFENCE = typeof window !== 'undefined' && window.__BYPASS_GEOFENCE__ !== undefined ? window.__BYPASS_GEOFENCE__ : false;
        if (BYPASS_GEOFENCE) isInside = true;

        if (!isInside) {
          await supabase.from('logs').insert({
            employee_id: employeeId,
            event_type: 'GEOFENCE_VIOLATION',
            location: location || 'Public Terminal',
            details: `Public Kiosk Geofence breach: employee outside by ${Math.round(distance - radius)}m.`
          });
          throw new Error('Access Denied: You are outside office premises geofence.');
        }
      }

      // Mark Attendance
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const displayTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const displayDateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' });

      const { data: attRecord } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', today)
        .maybeSingle();

      let eventType = 'CHECK_IN';
      let responseMessage = '';

      if (!attRecord) {
        // Mark Check-In
        const checkInHour = now.getHours();
        const checkInMinute = now.getMinutes();
        const isLate = checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0);
        const status = isLate ? 'Late Arrival' : 'On Time';
        const lateMinutes = isLate ? (checkInHour - 10) * 60 + checkInMinute : 0;

        const { error: insertErr } = await supabase.from('attendance').insert({
          employee_id: employeeId,
          date: today,
          check_in: timeString,
          working_hours: 0,
          status
        });
        if (insertErr) throw new Error(insertErr.message);

        await supabase.from('employees').update({ status: 'Online', latitude: userLat || 0, longitude: userLng || 0 }).eq('id', employeeId);

        const logMsg = isLate 
          ? `Public Scan Checked In late by ${lateMinutes} mins.`
          : `Public Scan Checked In on time.`;

        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_IN',
          location: location || 'Public Terminal',
          details: logMsg
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'CHECK_IN',
          timestamp: now.toISOString(),
          location: location || 'Public Terminal',
          name,
          details: logMsg
        });

        responseMessage = isLate 
          ? `Welcome ${name}. Checked in (Late by ${lateMinutes} mins).`
          : `Welcome ${name}. Checked in successfully on time.`;

        return {
          success: true,
          message: responseMessage,
          employee: { id: employeeId, name, department, avatar },
          eventType,
          date: displayDateStr,
          time: displayTimeStr,
          alreadyCompleted: false
        };
      } else if (!attRecord.check_out) {
        // Mark Check-Out
        eventType = 'CHECK_OUT';
        const parseTime = (t) => {
          if (!t) return new Date();
          const [h, m] = t.split(':').map(Number);
          const d = new Date();
          d.setHours(h, m, 0, 0);
          return d;
        };

        const checkInDate = parseTime(attRecord.check_in);
        const diffMs = now - checkInDate;
        const workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

        const { error: updateErr } = await supabase
          .from('attendance')
          .update({
            check_out: timeString,
            working_hours: workingHours
          })
          .eq('id', attRecord.id);
        if (updateErr) throw new Error(updateErr.message);

        await supabase.from('employees').update({ status: 'Offline', latitude: userLat || 0, longitude: userLng || 0 }).eq('id', employeeId);

        const logMsg = `Public Scan Checked Out at ${timeString}. Worked: ${workingHours} hrs.`;
        await supabase.from('logs').insert({
          employee_id: employeeId,
          event_type: 'CHECK_OUT',
          location: location || 'Public Terminal',
          details: logMsg
        });

        broadcastRealtimeEvent('logs:new', {
          employee_id: employeeId,
          event_type: 'CHECK_OUT',
          timestamp: now.toISOString(),
          location: location || 'Public Terminal',
          name,
          details: logMsg
        });

        return {
          success: true,
          message: `Goodbye ${name}. Checked out successfully (${workingHours} hrs).`,
          employee: { id: employeeId, name, department, avatar },
          eventType,
          date: displayDateStr,
          time: displayTimeStr,
          alreadyCompleted: false
        };
      } else {
        // Attendance already completed for today
        return {
          success: true,
          message: `Attendance already completed for today, ${name}.`,
          employee: { id: employeeId, name, department, avatar },
          date: displayDateStr,
          time: displayTimeStr,
          alreadyCompleted: true
        };
      }
    }

    throw new Error(`Route handler not mapped client-side: ${method} ${endpoint}`);
  } catch (error) {
    console.error(`[API CALL EXCEPTION INTERCEPTED] URL: ${endpoint}`, error);
    throw error;
  }
};

if (typeof window !== 'undefined') {
  window.apiCall = apiCall;
}
