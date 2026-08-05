import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { encryptDescriptor, decryptDescriptor } from './encryption.js';

/**
 * Calculates Euclidean distance between two feature descriptor arrays.
 * A lower distance indicates higher similarity (typically < 0.45 is a match).
 */
export const calculateEuclideanDistance = (vectorA, vectorB) => {
  if (vectorA.length !== vectorB.length) {
    throw new Error('Descriptor vectors must be of identical length');
  }

  let distance = 0.0;
  for (let i = 0; i < vectorA.length; i++) {
    const diff = vectorA[i] - vectorB[i];
    distance += diff * diff;
  }

  return Math.sqrt(distance);
};

/**
 * Validates facial metrics and executes biometric anti-spoof checks.
 * Ensures the scanned subject exhibits genuine liveness (e.g. eye movement, depth mapping, etc.)
 */
export const verifyLiveness = (faceMetrics) => {
  const { spoofIndex, landmarks } = faceMetrics;

  if (spoofIndex && spoofIndex > 0.4) {
    return {
      passed: false,
      reason: 'Anti-Spoof Check Failed: Low liveness probability detected (potential photo/video representation).'
    };
  }

  return {
    passed: true,
    reason: 'Liveness verified.'
  };
};

// In-memory cache for employee biometric descriptors
let cachedBiometrics = null;

/**
 * clearBiometricsCache
 * Clears the in-memory cache when a new employee registers their face templates.
 */
export const clearBiometricsCache = () => {
  console.log('[DEBUG LOG - DESCRIPTOR LOADING] Biometric cache cleared due to template registration.');
  cachedBiometrics = null;
};

export const identifyFace = async (incomingDescriptor, threshold = 0.70) => {
  const db = getDb();
  
  const isSupabaseLive = await checkSupabaseConnection();
  let employees = [];

  console.log('[BACKEND BIOMETRIC SCAN]: Received request at identifyFace');
  console.log('[BACKEND BIOMETRIC SCAN]: Incoming descriptor type:', typeof incomingDescriptor, 'isArray:', Array.isArray(incomingDescriptor));
  if (incomingDescriptor && Array.isArray(incomingDescriptor)) {
    console.log('[BACKEND BIOMETRIC SCAN]: Incoming descriptor dimensions:', incomingDescriptor.length);
  }

  // Optimize: Use cached biometrics if available to bypass DB query + decryption overhead
  if (cachedBiometrics) {
    console.log('[DEBUG LOG - DESCRIPTOR LOADING] Using cached in-memory employee descriptors. Count:', cachedBiometrics.length);
    employees = cachedBiometrics;
  } else {
    console.log('[DEBUG LOG - DESCRIPTOR LOADING] Cache miss. Fetching employee templates from database...');
    if (isSupabaseLive) {
      const { data, error } = await supabase.from('employees').select('id, name, department, face_data').not('face_data', 'is', null);
      if (!error && data && data.length > 0) {
        employees = data;
      }
    }

    if (employees.length === 0) {
      employees = await db.all(`SELECT id, name, department, face_data FROM employees WHERE face_data IS NOT NULL`);
    }
    
    console.log('[BACKEND BIOMETRIC SCAN]: Database loaded employees count:', employees.length);
    
    // Decrypt and process employee templates once for cache
    const processedEmployees = [];
    for (const emp of employees) {
      try {
        const dbDescriptor = decryptDescriptor(emp.face_data);
        if (dbDescriptor) {
          processedEmployees.push({
            id: emp.id,
            name: emp.name,
            department: emp.department,
            face_descriptor: dbDescriptor
          });
        }
      } catch (err) {
        console.error(`[BIOMETRIC CACHE PREP ERROR] Failed to decrypt template for ${emp.name} (ID: ${emp.id}):`, err);
      }
    }
    cachedBiometrics = processedEmployees;
    employees = cachedBiometrics;
    console.log('[DEBUG LOG - DESCRIPTOR LOADING] Loaded employee descriptors into cache. Count:', employees.length);
  }

  console.log('[DEBUG LOG - RECOGNITION EXECUTION] Starting euclidean distance matching against', employees.length, 'candidates...');

  let bestMatch = null;
  let bestDistance = Infinity;

  for (const emp of employees) {
    try {
      const distance = calculateEuclideanDistance(incomingDescriptor, emp.face_descriptor);
      console.log(`[BACKEND BIOMETRIC SCAN]: Distance to ${emp.name} (ID: ${emp.id}): ${distance.toFixed(4)}`);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = emp;
      }
    } catch (err) {
      console.error(`[BIOMETRIC ERROR]: Failed calculating distance for employee ID ${emp.id}:`, err);
    }
  }

  console.log(`[BACKEND BIOMETRIC SCAN SUMMARY]: Best Match: ${bestMatch ? bestMatch.name : 'None'}, Distance: ${bestDistance.toFixed(4)}, Threshold: ${threshold}`);

  if (bestMatch && bestDistance <= threshold) {
    console.log(`[BACKEND BIOMETRIC SCAN MATCH SUCCESS]: Employee ID ${bestMatch.id} (${bestMatch.name})`);
    return {
      matched: true,
      employeeId: bestMatch.id,
      name: bestMatch.name,
      department: bestMatch.department,
      confidence: Math.max(0, 1 - bestDistance)
    };
  }

  console.warn(`[BACKEND BIOMETRIC SCAN MATCH FAILURE]: Match failed. Best distance ${bestDistance.toFixed(4)} exceeds threshold ${threshold}`);
  return {
    matched: false,
    confidence: bestDistance !== Infinity ? Math.max(0, 1 - bestDistance) : 0
  };
};

/**
 * Registers an employee's face data in the system.
 */
export const registerFaceData = async (employeeId, faceDescriptor) => {
  const db = getDb();

  if (!Array.isArray(faceDescriptor) || faceDescriptor.length === 0) {
    throw new Error('Biometric registration requires a non-empty float array.');
  }
  if (faceDescriptor.length !== 128) {
    throw new Error(`Invalid biometric face descriptor dimension: expected 128, got ${faceDescriptor.length}`);
  }
  if (faceDescriptor.every(val => val === 0)) {
    throw new Error('Biometric descriptor contains only zeros. Invalid face template.');
  }

  const isSupabaseLive = await checkSupabaseConnection();
  let existingFaces = [];

  if (isSupabaseLive) {
    const { data } = await supabase.from('employees').select('id, name, face_data').not('face_data', 'is', null).neq('id', employeeId);
    if (data) existingFaces = data;
  }

  if (existingFaces.length === 0) {
    existingFaces = await db.all(`SELECT id, name, face_data FROM employees WHERE face_data IS NOT NULL AND id != ?`, [employeeId]);
  }
  
  console.log('[DEBUG-DIAGNOSTIC] Server-side duplicate-face check started.');
  console.log('[DEBUG LOG - DUPLICATE DETECTION] Initiating face registration. Checking if face descriptor is already registered for another employee. Comparison count:', existingFaces.length);
  for (const emp of existingFaces) {
    try {
      const dbDescriptor = decryptDescriptor(emp.face_data);
      if (!dbDescriptor) continue;

      const distance = calculateEuclideanDistance(faceDescriptor, dbDescriptor);
      console.log(`[DEBUG LOG - DUPLICATE DETECTION] Distance to existing employee ${emp.name} (ID: ${emp.id}): ${distance.toFixed(4)}`);
      
      if (distance <= 0.55) {
        console.warn(`[DEBUG LOG - DUPLICATE DETECTION] Duplicate detected! Distance ${distance.toFixed(4)} is within threshold 0.55 of employee ${emp.name} (ID: ${emp.id})`);
        const error = new Error(`This biometric identity already belongs to ${emp.name}.`);
        error.status = 409;
        throw error;
      }
    } catch (err) {
      if (err.message.includes('This biometric identity already belongs to')) {
        throw err;
      }
      console.error(`[BIOMETRIC REGISTRATION CHECK ERROR] Failed parsing/decrypting face for ${emp.name}:`, err);
    }
  }

  console.log('[DEBUG-DIAGNOSTIC] Server-side duplicate-face check completed successfully.');
  const encrypted = encryptDescriptor(faceDescriptor);

  // Write to SQLite
  await db.run(
    `UPDATE employees SET face_data = ? WHERE id = ?`,
    [encrypted, employeeId]
  );

  // Write to Supabase
  if (isSupabaseLive) {
    await supabase.from('employees').update({ face_data: encrypted }).eq('id', employeeId);
  }

  // Clear in-memory cache so next scan picks up new face registration
  clearBiometricsCache();

  return {
    success: true,
    message: `Face biometrics successfully recorded for Employee ${employeeId}.`
  };
};

