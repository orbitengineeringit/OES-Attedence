process.env.DB_FILE = './matrix_test_database.sqlite';

import { describe, test, expect, beforeAll } from 'vitest';
import { initializeDatabase } from '../database/db.js';
import { descriptorCache } from '../services/descriptorCache.js';
import fs from 'fs';

function generateBaseDescriptor() {
  const arr = [];
  for (let i = 0; i < 128; i++) {
    // Standard normalized vector
    arr.push((Math.random() - 0.5) * 0.1);
  }
  // Normalize vector
  const len = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
  return arr.map(v => v / len);
}

function addNoise(descriptor, stdDev) {
  return descriptor.map(v => {
    // Box-Muller transform for Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    return v + randStdNormal * stdDev;
  });
}

// Biometric Face Recognition Matching-Threshold Robustness Test Suite
// This suite mathematically evaluates Euclidean distance matching bounds under synthetic isotropic Gaussian noise.
// Note: Real-world image face detection, landmarks, and feature-extraction accuracy are tested end-to-end in real_image_accuracy.test.js.
describe('Biometric Face Recognition Matching-Threshold Robustness Test Suite', () => {
  let db;
  let enrolled;

  beforeAll(async () => {
    if (fs.existsSync('./matrix_test_database.sqlite')) {
      try {
        fs.unlinkSync('./matrix_test_database.sqlite');
      } catch (e) {}
    }
    db = await initializeDatabase();
    enrolled = generateBaseDescriptor();
    
    // Clear and mock descriptor cache with our enrolled target
    descriptorCache.cache.clear();
    descriptorCache.cache.set('OES/MATRIX_TEST', {
      id: 'OES/MATRIX_TEST',
      name: 'Matrix Test Employee',
      email: 'matrix@test.com',
      role: 'employee',
      descriptor: enrolled
    });
    descriptorCache.isInitialized = true;
  });

  test('Matrix Scenario 1: Low Light conditions', () => {
    const lowLightDesc = addNoise(enrolled, 0.05); // severe lighting degradation
    const match = descriptorCache.match(lowLightDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 1: Low Light | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    expect(match.success).toBe(true); // Should pass within the standard 0.68 threshold
  });

  test('Matrix Scenario 2: Backlit conditions', () => {
    const backlitDesc = addNoise(enrolled, 0.045); // backlit glare noise
    const match = descriptorCache.match(backlitDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 2: Backlit | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    expect(match.success).toBe(true);
  });

  test('Matrix Scenario 3: Wearing Glasses', () => {
    const glassesDesc = addNoise(enrolled, 0.02); // minor perturbation
    const match = descriptorCache.match(glassesDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 3: Glasses | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    expect(match.success).toBe(true);
    expect(match.confidenceScore).toBeGreaterThan(60); // Glasses should retain high matching confidence
  });

  test('Matrix Scenario 4: Blurry / Motion capture', () => {
    const blurryDesc = addNoise(enrolled, 0.075); // very heavy degradation
    const match = descriptorCache.match(blurryDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 4: Blurry / Motion | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    // Blurry motion capture should fail match (too noisy, false matches must be prevented!)
    expect(match.success).toBe(false);
  });

  test('Matrix Scenario 5: Uneven skin tone / Harsh shadow', () => {
    const shadowDesc = addNoise(enrolled, 0.04); // shadow/tone degradation
    const match = descriptorCache.match(shadowDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 5: Harsh Shadow | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    expect(match.success).toBe(true);
  });

  test('Matrix Scenario 6: Off-angle Face (15-20 degrees)', () => {
    const offAngleDesc = addNoise(enrolled, 0.042); // perspective distortion noise
    const match = descriptorCache.match(offAngleDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 6: Off-Angle Face | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    expect(match.success).toBe(true);
  });

  test('Matrix Scenario 7: Multiple faces / Different face', () => {
    const differentFaceDesc = generateBaseDescriptor(); // totally different random descriptor
    const match = descriptorCache.match(differentFaceDesc, 0.68);
    
    console.log(`[ACCURACY MATRIX] Scenario 7: Different Face | Match: ${match.success} | Distance: ${match.distance?.toFixed(4)} | Confidence Score: ${match.confidenceScore || 0}%`);
    // Must be rejected with FACE_NOT_RECOGNIZED to prevent proxy check-ins
    expect(match.success).toBe(false);
  });
});
