/**
 * FaceMatcher Utility
 * Handles face descriptor comparison, distance calculations, and duplicate protection helper checks.
 */

/**
 * Calculates the Euclidean distance between two face descriptors.
 * @param {Array<number>|Float32Array} desc1 
 * @param {Array<number>|Float32Array} desc2 
 * @returns {number} Distance score
 */
export const calculateEuclideanDistance = (desc1, desc2) => {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
};

/**
 * Finds the BEST matching face descriptor from a list of enrolled faces.
 *
 * Key improvements over first-match approach:
 *   1. Finds the CLOSEST (minimum distance) match — not the first one under threshold.
 *   2. Uses a tighter threshold of 0.52 (face-api.js recommended: 0.5–0.6).
 *   3. Applies a confidence margin check: if best and runner-up are within 0.08 of
 *      each other, the match is rejected as ambiguous — prevents misidentification
 *      when two people look similar.
 *
 * @param {Array<number>|Float32Array} descriptor Live face descriptor (128-dim)
 * @param {Array<{id: string, name: string, descriptor: Array<number>}>} enrolledFaces
 * @param {number} threshold Match distance threshold (default: 0.52)
 * @returns {{isMatch: boolean, match?: {id: string, name: string}, distance?: number}}
 */
export const findMatchingDescriptor = (descriptor, enrolledFaces, threshold = 0.52) => {
  if (!descriptor || !enrolledFaces || enrolledFaces.length === 0) {
    return { isMatch: false };
  }

  // Score every enrolled face
  const scored = enrolledFaces
    .map(face => ({
      face,
      distance: calculateEuclideanDistance(descriptor, face.descriptor)
    }))
    .sort((a, b) => a.distance - b.distance); // closest first

  const best = scored[0];
  const runnerUp = scored[1];

  // Must be under the strict threshold
  if (best.distance > threshold) {
    return { isMatch: false, distance: best.distance };
  }

  // Ambiguity check: only applies if runner-up is also a plausible candidate (under threshold + MARGIN)
  const MARGIN = 0.08;
  if (runnerUp && runnerUp.distance <= (threshold + MARGIN) && (runnerUp.distance - best.distance) < MARGIN) {
    console.warn(
      `[FACE MATCHER]: Ambiguous match rejected. Best: ${best.distance.toFixed(4)} (${best.face.name}), ` +
      `Runner-up: ${runnerUp.distance.toFixed(4)} (${runnerUp.face.name}), margin: ${(runnerUp.distance - best.distance).toFixed(4)} < ${MARGIN}`
    );
    return { isMatch: false, distance: best.distance, reason: 'AMBIGUOUS_MATCH' };
  }

  return { isMatch: true, match: best.face, distance: best.distance };
};

/**
 * Checks if a candidate face descriptor already matches an existing enrolled employee.
 * @param {Array<number>|Float32Array} candidateDescriptor
 * @param {Array<{id: string, name: string, descriptor: Array<number>}>} enrolledFaces
 * @param {number} duplicateThreshold Threshold for duplicate detection (default: 0.52)
 * @returns {{ isDuplicate: boolean, duplicateOf?: {id: string, name: string}, distance?: number }}
 */
export const checkDuplicateFace = (candidateDescriptor, enrolledFaces, duplicateThreshold = 0.52) => {
  if (!candidateDescriptor || !enrolledFaces || enrolledFaces.length === 0) {
    return { isDuplicate: false };
  }

  for (const emp of enrolledFaces) {
    const dist = calculateEuclideanDistance(candidateDescriptor, emp.descriptor);
    if (dist <= duplicateThreshold) {
      return { isDuplicate: true, duplicateOf: emp, distance: dist };
    }
  }
  return { isDuplicate: false };
};

