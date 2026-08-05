/**
 * BlinkDetector Utility
 * Provides helper functions for Eye Aspect Ratio (EAR) calculations and liveness blink verification.
 */

export const EAR_CLOSE_THRESHOLD = 0.22;
export const EAR_OPEN_THRESHOLD = 0.25;

export const getEAR = (points) => {
  if (!points || points.length < 6) return 1.0;
  const v1 = Math.hypot(points[1].x - points[5].x, points[1].y - points[5].y);
  const v2 = Math.hypot(points[2].x - points[4].x, points[2].y - points[4].y);
  const h = Math.hypot(points[0].x - points[3].x, points[0].y - points[3].y);
  return (v1 + v2) / (2.0 * h);
};

export const calculateAverageEAR = (leftEye, rightEye) => {
  return (getEAR(leftEye) + getEAR(rightEye)) / 2.0;
};

/**
 * processBlinkState
 * Analyzes transition of EAR to detect a full eye blink.
 * @param {number} ear Current average Eye Aspect Ratio
 * @param {boolean} wasClosed Previous frame eye closure state
 * @returns {{ isClosed: boolean, isBlinkDetected: boolean }} Updated state and indicator if blink occurred
 */
export const processBlinkState = (ear, wasClosed) => {
  let isClosed = wasClosed;
  let isBlinkDetected = false;

  if (ear < EAR_CLOSE_THRESHOLD) {
    isClosed = true;
  } else if (wasClosed && ear > EAR_OPEN_THRESHOLD) {
    isClosed = false;
    isBlinkDetected = true;
  } else if (ear > EAR_OPEN_THRESHOLD) {
    isClosed = false;
  }

  return { isClosed, isBlinkDetected };
};
