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
  if (
    !userCoords ||
    typeof userCoords.latitude !== 'number' ||
    typeof userCoords.longitude !== 'number' ||
    isNaN(userCoords.latitude) ||
    isNaN(userCoords.longitude)
  ) {
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
  if (
    !userCoords ||
    typeof userCoords.latitude !== 'number' ||
    typeof userCoords.longitude !== 'number' ||
    isNaN(userCoords.latitude) ||
    isNaN(userCoords.longitude)
  ) {
    throw {
      message: 'GPS Available: Failed - Location access is disabled or unavailable. Please enable GPS and try again.',
      voiceMessage: 'GPS location access is required to verify your physical presence.',
      response: { reason: 'GPS_UNAVAILABLE' }
    };
  }

  // spoofIndex intentionally omitted — server cannot trust client-supplied liveness scores.
  const response = await apiCall('/attendance/public-scan', 'POST', {
    faceDescriptor: Array.from(descriptorArray),
    faceMetrics: { 
      blinkDetected, 
      challengeType, 
      challengePassed, 
      headTurnRatio, 
      landmarks 
    },
    clientTimestamp: new Date().toISOString(),
    challengeSessionId,
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
  const msg = error.message || error.voiceMessage || '';
  if (msg.includes('Spoof') || msg.includes('Anti-Spoof')) return 'Access denied. Spoofing attempt blocked.';
  if (msg.includes('GPS') || msg.includes('Location') || msg.includes('location')) return 'GPS location access is required to verify your physical presence.';
  if (msg.includes('Multiple') || msg.includes('multiple')) return 'Multiple faces detected. Only one person allowed in frame.';
  if (msg.includes('outside') || msg.includes('premises') || msg.includes('geofence')) return 'Access denied. You are outside office premises.';
  if (msg.includes('completed') || msg.includes('already checked')) return 'Attendance already recorded for today.';
  if (msg.includes('timed out') || msg.includes('Timeout')) return 'Verification request timed out. Please try again.';
  if (msg.includes('Ambiguous') || msg.includes('ambiguous')) return 'Ambiguous match detected. Please face the camera clearly.';
  if (msg.includes('Not Recognized') || msg.includes('not recognized')) return 'Face not recognized. Please contact HR administrator.';
  return 'Biometric verification failed. Access Denied.';
};
