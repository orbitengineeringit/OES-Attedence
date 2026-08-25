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
 * Checks if a descriptor matches any in a list of existing descriptors.
 * @param {Array<number>|Float32Array} descriptor 
 * @param {Array<{id: string, name: string, descriptor: Array<number>}>} enrolledFaces 
 * @param {number} threshold Match distance threshold (default: 0.55)
 * @returns {{isMatch: boolean, match?: {id: string, name: string}}} Match result
 */
export const findMatchingDescriptor = (descriptor, enrolledFaces, threshold = 0.70) => {
  if (!descriptor || !enrolledFaces || enrolledFaces.length === 0) {
    return { isMatch: false };
  }

  for (const face of enrolledFaces) {
    const distance = calculateEuclideanDistance(descriptor, face.descriptor);
    if (distance <= threshold) {
      return { isMatch: true, match: face };
    }
  }

  return { isMatch: false };
};
