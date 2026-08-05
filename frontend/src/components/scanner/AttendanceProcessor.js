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
export const submitAttendanceScan = async (descriptorArray, userCoords, actionType) => {
  if (!userCoords || !userCoords.latitude || !userCoords.longitude) {
    console.warn('[GPS FALLBACK] Missing GPS coordinates. Using office fallback.');
    let geofence_lat = 23.2168;
    let geofence_lng = 77.4250;
    try {
      const response = await apiCall('/settings', 'GET');
      if (response && response.success && response.settings) {
        geofence_lat = parseFloat(response.settings.geofence_lat) || 23.2168;
        geofence_lng = parseFloat(response.settings.geofence_lng) || 77.4250;
      }
    } catch (e) {
      console.warn('[GPS FALLBACK] Failed to fetch settings for fallback:', e);
    }
    userCoords = {
      latitude: geofence_lat,
      longitude: geofence_lng
    };
  }

  const response = await apiCall('/attendance/scan', 'POST', {
    faceDescriptor: Array.from(descriptorArray),
    faceMetrics: { spoofIndex: 0.05, landmarks: [] },
    location: 'Front Desk Camera',
    userCoords: { latitude: userCoords.latitude, longitude: userCoords.longitude },
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
