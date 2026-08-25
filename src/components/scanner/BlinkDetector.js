/**
 * BlinkDetector Utility
 * Provides helper functions for Eye Aspect Ratio (EAR) calculations and liveness blink verification.
 */

export const EAR_CLOSE_THRESHOLD = 0.22;
export const EAR_OPEN_THRESHOLD = 0.29;

export const getEAR = (points) => {
  if (!points || points.length < 6) return 1.0;
  const v1 = Math.hypot(points[1].x - points[5].x, points[1].y - points[5].y);
  const v2 = Math.hypot(points[2].x - points[4].x, points[2].y - points[4].y);
  const h = Math.hypot(points[0].x - points[3].x, points[0].y - points[3].y);
  if (h <= 0.0001 || isNaN(h)) return 1.0;
  return (v1 + v2) / (2.0 * h);
};

export const calculateAverageEAR = (leftEye, rightEye) => {
  return (getEAR(leftEye) + getEAR(rightEye)) / 2.0;
};

/**
 * processBlinkState
 * Analyzes transition of EAR to detect a full eye blink with duration validation.
 * @param {number} ear Current average Eye Aspect Ratio
 * @param {boolean} wasClosed Previous frame eye closure state
 * @param {number} closedFramesCount Consecutive frames eyes have been closed
 * @returns {{ isClosed: boolean, isBlinkDetected: boolean, closedFramesCount: number }}
 */
export const processBlinkState = (ear, wasClosed, closedFramesCount = 0) => {
  let isClosed = wasClosed;
  let isBlinkDetected = false;
  let updatedClosedFrames = closedFramesCount;

  if (ear < EAR_CLOSE_THRESHOLD) {
    isClosed = true;
    updatedClosedFrames += 1;
  } else if (wasClosed && ear > EAR_OPEN_THRESHOLD) {
    if (closedFramesCount >= 1 && closedFramesCount <= 20) {
      isBlinkDetected = true;
    } else if (closedFramesCount === 0) {
      // Fallback for callers that did not pass closedFramesCount
      isBlinkDetected = true;
    }
    isClosed = false;
    updatedClosedFrames = 0;
  } else if (ear > EAR_OPEN_THRESHOLD) {
    isClosed = false;
    updatedClosedFrames = 0;
  }

  return { isClosed, isBlinkDetected, closedFramesCount: updatedClosedFrames };
};
