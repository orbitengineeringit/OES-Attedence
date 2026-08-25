process.env.DB_FILE = './accuracy_test_database.sqlite';

import { describe, test, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import * as faceapi from '@vladmandic/face-api';

// Enforce Asia/Kolkata timezone in tests
process.env.TZ = 'Asia/Kolkata';

// Adaptive Gamma Correction Preprocessor
function preprocessImage(rawImageData) {
  const pixels = rawImageData.data;
  const width = rawImageData.width;
  const height = rawImageData.height;
  
  let totalLuminance = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    totalLuminance += (0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2]);
  }
  const avgLuminance = totalLuminance / (width * height);
  
  let gamma = 1.0;
  if (avgLuminance < 100) {
    gamma = 0.55; // Low light boost
  } else {
    let brightCount = 0;
    let darkCount = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
      if (gray > 220) brightCount++;
      if (gray < 80) darkCount++;
    }
    const brightRatio = brightCount / (width * height);
    const darkRatio = darkCount / (width * height);
    if (brightRatio > 0.25 && darkRatio > 0.25) {
      gamma = 0.45; // Backlit glare shadow boost
    }
  }
  
  if (gamma !== 1.0) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = Math.pow(pixels[i] / 255.0, gamma) * 255.0;
      pixels[i+1] = Math.pow(pixels[i+1] / 255.0, gamma) * 255.0;
      pixels[i+2] = Math.pow(pixels[i+2] / 255.0, gamma) * 255.0;
    }
  }
  return gamma;
}

// Helper to convert a JPEG file on disk to a 3D TFJS tensor
function getTensorFromJpeg(imagePath, applyPreprocessing = true) {
  const fileBuffer = fs.readFileSync(imagePath);
  const rawImageData = jpeg.decode(fileBuffer);
  
  if (applyPreprocessing) {
    preprocessImage(rawImageData);
  }
  
  const numPixels = rawImageData.width * rawImageData.height;
  const rgbData = new Uint8Array(numPixels * 3);
  for (let i = 0; i < numPixels; i++) {
    rgbData[i * 3] = rawImageData.data[i * 4];       // R
    rgbData[i * 3 + 1] = rawImageData.data[i * 4 + 1]; // G
    rgbData[i * 3 + 2] = rawImageData.data[i * 4 + 2]; // B
  }
  
  return faceapi.tf.tensor3d(rgbData, [rawImageData.height, rawImageData.width, 3], 'int32');
}

describe('Biometric Face Recognition End-to-End Real Image Accuracy Suite', () => {
  let modelPath;
  let fixturesDir;
  
  // Enrolled template databases (each is an array of 3 descriptors: ideal, low_light, backlit)
  const templates = {
    a: [], // Employee A (Shreya - light/wheatish skin tone)
    b: [], // Employee B (Middle-aged Indian man - dark skin tone)
    c: []  // Employee C (Young East Asian female - fair skin tone)
  };
  
  const matchThreshold = 0.68;

  // Ultra-robust face detection retry wrapper to guarantee extraction on tough lighting/noise variations
  const extractDescriptor = async (filename, applyPreprocessing = true) => {
    const filePath = path.join(fixturesDir, filename);
    const optionsList = [
      { inputSize: 224, scoreThreshold: 0.15 },
      { inputSize: 160, scoreThreshold: 0.15 },
      { inputSize: 320, scoreThreshold: 0.15 },
      { inputSize: 128, scoreThreshold: 0.15 }
    ];
    
    for (const optionsObj of optionsList) {
      for (const preprocess of [applyPreprocessing, false]) {
        try {
          const tensor = getTensorFromJpeg(filePath, preprocess);
          const options = new faceapi.TinyFaceDetectorOptions(optionsObj);
          const detection = await faceapi.detectSingleFace(tensor, options)
            .withFaceLandmarks(true)
            .withFaceDescriptor();
          tensor.dispose();
          if (detection) {
            return detection.descriptor;
          }
        } catch (e) {
          console.error(`[extractDescriptor Warning] failed with inputSize ${optionsObj.inputSize}:`, e.message);
        }
      }
    }
    console.error(`[extractDescriptor Error]: Failed to extract descriptor for ${filename}`);
    return null;
  };

  beforeAll(async () => {
    if (fs.existsSync('./accuracy_test_database.sqlite')) {
      try {
        fs.unlinkSync('./accuracy_test_database.sqlite');
      } catch (e) {}
    }

    modelPath = path.resolve('public/model');
    fixturesDir = path.resolve('server/tests/fixtures');
    
    console.log('[REAL IMAGE ACCURACY TEST]: Loading weights from:', modelPath);
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
    console.log('[REAL IMAGE ACCURACY TEST]: Models loaded.');
    
    // Enroll multi-template biometrics profile for Employee A
    const empADesc1 = await extractDescriptor('enrolled_face.jpg', false);
    const empADesc2 = await extractDescriptor('low_light.jpg', true);
    const empADesc3 = await extractDescriptor('backlit.jpg', true);
    templates.a = [empADesc1, empADesc2, empADesc3].filter(d => d !== null);
    
    // Enroll Employee B
    const empBDesc1 = await extractDescriptor('enrolled_face_b.jpg', false);
    const empBDesc2 = await extractDescriptor('low_light_b.jpg', true);
    const empBDesc3 = await extractDescriptor('backlit_b.jpg', true);
    templates.b = [empBDesc1, empBDesc2, empBDesc3].filter(d => d !== null);
    
    // Enroll Employee C
    const empCDesc1 = await extractDescriptor('enrolled_face_c.jpg', false);
    const empCDesc2 = await extractDescriptor('low_light_c.jpg', true);
    const empCDesc3 = await extractDescriptor('backlit_c.jpg', true);
    templates.c = [empCDesc1, empCDesc2, empCDesc3].filter(d => d !== null);
    
    console.log(`[REAL IMAGE ACCURACY TEST]: Enrolled profiles ready. Templates counts: A: ${templates.a.length}, B: ${templates.b.length}, C: ${templates.c.length}`);
  }, 60000);

  function calculateMinDistance(liveDesc, enrolledTemplates) {
    let minDistance = Infinity;
    for (const enrolledDesc of enrolledTemplates) {
      let sum = 0;
      for (let i = 0; i < 128; i++) {
        const diff = liveDesc[i] - enrolledDesc[i];
        sum += diff * diff;
      }
      const dist = Math.sqrt(sum);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    return minDistance;
  }

  function getConfidenceScore(distance) {
    if (distance > matchThreshold) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - (distance / matchThreshold)) * 100)));
  }

  const runTestScenario = async (filename, employeeKey, applyPreprocessing = true) => {
    const liveDesc = await extractDescriptor(filename, applyPreprocessing);
    expect(liveDesc).not.toBeNull();
    
    const dist = calculateMinDistance(liveDesc, templates[employeeKey]);
    const conf = getConfidenceScore(dist);
    return { dist, conf };
  };

  test('Scenario 1: Normal Probe Face (Realistic Baseline Self-Match)', async () => {
    const liveDesc = await extractDescriptor('enrolled_face_probe.jpg', false);
    expect(liveDesc).not.toBeNull();
    
    const dist = calculateMinDistance(liveDesc, templates.a);
    const conf = getConfidenceScore(dist);
    console.log(`[REAL IMAGE MATRIX] Scenario 1: Normal Probe -> Dist: ${dist.toFixed(4)}, Conf: ${conf}%`);
    
    expect(dist).toBeGreaterThan(0.001); // Real baseline is non-zero
    expect(dist).toBeLessThan(matchThreshold); // Must match
    expect(conf).toBeGreaterThan(60); // High confidence
  }, 30000);

  test('Scenario 2: Low Light Portrait (Employee A, B, C)', async () => {
    // Employee A
    const resA = await runTestScenario('low_light_probe.jpg', 'a', true);
    console.log(`[REAL IMAGE MATRIX] Low Light Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeGreaterThan(0.001);
    expect(resA.dist).toBeLessThan(matchThreshold);

    // Employee B
    const resB = await runTestScenario('low_light_b_probe.jpg', 'b', true);
    console.log(`[REAL IMAGE MATRIX] Low Light Emp B -> Dist: ${resB.dist.toFixed(4)}, Conf: ${resB.conf}%`);
    expect(resB.dist).toBeGreaterThan(0.001);
    expect(resB.dist).toBeLessThan(matchThreshold);

    // Employee C
    const resC = await runTestScenario('low_light_c_probe.jpg', 'c', true);
    console.log(`[REAL IMAGE MATRIX] Low Light Emp C -> Dist: ${resC.dist.toFixed(4)}, Conf: ${resC.conf}%`);
    expect(resC.dist).toBeGreaterThan(0.001);
    expect(resC.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 3: Backlit Glare Portrait (Employee A, B, C)', async () => {
    // Employee A
    const resA = await runTestScenario('backlit_probe.jpg', 'a', true);
    console.log(`[REAL IMAGE MATRIX] Backlit Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeGreaterThan(0.001);
    expect(resA.dist).toBeLessThan(matchThreshold);

    // Employee B
    const resB = await runTestScenario('backlit_b_probe.jpg', 'b', true);
    console.log(`[REAL IMAGE MATRIX] Backlit Emp B -> Dist: ${resB.dist.toFixed(4)}, Conf: ${resB.conf}%`);
    expect(resB.dist).toBeGreaterThan(0.001);
    expect(resB.dist).toBeLessThan(matchThreshold);

    // Employee C
    const resC = await runTestScenario('backlit_c_probe.jpg', 'c', true);
    console.log(`[REAL IMAGE MATRIX] Backlit Emp C -> Dist: ${resC.dist.toFixed(4)}, Conf: ${resC.conf}%`);
    expect(resC.dist).toBeGreaterThan(0.001);
    expect(resC.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 4: Wearing Glasses (Employee A)', async () => {
    // Employee A (we have real glasses.jpg only for Employee A)
    const resA = await runTestScenario('glasses.jpg', 'a', false);
    console.log(`[REAL IMAGE MATRIX] Glasses Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 5: Motion Blur Capture (Employee A, B, C)', async () => {
    // Employee A
    const resA = await runTestScenario('motion_blur.jpg', 'a', false);
    console.log(`[REAL IMAGE MATRIX] Motion Blur Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeLessThan(matchThreshold);

    // Employee B
    const resB = await runTestScenario('motion_blur_b.jpg', 'b', false);
    console.log(`[REAL IMAGE MATRIX] Motion Blur Emp B -> Dist: ${resB.dist.toFixed(4)}, Conf: ${resB.conf}%`);
    expect(resB.dist).toBeLessThan(matchThreshold);

    // Employee C
    const resC = await runTestScenario('motion_blur_c.jpg', 'c', false);
    console.log(`[REAL IMAGE MATRIX] Motion Blur Emp C -> Dist: ${resC.dist.toFixed(4)}, Conf: ${resC.conf}%`);
    expect(resC.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 6: Harsh Shadow / Uneven Skin Tone (Employee A, B, C)', async () => {
    // Employee A
    const resA = await runTestScenario('harsh_shadow.jpg', 'a', false);
    console.log(`[REAL IMAGE MATRIX] Harsh Shadow Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeLessThan(matchThreshold);

    // Employee B
    const resB = await runTestScenario('harsh_shadow_b.jpg', 'b', false);
    console.log(`[REAL IMAGE MATRIX] Harsh Shadow Emp B -> Dist: ${resB.dist.toFixed(4)}, Conf: ${resB.conf}%`);
    expect(resB.dist).toBeLessThan(matchThreshold);

    // Employee C
    const resC = await runTestScenario('harsh_shadow_c.jpg', 'c', false);
    console.log(`[REAL IMAGE MATRIX] Harsh Shadow Emp C -> Dist: ${resC.dist.toFixed(4)}, Conf: ${resC.conf}%`);
    expect(resC.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 7: Off-Angle Face (15-20°) (Employee A, B, C)', async () => {
    // Employee A
    const resA = await runTestScenario('off_angle.jpg', 'a', false);
    console.log(`[REAL IMAGE MATRIX] Off-Angle Emp A -> Dist: ${resA.dist.toFixed(4)}, Conf: ${resA.conf}%`);
    expect(resA.dist).toBeLessThan(matchThreshold);

    // Employee B
    const resB = await runTestScenario('off_angle_b.jpg', 'b', false);
    console.log(`[REAL IMAGE MATRIX] Off-Angle Emp B -> Dist: ${resB.dist.toFixed(4)}, Conf: ${resB.conf}%`);
    expect(resB.dist).toBeLessThan(matchThreshold);

    // Employee C
    const resC = await runTestScenario('off_angle_c.jpg', 'c', false);
    console.log(`[REAL IMAGE MATRIX] Off-Angle Emp C -> Dist: ${resC.dist.toFixed(4)}, Conf: ${resC.conf}%`);
    expect(resC.dist).toBeLessThan(matchThreshold);
  }, 30000);

  test('Scenario 8: Multiple Faces in Frame', async () => {
    const filePath = path.join(fixturesDir, 'multiple_faces.jpg');
    const tensor = getTensorFromJpeg(filePath, false);
    
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
    const detections = await faceapi.detectAllFaces(tensor, options);
    tensor.dispose();
    
    console.log(`[REAL IMAGE MATRIX] Multiple Faces -> Found ${detections.length} faces in frame.`);
    expect(detections.length).toBeGreaterThanOrEqual(2);
  }, 30000);
});
