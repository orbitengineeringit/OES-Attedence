/**
 * Futuristic Face Scanner overlay drawing engine.
 * Maps dynamic tracking meshes, tracking points, scan lines, and visual HUD stats.
 */
export class FaceDetectorRenderer {
  constructor(canvasElement, videoElement) {
    this.canvas = canvasElement;
    this.video = videoElement;
    this.ctx = canvasElement.getContext('2d');
    this.animationFrameId = null;
    this.scanProgress = 0;
    this.isScanning = false;
  }

  start() {
    this.isScanning = true;
    this.animate();
  }

  stop() {
    this.isScanning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  animate() {
    if (!this.isScanning) return;

    const { width, height } = this.canvas;
    const ctx = this.ctx;

    // 1. Clear Canvas for new frame
    ctx.clearRect(0, 0, width, height);

    // 2. Draw Futuristic Scanning Box Corners
    const boxSize = Math.min(width, height) * 0.65;
    const x = (width - boxSize) / 2;
    const y = (height - boxSize) / 2;
    
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxSize, boxSize);

    // Neon Cyan Corners
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 4;
    const len = 25;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x + boxSize - len, y); ctx.lineTo(x + boxSize, y); ctx.lineTo(x + boxSize, y + len);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x, y + boxSize - len); ctx.lineTo(x, y + boxSize); ctx.lineTo(x + len, y + boxSize);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x + boxSize - len, y + boxSize); ctx.lineTo(x + boxSize, y + boxSize); ctx.lineTo(x + boxSize, y + boxSize - len);
    ctx.stroke();

    // 3. Render Simulated Biometric Landmark Mesh Overlay
    // Generate organic-looking facial nodes constrained within the center box
    const centerX = width / 2;
    const centerY = height / 2;
    const time = Date.now() * 0.002;

    const landmarkPoints = [
      { x: centerX, y: centerY - 60 }, // Forehead Center
      { x: centerX - 40, y: centerY - 45 }, // Left Brow
      { x: centerX + 40, y: centerY - 45 }, // Right Brow
      { x: centerX - 30, y: centerY - 15 }, // Left Eye
      { x: centerX + 30, y: centerY - 15 }, // Right Eye
      { x: centerX, y: centerY + 10 }, // Nose Tip
      { x: centerX - 25, y: centerY + 45 }, // Left Cheek
      { x: centerX + 25, y: centerY + 45 }, // Right Cheek
      { x: centerX, y: centerY + 70 }, // Mouth Center
      { x: centerX, y: centerY + 100 }, // Chin
    ];

    // Add delicate animation movements to make them feel "alive"
    const animatedPoints = landmarkPoints.map((pt, idx) => {
      const offsetX = Math.sin(time + idx) * 3;
      const offsetY = Math.cos(time + idx) * 3;
      return { x: pt.x + offsetX, y: pt.y + offsetY };
    });

    // Draw mesh lines connecting points
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.lineWidth = 1;
    
    // Wireframe connections
    for (let i = 0; i < animatedPoints.length; i++) {
      for (let j = i + 1; j < animatedPoints.length; j++) {
        const dist = Math.hypot(animatedPoints[i].x - animatedPoints[j].x, animatedPoints[i].y - animatedPoints[j].y);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(animatedPoints[i].x, animatedPoints[i].y);
          ctx.lineTo(animatedPoints[j].x, animatedPoints[j].y);
          ctx.stroke();
        }
      }
    }

    // Draw glowing nodes
    animatedPoints.forEach((pt) => {
      ctx.fillStyle = '#06B6D4';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Outer glow
      ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 4. Moving Laser Scanning Line
    this.scanProgress = (this.scanProgress + 0.005) % 1.0;
    const laserY = y + boxSize * this.scanProgress;
    
    const grad = ctx.createLinearGradient(x, laserY, x + boxSize, laserY);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0)');
    grad.addColorStop(0.5, '#06B6D4');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0)');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, laserY);
    ctx.lineTo(x + boxSize, laserY);
    ctx.stroke();

    // Laser glow overlay
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#06B6D4';
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, laserY);
    ctx.lineTo(x + boxSize, laserY);
    ctx.stroke();
    
    // Reset shadow parameters for performance
    ctx.shadowBlur = 0;

    // 5. Draw Cybernetic HUD readouts
    ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
    ctx.font = '10px Courier New';
    
    // Telemetry Left Panel
    ctx.fillText(`LIVENESS INDEX : 0.985`, x + 10, y + 20);
    ctx.fillText(`SPOOFING COEFF : 0.084`, x + 10, y + 35);
    ctx.fillText(`BIOMETRIC LOCK : STABLE`, x + 10, y + 50);

    // Telemetry Right Panel
    ctx.textAlign = 'right';
    ctx.fillText(`FPS: 60`, x + boxSize - 10, y + 20);
    ctx.fillText(`MATCH THRESHOLD: 82%`, x + boxSize - 10, y + 35);
    ctx.textAlign = 'left';

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Generates a structural simulated descriptor coordinate array.
   */
  generateDescriptor(seed = 'guest') {
    const descriptor = [];
    // Generate 128 float values as a biometric fingerprint descriptor
    for (let i = 0; i < 128; i++) {
      let charVal = seed.charCodeAt(i % seed.length) / 128.0;
      descriptor.push(Math.sin(i * charVal) * 0.8 + 0.1);
    }
    return descriptor;
  }
}
