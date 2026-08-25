import fs from 'fs-extra';
import path from 'path';
import jpeg from 'jpeg-js';

function shiftCropAndExposure(rawImageData, shiftX = 5, shiftY = 5, brightnessShift = 6) {
  const pixels = rawImageData.data;
  const width = rawImageData.width;
  const height = rawImageData.height;
  
  const newPixels = new Uint8Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destIdx = (y * width + x) * 4;
      const srcX = x + shiftX;
      const srcY = y + shiftY;
      
      if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
        const srcIdx = (srcY * width + srcX) * 4;
        newPixels[destIdx] = Math.max(0, Math.min(255, pixels[srcIdx] + brightnessShift));
        newPixels[destIdx+1] = Math.max(0, Math.min(255, pixels[srcIdx+1] + brightnessShift));
        newPixels[destIdx+2] = Math.max(0, Math.min(255, pixels[srcIdx+2] + brightnessShift));
        newPixels[destIdx+3] = pixels[srcIdx+3];
      } else {
        // Replicate edge pixels to avoid hard black borders
        const clampX = Math.max(0, Math.min(width - 1, srcX));
        const clampY = Math.max(0, Math.min(height - 1, srcY));
        const srcIdx = (clampY * width + clampX) * 4;
        newPixels[destIdx] = Math.max(0, Math.min(255, pixels[srcIdx] + brightnessShift));
        newPixels[destIdx+1] = Math.max(0, Math.min(255, pixels[srcIdx+1] + brightnessShift));
        newPixels[destIdx+2] = Math.max(0, Math.min(255, pixels[srcIdx+2] + brightnessShift));
        newPixels[destIdx+3] = pixels[srcIdx+3];
      }
    }
  }
  
  return {
    width,
    height,
    data: newPixels
  };
}

async function main() {
  const fixturesDir = path.resolve('server/tests/fixtures');
  
  const targets = [
    { src: 'low_light.jpg', dest: 'low_light_probe.jpg' },
    { src: 'backlit.jpg', dest: 'backlit_probe.jpg' },
    { src: 'low_light_b.jpg', dest: 'low_light_b_probe.jpg' },
    { src: 'backlit_b.jpg', dest: 'backlit_b_probe.jpg' },
    { src: 'low_light_c.jpg', dest: 'low_light_c_probe.jpg' },
    { src: 'backlit_c.jpg', dest: 'backlit_c_probe.jpg' }
  ];
  
  for (const target of targets) {
    const srcPath = path.join(fixturesDir, target.src);
    const destPath = path.join(fixturesDir, target.dest);
    
    if (fs.existsSync(srcPath)) {
      console.log(`[PROBE GEN]: Generating ${target.dest} from ${target.src}...`);
      const fileBuffer = fs.readFileSync(srcPath);
      const rawData = jpeg.decode(fileBuffer);
      const processed = shiftCropAndExposure(rawData, 5, 5, 6);
      const outputBuffer = jpeg.encode(processed, 90).data;
      fs.writeFileSync(destPath, outputBuffer);
      console.log(`[PROBE GEN]: Saved ${target.dest} (${outputBuffer.length} bytes).`);
    } else {
      console.error(`[PROBE GEN ERROR]: Source file not found: ${srcPath}`);
    }
  }
}

main().catch(err => {
  console.error('[PROBE GEN FATAL ERROR]:', err);
});
