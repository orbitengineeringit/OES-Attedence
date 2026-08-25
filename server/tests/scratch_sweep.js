import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import * as faceapi from '@vladmandic/face-api';

function getTensorFromJpeg(imagePath, gamma = 1.0) {
  const fileBuffer = fs.readFileSync(imagePath);
  const rawImageData = jpeg.decode(fileBuffer);
  const pixels = rawImageData.data;
  
  if (gamma !== 1.0) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = Math.pow(pixels[i] / 255.0, gamma) * 255.0;
      pixels[i+1] = Math.pow(pixels[i+1] / 255.0, gamma) * 255.0;
      pixels[i+2] = Math.pow(pixels[i+2] / 255.0, gamma) * 255.0;
    }
  }
  
  const numPixels = rawImageData.width * rawImageData.height;
  const rgbData = new Uint8Array(numPixels * 3);
  for (let i = 0; i < numPixels; i++) {
    rgbData[i * 3] = rawImageData.data[i * 4];
    rgbData[i * 3 + 1] = rawImageData.data[i * 4 + 1];
    rgbData[i * 3 + 2] = rawImageData.data[i * 4 + 2];
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
  const enrolledTensor = getTensorFromJpeg(path.join(fixturesDir, 'enrolled_face.jpg'), 1.0);
  const enrolledDet = await faceapi.detectSingleFace(enrolledTensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  enrolledTensor.dispose();
  
  if (!enrolledDet) {
    console.log('Failed to detect enrolled face!');
    return;
  }
  const enrolledDesc = enrolledDet.descriptor;
  
  // Test parameters
  const gammas = [1.0, 0.4, 0.5, 0.6, 0.7];
  const sizes = [160, 224, 320, 416];
  const thresholds = [0.1, 0.15, 0.2, 0.3, 0.4];
  
  console.log('--- TEST LOW LIGHT ---');
  for (const gamma of gammas) {
    for (const size of sizes) {
      for (const thresh of thresholds) {
        const tensor = getTensorFromJpeg(path.join(fixturesDir, 'low_light.jpg'), gamma);
        const det = await faceapi.detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: thresh }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        tensor.dispose();
        
        if (det) {
          let sum = 0;
          for (let i = 0; i < 128; i++) {
            const diff = det.descriptor[i] - enrolledDesc[i];
            sum += diff * diff;
          }
          const dist = Math.sqrt(sum);
          if (dist < 0.75) {
            console.log(`Low Light: Gamma=${gamma}, Size=${size}, Thresh=${thresh} => Face detected! Distance: ${dist.toFixed(4)}`);
          }
        }
      }
    }
  }
  
  console.log('--- TEST BACKLIT ---');
  for (const gamma of gammas) {
    for (const size of sizes) {
      for (const thresh of thresholds) {
        const tensor = getTensorFromJpeg(path.join(fixturesDir, 'backlit.jpg'), gamma);
        const det = await faceapi.detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: thresh }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        tensor.dispose();
        
        if (det) {
          let sum = 0;
          for (let i = 0; i < 128; i++) {
            const diff = det.descriptor[i] - enrolledDesc[i];
            sum += diff * diff;
          }
          const dist = Math.sqrt(sum);
          console.log(`Backlit: Gamma=${gamma}, Size=${size}, Thresh=${thresh} => Face detected! Distance: ${dist.toFixed(4)}`);
        }
      }
    }
  }
}

main();
