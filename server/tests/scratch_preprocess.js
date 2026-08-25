import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import * as faceapi from '@vladmandic/face-api';

function getTensorFromJpeg(imagePath, applyPreprocessing = true) {
  const fileBuffer = fs.readFileSync(imagePath);
  const rawImageData = jpeg.decode(fileBuffer);
  
  if (applyPreprocessing) {
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
      gamma = 0.55;
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
        gamma = 0.45;
      }
    }
    
    console.log(`Image: ${path.basename(imagePath)} => avgLuminance: ${avgLuminance.toFixed(2)}, gamma applied: ${gamma}`);
    
    if (gamma !== 1.0) {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = Math.pow(pixels[i] / 255.0, gamma) * 255.0;       // R
        pixels[i+1] = Math.pow(pixels[i+1] / 255.0, gamma) * 255.0;   // G
        pixels[i+2] = Math.pow(pixels[i+2] / 255.0, gamma) * 255.0;   // B
      }
    }
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

async function main() {
  const modelPath = path.resolve('public/model');
  await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
  await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
  
  const fixturesDir = path.resolve('server/tests/fixtures');
  
  // Enroll clear face
  const enrolledTensor = getTensorFromJpeg(path.join(fixturesDir, 'enrolled_face.jpg'), false);
  const enrolledDet = await faceapi.detectSingleFace(enrolledTensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  enrolledTensor.dispose();
  
  const enrolledDesc = enrolledDet.descriptor;
  
  // Test low_light.jpg with preprocessing
  const lowLightTensor = getTensorFromJpeg(path.join(fixturesDir, 'low_light.jpg'), true);
  const lowLightDet = await faceapi.detectSingleFace(lowLightTensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  lowLightTensor.dispose();
  
  if (lowLightDet) {
    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = lowLightDet.descriptor[i] - enrolledDesc[i];
      sum += diff * diff;
    }
    const dist = Math.sqrt(sum);
    console.log(`Low Light with Preprocessing => Face Detected! Match Distance: ${dist.toFixed(4)}`);
  } else {
    console.log('Low Light with Preprocessing => Face NOT detected');
  }
  
  // Test backlit.jpg with preprocessing
  const backlitTensor = getTensorFromJpeg(path.join(fixturesDir, 'backlit.jpg'), true);
  const backlitDet = await faceapi.detectSingleFace(backlitTensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  backlitTensor.dispose();
  
  if (backlitDet) {
    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = backlitDet.descriptor[i] - enrolledDesc[i];
      sum += diff * diff;
    }
    const dist = Math.sqrt(sum);
    console.log(`Backlit with Preprocessing => Face Detected! Match Distance: ${dist.toFixed(4)}`);
  } else {
    console.log('Backlit with Preprocessing => Face NOT detected');
  }
}

main();
