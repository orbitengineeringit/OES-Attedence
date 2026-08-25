/**
 * High-Tech Biometric Sound Synthesizer
 * Utilizes the browser's native Web Audio API to generate premium, retro-futuristic sound effects.
 * Avoids the need for external static sound assets, ensuring robust and instantaneous playback.
 */

export const playBiometricSound = (type) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      console.warn('[SOUND SERVICE]: Web Audio API is not supported by this browser.');
      return;
    }
    
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    if (type === 'success') {
      // Premium two-tone rising cyber chime (sweet "ding-dong" confirm sound)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.type = 'sine';
      osc2.type = 'triangle';
      
      // Rising high-tech frequency: 587.33 Hz (D5) -> 880.00 Hz (A5)
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc1.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
      
      osc2.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
      
      // Fine-grained volume envelope to produce a beautiful electronic chime decay
      gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.65);
      osc2.stop(ctx.currentTime + 0.65);
      
      console.log('[SOUND SERVICE]: Success chime played.');
    } else if (type === 'failure') {
      // Futuristic alarm buzzer (heavy sawtooth drop dropping from 140Hz to 75Hz)
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(75, ctx.currentTime + 0.32);
      
      gainNode.gain.setValueAtTime(0.18, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      
      console.log('[SOUND SERVICE]: Failure buzzer played.');
    } else if (type === 'capture' || type === 'click') {
      // High-tech reticle laser target click
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1100, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 0.09);
      
      gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    }
  } catch (err) {
    console.warn('[SOUND SERVICE EXCEPTION]: Web Audio playback blocked or failed.', err);
  }
};
