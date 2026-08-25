import { describe, test, expect, vi } from 'vitest';

vi.mock('@vladmandic/face-api', () => ({
  nets: {
    tinyFaceDetector: { loadFromUri: vi.fn().mockResolvedValue(true) },
    faceLandmark68TinyNet: { loadFromUri: vi.fn().mockResolvedValue(true) },
    faceRecognitionNet: { loadFromUri: vi.fn().mockResolvedValue(true) }
  },
  TinyFaceDetectorOptions: class {},
  detectAllFaces: vi.fn(),
  detectSingleFace: vi.fn()
}));

import { validateFullFaceEnrollment, calculateAverageDescriptor } from '../../src/services/faceApiService.js';

describe('Full-Face Biometric Enrollment Validator', () => {
  // Helper to generate a realistic 68-point frontal landmark set centered at (320, 240)
  const createMockDetection = ({
    box = { x: 200, y: 120, width: 240, height: 240 },
    score = 0.95,
    noseBridgeX = 320,
    leftEyeOuterX = 260,
    rightEyeOuterX = 380,
    tiltOffset = 0,
    eyeHeight = 6,
    jawSpan = 200
  } = {}) => {
    const positions = Array(68).fill(null).map((_, i) => ({ x: 320, y: 240 }));

    // Jawline: 0 (left ear), 8 (chin), 16 (right ear)
    positions[0] = { x: 320 - jawSpan / 2, y: 220 };
    positions[8] = { x: 320, y: 340 };
    positions[16] = { x: 320 + jawSpan / 2, y: 220 };

    // Eyebrows
    positions[17] = { x: 250, y: 150 };
    positions[21] = { x: 300, y: 150 };
    positions[22] = { x: 340, y: 150 };
    positions[26] = { x: 390, y: 150 };

    // Nose
    positions[27] = { x: noseBridgeX, y: 180 }; // top nose bridge
    positions[30] = { x: noseBridgeX, y: 230 }; // nose tip
    positions[31] = { x: noseBridgeX - 15, y: 240 };
    positions[35] = { x: noseBridgeX + 15, y: 240 };

    // Left Eye: 36 (outer), 37, 38 (top), 39 (inner), 40, 41 (bottom)
    positions[36] = { x: leftEyeOuterX, y: 180 };
    positions[37] = { x: leftEyeOuterX + 10, y: 180 - eyeHeight };
    positions[38] = { x: leftEyeOuterX + 20, y: 180 - eyeHeight };
    positions[39] = { x: leftEyeOuterX + 30, y: 180 };
    positions[40] = { x: leftEyeOuterX + 20, y: 180 + eyeHeight };
    positions[41] = { x: leftEyeOuterX + 10, y: 180 + eyeHeight };

    // Right Eye: 42 (inner), 43, 44 (top), 45 (outer), 46, 47 (bottom)
    positions[42] = { x: rightEyeOuterX - 30, y: 180 + tiltOffset };
    positions[43] = { x: rightEyeOuterX - 20, y: 180 - eyeHeight + tiltOffset };
    positions[44] = { x: rightEyeOuterX - 10, y: 180 - eyeHeight + tiltOffset };
    positions[45] = { x: rightEyeOuterX, y: 180 + tiltOffset };
    positions[46] = { x: rightEyeOuterX - 10, y: 180 + eyeHeight + tiltOffset };
    positions[47] = { x: rightEyeOuterX - 20, y: 180 + eyeHeight + tiltOffset };

    // Mouth: 48 (left corner), 54 (right corner)
    positions[48] = { x: 280, y: 280 };
    positions[54] = { x: 360, y: 280 };

    return {
      detection: { box, score },
      landmarks: { positions },
      descriptor: new Float32Array(128).fill(0.1)
    };
  };

  test('validates a clean full frontal face successfully', () => {
    const mock = createMockDetection({});
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(true);
    expect(res.reason).toContain('Full frontal face verified');
  });

  test('rejects face turned to the left (side profile / half face)', () => {
    // When turned left, nose bridge is closer to left eye than right eye (yawRatio < 0.68)
    const mock = createMockDetection({
      noseBridgeX: 280,
      leftEyeOuterX: 260, // leftDist = 20
      rightEyeOuterX: 380 // rightDist = 100 => ratio = 0.2
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('turned left');
  });

  test('rejects face turned to the right (side profile / half face)', () => {
    // When turned right, nose bridge is closer to right eye than left eye (yawRatio > 1.45)
    const mock = createMockDetection({
      noseBridgeX: 360,
      leftEyeOuterX: 260, // leftDist = 100
      rightEyeOuterX: 380 // rightDist = 20 => ratio = 5.0
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('turned right');
  });

  test('rejects face cut off at the left or right camera border', () => {
    // Face box extends too close to the edge (cut off)
    const mock = createMockDetection({
      box: { x: 5, y: 100, width: 240, height: 240 } // margin is 640 * 0.04 = 25.6
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('cut off');
  });

  test('rejects face too far from camera', () => {
    const mock = createMockDetection({
      box: { x: 260, y: 180, width: 100, height: 100 } // width 100 < 640 * 0.20 = 128
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('too far');
  });

  test('rejects face with head tilted excessively', () => {
    const mock = createMockDetection({
      tiltOffset: 60 // creates tilt angle > 16 degrees
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('tilted');
  });

  test('rejects face with closed eyes', () => {
    const mock = createMockDetection({
      eyeHeight: 0.5 // near zero EAR
    });
    const res = validateFullFaceEnrollment(mock, 640, 480);
    expect(res.isFullFace).toBe(false);
    expect(res.reason).toContain('eyes open');
  });

  test('calculateAverageDescriptor correctly computes average vector across frames', () => {
    const desc1 = new Float32Array([0.2, 0.4, 0.6]);
    const desc2 = new Float32Array([0.4, 0.6, 0.8]);
    const avg = calculateAverageDescriptor([desc1, desc2]);
    expect(avg[0]).toBeCloseTo(0.3, 5);
    expect(avg[1]).toBeCloseTo(0.5, 5);
    expect(avg[2]).toBeCloseTo(0.7, 5);
  });
});
