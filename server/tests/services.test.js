import { describe, test, expect } from 'vitest';
import { encryptDescriptor, decryptDescriptor } from '../services/encryption.js';
import { calculateEuclideanDistance, verifyLiveness } from '../services/faceRecognitionService.js';
import { calculateDistance, isInsideGeofence, isPointInPolygon, getDistanceToPolygon } from '../services/geofenceService.js';

describe('Biometric Encryption Service', () => {
  const dummyDescriptor = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.5);

  test('should encrypt and decrypt a 128D descriptor successfully', () => {
    const encrypted = encryptDescriptor(dummyDescriptor);
    expect(encrypted).toBeTypeOf('string');
    expect(encrypted.includes(':')).toBe(true);

    const decrypted = decryptDescriptor(encrypted);
    expect(decrypted).toBeInstanceOf(Array);
    expect(decrypted).toHaveLength(128);
    expect(decrypted[0]).toBeCloseTo(dummyDescriptor[0], 5);
  });

  test('should throw error on invalid descriptors during encryption', () => {
    expect(() => encryptDescriptor(null)).toThrow();
    expect(() => encryptDescriptor([])).toThrow();
  });

  test('should gracefully handle unencrypted seed JSON array representations during decryption', () => {
    const jsonStr = JSON.stringify(dummyDescriptor);
    const decrypted = decryptDescriptor(jsonStr);
    expect(decrypted).toEqual(dummyDescriptor);
  });

  test('should return null when decrypting empty string', () => {
    expect(decryptDescriptor('')).toBeNull();
    expect(decryptDescriptor(null)).toBeNull();
  });
});

describe('Face Recognition Service', () => {
  const vecA = Array.from({ length: 128 }, () => 0.1);
  const vecB = Array.from({ length: 128 }, () => 0.1);
  const vecC = Array.from({ length: 128 }, (_, i) => (i === 0 ? 0.9 : 0.1));

  test('calculateEuclideanDistance calculates correct vector distances', () => {
    const distZero = calculateEuclideanDistance(vecA, vecB);
    expect(distZero).toBe(0.0);

    const distC = calculateEuclideanDistance(vecA, vecC);
    expect(distC).toBeCloseTo(0.8, 5);
  });

  test('calculateEuclideanDistance throws error on mismatched dimensions', () => {
    expect(() => calculateEuclideanDistance([0.1], [0.1, 0.2])).toThrow();
  });

  test('verifyLiveness detects liveness or flags spoof attacks', () => {
    const passResult = verifyLiveness({ spoofIndex: 0.1 });
    expect(passResult.passed).toBe(true);

    const failResult = verifyLiveness({ spoofIndex: 0.5 });
    expect(failResult.passed).toBe(false);
    expect(failResult.reason).toContain('Anti-Spoof Check Failed');

    // Test active challenges
    expect(verifyLiveness({ challengeType: 'blink', blinkDetected: true }).passed).toBe(true);
    expect(verifyLiveness({ challengeType: 'blink', blinkDetected: false }).passed).toBe(false);

    expect(verifyLiveness({ challengeType: 'turn_left', headTurnRatio: 0.3 }).passed).toBe(true);
    expect(verifyLiveness({ challengeType: 'turn_left', headTurnRatio: 0.5 }).passed).toBe(false);

    expect(verifyLiveness({ challengeType: 'turn_right', headTurnRatio: 0.7 }).passed).toBe(true);
    expect(verifyLiveness({ challengeType: 'turn_right', headTurnRatio: 0.5 }).passed).toBe(false);

    // Test landmark-based verification
    const validLeftLandmarks = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 130, y: 100 }]; // ratio = 0.3
    expect(verifyLiveness({ challengeType: 'turn_left', landmarks: validLeftLandmarks }).passed).toBe(true);

    const invalidLeftLandmarks = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 100 }]; // ratio = 0.5
    expect(verifyLiveness({ challengeType: 'turn_left', landmarks: invalidLeftLandmarks }).passed).toBe(false);
  });
});

describe('Geofencing Service', () => {
  // Coords for Bhopal office settings: 23.217023795541753, 77.424506780737
  const bhopalLat = 23.217023795541753;
  const bhopalLng = 77.424506780737;

  test('calculateDistance correctly applies Haversine formula', () => {
    const distSelf = calculateDistance(bhopalLat, bhopalLng, bhopalLat, bhopalLng);
    expect(distSelf).toBe(0.0);

    // Bhopal to Delhi (~600km)
    const distDelhi = calculateDistance(bhopalLat, bhopalLng, 28.6139, 77.2090);
    expect(distDelhi / 1000).toBeGreaterThan(590);
    expect(distDelhi / 1000).toBeLessThan(610);
  });

  test('isInsideGeofence correctly validates radius boundary', () => {
    // 50 meters away
    const inside = isInsideGeofence(bhopalLat + 0.0001, bhopalLng + 0.0001, bhopalLat, bhopalLng, 100);
    expect(inside).toBe(true);

    // Far away
    const outside = isInsideGeofence(bhopalLat + 0.1, bhopalLng + 0.1, bhopalLat, bhopalLng, 100);
    expect(outside).toBe(false);
  });

  test('isPointInPolygon handles advanced polygon boundaries (Ray-Casting)', () => {
    // Bhopal office square geofence vertices
    const squareGeofence = [
      { lat: 23.216, lng: 77.423 },
      { lat: 23.218, lng: 77.423 },
      { lat: 23.218, lng: 77.426 },
      { lat: 23.216, lng: 77.426 }
    ];

    const inside = isPointInPolygon(bhopalLat, bhopalLng, squareGeofence);
    expect(inside).toBe(true);

    const outside = isPointInPolygon(23.215, 77.422, squareGeofence);
    expect(outside).toBe(false);
  });

  test('getDistanceToPolygon calculates closest distance to boundary segment', () => {
    const squareGeofence = [
      { lat: 23.216, lng: 77.423 },
      { lat: 23.218, lng: 77.423 },
      { lat: 23.218, lng: 77.426 },
      { lat: 23.216, lng: 77.426 }
    ];

    // Bhopal office point is right inside, distance to boundary should be relatively low (a few hundred meters)
    const dist = getDistanceToPolygon(bhopalLat, bhopalLng, squareGeofence);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(1000);
  });
});
