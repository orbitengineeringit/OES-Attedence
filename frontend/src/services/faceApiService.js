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

  // inputSize 160 gives ultra-fast face detection matching real-world biometric scanner terminals
  // scoreThreshold 0.4 allows faster detection at slight distance/angle
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 160,
    scoreThreshold: 0.4
  });

  const detection = await faceapi
    .detectSingleFace(videoElement, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  return detection;
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

  if (leftDist <= 0 || rightDist <= 0) return 'front';

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
 * Averages a list of descriptors into a single robust template vector.
 * @param {Array<Float32Array>} descriptors 
 * @returns {Array<number>}
 */
export const calculateAverageDescriptor = (descriptors) => {
  if (!descriptors || descriptors.length === 0) return null;
  const vectorLength = descriptors[0].length;
  const avg = new Array(vectorLength).fill(0);

  for (const desc of descriptors) {
    for (let i = 0; i < vectorLength; i++) {
      avg[i] += desc[i];
    }
  }

  return avg.map(val => val / descriptors.length);
};

export { faceapi };
