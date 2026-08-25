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
  
  const enrolledTensor = getTensorFromJpeg(path.join(fixturesDir, 'enrolled_face.jpg'), 1.0);
  const enrolledDet = await faceapi.detectSingleFace(enrolledTensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 }))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  enrolledTensor.dispose();
  const enrolledDesc = enrolledDet.descriptor;

  // Let's test a targeted list of sizes and gammas for backlit
  const optionsList = [
    { gamma: 1.0, size: 224, thresh: 0.15 },
    { gamma: 0.5, size: 224, thresh: 0.15 },
    { gamma: 0.4, size: 224, thresh: 0.15 },
    { gamma: 1.0, size: 320, thresh: 0.15 },
    { gamma: 0.5, size: 320, thresh: 0.15 },
    { gamma: 0.4, size: 320, thresh: 0.15 },
    { gamma: 1.0, size: 320, thresh: 0.1 },
    { gamma: 0.5, size: 320, thresh: 0.1 },
    { gamma: 0.4, size: 320, thresh: 0.1 },
  ];

  for (const opt of optionsList) {
    const tensor = getTensorFromJpeg(path.join(fixturesDir, 'backlit.jpg'), opt.gamma);
    const det = await faceapi.detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions({ inputSize: opt.size, scoreThreshold: opt.thresh }))
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
      console.log(`Backlit: Gamma=${opt.gamma}, Size=${opt.size}, Thresh=${opt.thresh} => Detected! Dist: ${dist.toFixed(4)}`);
    } else {
      console.log(`Backlit: Gamma=${opt.gamma}, Size=${opt.size}, Thresh=${opt.thresh} => Failed`);
    }
  }
}

main();
