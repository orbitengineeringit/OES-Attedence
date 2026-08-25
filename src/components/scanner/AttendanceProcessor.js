/**
 * AttendanceProcessor Utility
 * Manages the API pipeline for scanning biometric descriptors, late timing evaluation, and validation checks.
 */
import { apiCall } from '../../services/api.js';

/**
 * submitAttendanceScan
 * Sends the biometric descriptor and GPS telemetry to the API for attendance marking.
 * @param {Array<number>|Float32Array} descriptorArray Face descriptor array
 * @param {{latitude: number, longitude: number}|null} userCoords GPS coordinates
 * @returns {Promise<any>} Response object from the server
 */
export const submitAttendanceScan = async (descriptorArray, userCoords, actionType, blinkDetected = false, challengeType = 'blink', challengePassed = false, headTurnRatio = 0.5, landmarks = [], challengeSessionId = null) => {
  // [C-01 + H-06 FIX]: GPS is mandatory — never silently substitute office coordinates.
  // Reject immediately if GPS is unavailable so geofence cannot be bypassed.
  if (!userCoords || !userCoords.latitude || !userCoords.longitude) {
    throw {
      message: 'GPS Available: Failed - Location access is disabled or unavailable. Please enable GPS and try again.',
      voiceMessage: 'GPS location access is required to verify your physical presence.',
      response: { reason: 'GPS_UNAVAILABLE' }
    };
  }

  // [C-01 FIX]: Do NOT send spoofIndex from the client — the server cannot trust
  // a client-supplied liveness score. Blink status is sent so server can enforce
  // that a real blink was detected before allowing the scan.
  const response = await apiCall('/attendance/scan', 'POST', {
    faceDescriptor: Array.from(descriptorArray),
    faceMetrics: { 
      blinkDetected, 
      challengeType, 
      challengePassed, 
      headTurnRatio, 
      landmarks 
    }, // spoofIndex intentionally omitted
    clientTimestamp: new Date().toISOString(), // [H-04 FIX]: replay protection
    challengeSessionId, // [Priority 2]: Server-side challenge session nonce temporal validation
    location: 'Front Desk Camera',
    userCoords: { 
      latitude: userCoords.latitude, 
      longitude: userCoords.longitude,
      accuracy: userCoords.accuracy
    },
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata',
    action: actionType
  });

  if (!response.success) {
    throw {
      message: response.message || 'Verification failed.',
      voiceMessage: response.voiceMessage || 'Access denied.',
      response
    };
  }

  return response;
};

/**
 * submitPublicAttendanceScan
 * Sends biometric descriptor, blink detection status, and GPS telemetry to /attendance/public-scan endpoint.
 * @param {Array<number>|Float32Array} descriptorArray Face descriptor array
 * @param {{latitude: number, longitude: number}|null} userCoords GPS coordinates
 * @param {boolean} blinkDetected Whether blink was detected
 * @returns {Promise<any>} Response object from the server
 */
export const submitPublicAttendanceScan = async (descriptorArray, userCoords, blinkDetected = false, challengeType = 'blink', challengePassed = false, headTurnRatio = 0.5, landmarks = [], challengeSessionId = null) => {
  // [C-01 + H-06 FIX]: GPS is mandatory — never silently substitute office coordinates.
  if (!userCoords || !userCoords.latitude || !userCoords.longitude) {
    throw {
      message: 'GPS Available: Failed - Location access is disabled or unavailable. Please enable GPS and try again.',
      voiceMessage: 'GPS location access is required to verify your physical presence.',
      response: { reason: 'GPS_UNAVAILABLE' }
    };
  }

  // [C-01 FIX]: spoofIndex intentionally omitted — server cannot trust client-supplied liveness scores.
  // blinkDetected is a genuine value from the EAR-based blink detector, not a hardcoded true.
  const response = await apiCall('/attendance/public-scan', 'POST', {
    faceDescriptor: Array.from(descriptorArray),
    faceMetrics: { 
      blinkDetected, 
      challengeType, 
      challengePassed, 
      headTurnRatio, 
      landmarks 
    }, // spoofIndex intentionally omitted
    clientTimestamp: new Date().toISOString(), // [H-04 FIX]: replay protection timestamp
    challengeSessionId, // [Priority 2]: Server-side challenge session nonce temporal validation
    location: 'Public Attendance Link',
    userCoords: { 
      latitude: userCoords.latitude, 
      longitude: userCoords.longitude,
      accuracy: userCoords.accuracy
    },
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata'
  });

  if (!response.success) {
    throw {
      message: response.message || 'Verification failed.',
      voiceMessage: response.voiceMessage || 'Access denied.',
      response
    };
  }

  return response;
};

/**
 * mapErrorToVoiceMessage
 * Maps backend scan exception messages to standardized audio messages.
 * @param {Error|any} error The exception thrown during scan
 * @returns {string} Suitable announcement text for VoiceAssistant
 */
export const mapErrorToVoiceMessage = (error) => {
  const msg = error.message || '';
  if (msg.includes('Spoof')) return 'Access denied. Spoofing attempt blocked.';
  if (msg.includes('Unauthorized')) return 'Access denied. Unauthorized individual detected.';
  if (msg.includes('completed') || msg.includes('satisfied')) return 'Attendance already completed for today.';
  if (msg.includes('outside') || msg.includes('premises')) return 'Access denied. You are outside office premises.';
  return 'Biometric mismatch. Access Denied.';
};
