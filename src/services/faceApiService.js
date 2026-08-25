import * as faceapi from '@vladmandic/face-api';

let modelsLoaded = false;
let loadingPromise = null;

const MODEL_URL = './model/';

/**
 * Trigger loading of face-api.js neural networks.
 */
export const loadFaceApiModels = () => {
  if (modelsLoaded) return Promise.resolve(true);
  if (loadingPromise) return loadingPromise;

  console.log('[BIOMETRIC FACE-API]: Initiating model download from jsDelivr CDN...');
  loadingPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ])
    .then(() => {
      modelsLoaded = true;
      console.log('[BIOMETRIC FACE-API]: All neural networks loaded and ready.');
      return true;
    })
    .catch((err) => {
      console.error('[BIOMETRIC FACE-API]: Failed to load neural network weights:', err);
      loadingPromise = null;
      throw err;
    });

  return loadingPromise;
};

/**
 * Runs the face detector on a given HTMLVideoElement.
 * Returns the detection result with landmarks and descriptors.
 */
export const detectFaceBiometrics = async (videoElement) => {
  if (typeof window !== 'undefined' && window.__MOCK_BIOMETRICS__) {
    console.log('[MOCK BIOMETRICS]: Returning mock face biometrics signature');
    if (!window.__MOCK_DESCRIPTOR__) {
      return null;
    }
    
    // Simulate landmarks positions inside 320x240 frame
    const positions = Array(68).fill(null).map((_, i) => ({ x: 160 + Math.sin(i) * 30, y: 120 + Math.cos(i) * 30 }));
    
    return {
      detection: {
        score: window.__MOCK_CONFIDENCE__ !== undefined ? window.__MOCK_CONFIDENCE__ : 0.95,
        box: { x: 80, y: 40, width: 160, height: 160, right: 240, bottom: 200 }
      },
      landmarks: {
        positions,
        getNose: () => positions.slice(27, 36),
        getLeftEye: () => positions.slice(36, 42),
        getRightEye: () => positions.slice(42, 48),
        getLeftEyeBrow: () => positions.slice(17, 22),
        getRightEyeBrow: () => positions.slice(22, 27),
        getMouth: () => positions.slice(48, 68),
        getJawOutline: () => positions.slice(0, 17)
      },
      descriptor: new Float32Array(window.__MOCK_DESCRIPTOR__)
    };
  }

  if (!modelsLoaded) {
    await loadFaceApiModels();
  }

  // inputSize 224 produces more accurate and discriminative face descriptors.
  // 160 was too low — low-res descriptors cluster together and cause misidentification.
  // scoreThreshold 0.5 filters out low-quality face detections before descriptor extraction.
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.5
  });

  // Verify multiple faces
  try {
    const allDetections = await faceapi.detectAllFaces(videoElement, options);
    if (allDetections.length > 1) {
      return { multipleFaces: true, count: allDetections.length };
    }
  } catch (err) {
    console.error('[detectFaceBiometrics detectAllFaces Error]:', err);
  }

  // Preprocess frame if quality is degraded
  let inputSource = videoElement;
  try {
    const quality = checkFrameQuality(videoElement);
    if (!quality.passed) {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth || 640;
      canvas.height = videoElement.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (quality.warning && quality.warning.includes('dark')) {
        ctx.filter = 'brightness(1.5) contrast(1.2)';
      } else if (quality.warning && quality.warning.includes('backlit')) {
        ctx.filter = 'brightness(1.6) contrast(1.3)';
      }
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      inputSource = canvas;
    }
  } catch (err) {
    console.error('[detectFaceBiometrics Preprocessing Error]:', err);
  }

  const detection = await faceapi
    .detectSingleFace(inputSource, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  return detection;
};

let qualityCanvas = null;
let qualityCtx = null;

/**
 * Analyzes video frame brightness and contrast for live quality feedback.
 * Returns { passed: boolean, warning: string|null }
 */
export const checkFrameQuality = (videoElement) => {
  if (!videoElement || !videoElement.videoWidth) {
    return { passed: true, warning: null };
  }

  if (!qualityCanvas && typeof document !== 'undefined') {
    qualityCanvas = document.createElement('canvas');
    qualityCanvas.width = 80;
    qualityCanvas.height = 60;
    qualityCtx = qualityCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (!qualityCtx) return { passed: true, warning: null };
  
  try {
    qualityCtx.drawImage(videoElement, 0, 0, 80, 60);
    const imgData = qualityCtx.getImageData(0, 0, 80, 60);
    const pixels = imgData.data;
    const numPixels = 80 * 60;

    let totalLuminance = 0;
    let brightCount = 0;
    let darkCount = 0;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i+1];
      const b = pixels[i+2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      totalLuminance += gray;

      if (gray > 220) brightCount++;
      if (gray < 80) darkCount++;
    }

    const brightness = totalLuminance / numPixels;
    const brightRatio = brightCount / numPixels;
    const darkRatio = darkCount / numPixels;

    if (brightness < 45) {
      return { passed: false, warning: 'Too dark — move to better light' };
    }
    if (brightness > 230) {
      return { passed: false, warning: 'Too bright — avoid direct glare' };
    }
    if (brightRatio > 0.25 && darkRatio > 0.25) {
      return { passed: false, warning: "You're backlit — face away from the light" };
    }

    return { passed: true, warning: null };
  } catch (err) {
    return { passed: true, warning: null };
  }
};

/**
 * Estimates head orientation (Front, Left profile, Right profile) using horizontal asymmetry
 * between eyes and the nose bridge from 68 landmarks.
 */
export const estimateHeadPose = (landmarks) => {
  if (!landmarks) return 'front';

  const nosePoints = landmarks.getNose();
  const leftEyePoints = landmarks.getLeftEye();
  const rightEyePoints = landmarks.getRightEye();

  if (!nosePoints.length || !leftEyePoints.length || !rightEyePoints.length) {
    return 'front';
  }

  // Use the top nose point (bridge) and outermost eye points
  const noseBridge = nosePoints[0];
  const leftEyeOuter = leftEyePoints[0];
  const rightEyeOuter = rightEyePoints[rightEyePoints.length - 1];

  const leftDist = noseBridge.x - leftEyeOuter.x;
  const rightDist = rightEyeOuter.x - noseBridge.x;

  // If nose has crossed outer eye boundary, face is turned completely to that side
  if (leftDist <= 0) return 'left';
  if (rightDist <= 0) return 'right';

  const ratio = leftDist / rightDist;

  // Set calibrated thresholds for head turning
  if (ratio > 1.6) {
    return 'right'; // Face turned to the right (looking right from subject perspective)
  } else if (ratio < 0.6) {
    return 'left';  // Face turned to the left
  }

  return 'front';
};

/**
 * Averages a list of descriptors into a single robust template vector with L2 unit normalization.
 * @param {Array<Float32Array>} descriptors 
 * @returns {Array<number>}
 */
export const calculateAverageDescriptor = (descriptors, normalize = false) => {
  if (!descriptors || descriptors.length === 0) return null;
  const vectorLength = descriptors[0].length;
  const avg = new Array(vectorLength).fill(0);

  for (const desc of descriptors) {
    for (let i = 0; i < vectorLength; i++) {
      avg[i] += desc[i];
    }
  }

  const mean = avg.map(val => val / descriptors.length);
  if (!normalize) return mean;
  const norm = Math.sqrt(mean.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return mean;
  return mean.map(val => val / norm);
};

/**
 * Rigorously validates that a detected face is a FULL FRONTAL face suitable for biometric enrollment.
 * Rejects half faces, turned heads / side profiles, occluded landmarks, out-of-boundary faces, or extreme tilts.
 * 
 * @param {Object} detection - face-api detection object containing .detection and .landmarks
 * @param {number} videoWidth - Width of the video element / frame
 * @param {number} videoHeight - Height of the video element / frame
 * @returns {{ isFullFace: boolean, reason: string, telemetry: Object }}
 */
export const validateFullFaceEnrollment = (detection, videoWidth = 640, videoHeight = 480) => {
  if (!detection || !detection.detection || !detection.landmarks) {
    return {
      isFullFace: false,
      reason: 'No face detected. Align your face inside the scanner frame.',
      telemetry: null
    };
  }

  const { box, score } = detection.detection;
  const positions = detection.landmarks.positions;

  // 1. Detection confidence
  if (score < 0.35) {
    return {
      isFullFace: false,
      reason: 'Low confidence. Improve lighting and face the camera directly.',
      telemetry: { score }
    };
  }

  // 2. Boundary check — reject if face is cut off at the edge
  const marginX = videoWidth * 0.04;
  const marginY = videoHeight * 0.04;
  if (
    box.x < marginX ||
    box.y < marginY ||
    box.x + box.width > videoWidth - marginX ||
    box.y + box.height > videoHeight - marginY
  ) {
    return {
      isFullFace: false,
      reason: 'Face is cut off at the edge. Move so your full face is visible.',
      telemetry: { box }
    };
  }

  // 3. Face size check — must not be too far away
  const minWidth = videoWidth * 0.20;
  const maxWidth = videoWidth * 0.95;
  if (box.width < minWidth) {
    return {
      isFullFace: false,
      reason: 'Face is too far. Please move closer to the camera.',
      telemetry: { faceWidth: box.width, minWidth }
    };
  }
  if (box.width > maxWidth) {
    return {
      isFullFace: false,
      reason: 'Face is too close. Please move slightly back.',
      telemetry: { faceWidth: box.width, maxWidth }
    };
  }

  // 4. Check all key landmark points exist (68 landmarks)
  if (!positions || positions.length < 68) {
    return {
      isFullFace: false,
      reason: 'Incomplete facial features detected. Full face required.',
      telemetry: null
    };
  }

  // Extract key points
  const leftEyeOuter = positions[36];
  const rightEyeOuter = positions[45];
  const noseBridge = positions[27];
  const noseTip = positions[30];
  const mouthLeft = positions[48];

  // 5. Yaw / Head turn check
  const leftDist = Math.abs(noseBridge.x - leftEyeOuter.x);
  const rightDist = Math.abs(rightEyeOuter.x - noseBridge.x);

  if (leftDist <= 0 || rightDist <= 0) {
    return {
      isFullFace: false,
      reason: 'Side profile detected. Please face the camera directly.',
      telemetry: null
    };
  }

  const yawRatio = leftDist / rightDist;
  if (yawRatio < 0.68) {
    return {
      isFullFace: false,
      reason: 'Face turned left. Look towards the camera.',
      telemetry: { yawRatio }
    };
  }
  if (yawRatio > 1.45) {
    return {
      isFullFace: false,
      reason: 'Face turned right. Look towards the camera.',
      telemetry: { yawRatio }
    };
  }

  // 6. Both eyes must be visible
  const eyeSpan = Math.hypot(rightEyeOuter.x - leftEyeOuter.x, rightEyeOuter.y - leftEyeOuter.y);
  const eyeSpanRatio = eyeSpan / box.width;
  if (eyeSpanRatio < 0.18) {
    return {
      isFullFace: false,
      reason: 'Both eyes must be clearly visible. Remove any obstructions.',
      telemetry: { eyeSpanRatio }
    };
  }

  // 7. Head tilt / Roll angle
  const dy = rightEyeOuter.y - leftEyeOuter.y;
  const dx = rightEyeOuter.x - leftEyeOuter.x;
  const tiltDegrees = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (tiltDegrees > 16) {
    return {
      isFullFace: false,
      reason: 'Head is tilted. Keep your head upright.',
      telemetry: { tiltDegrees }
    };
  }

  // 8. Basic vertical order check (eyes above nose, nose above mouth)
  const isVerticalOrderValid = (
    leftEyeOuter.y < noseTip.y &&
    noseTip.y < mouthLeft.y
  );

  if (!isVerticalOrderValid) {
    return {
      isFullFace: false,
      reason: 'Face angle too extreme. Look straight at the camera.',
      telemetry: null
    };
  }

  // 9. Eye Open / Eye Aspect Ratio (EAR) validation
  const getPointEAR = (pts) => {
    if (!pts || pts.length < 6) return 0.3;
    const v1 = Math.hypot(pts[1].x - pts[5].x, pts[1].y - pts[5].y);
    const v2 = Math.hypot(pts[2].x - pts[4].x, pts[2].y - pts[4].y);
    const h = Math.hypot(pts[0].x - pts[3].x, pts[0].y - pts[3].y);
    if (h <= 0.0001 || isNaN(h)) return 0.3;
    return (v1 + v2) / (2.0 * h);
  };

  const leftEyePts = detection.landmarks.getLeftEye ? detection.landmarks.getLeftEye() : positions.slice(36, 42);
  const rightEyePts = detection.landmarks.getRightEye ? detection.landmarks.getRightEye() : positions.slice(42, 48);
  const avgEAR = (getPointEAR(leftEyePts) + getPointEAR(rightEyePts)) / 2.0;

  if (avgEAR < 0.16) {
    return {
      isFullFace: false,
      reason: 'Eyes closed. Please keep both eyes open.',
      telemetry: { avgEAR, score }
    };
  }

  // Passed all checks!
  return {
    isFullFace: true,
    reason: 'Full frontal face verified.',
    telemetry: {
      yawRatio,
      tiltDegrees,
      eyeSpanRatio,
      avgEAR,
      score
    }
  };
};

export { faceapi };
