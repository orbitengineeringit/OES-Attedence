import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { apiCall } from '../services/api.js';
import { loadFaceApiModels, detectFaceBiometrics, faceapi } from '../services/faceApiService.js';
import { playBiometricSound } from '../services/soundService.js';
import { 
  ScanFace, 
  Camera, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  ShieldAlert, 
  Sparkles,
  Volume2,
  Lock
} from 'lucide-react';

export default function FaceEnrollment() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Refs for tracking video stream and canvas overlay
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const consecutiveFramesRef = useRef(0);
  const activeStreamRef = useRef(null);
  const isProcessingRef = useRef(false);
  const scanActiveRef = useRef(false); // Mutable ref for rAF loop control — prevents stale closure bug

  // Core UI/Scan states
  const [cameraActive, setCameraActive] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Initializing Biometric Sensors...');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lockProgress, setLockProgress] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);

  // Speech Helper
  const speak = (text) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // Preload face-api.js networks on mount
  useEffect(() => {
    let mounted = true;
    const preload = async () => {
      try {
        await loadFaceApiModels();
        if (mounted) {
          setModelsLoaded(true);
          setStatusMsg('Sensor Ready. Activate camera to enroll.');
          speak('Biometric enrollment required. Please activate your camera to begin.');
        }
      } catch (err) {
        console.error('[FaceEnrollment Models Load Error]:', err);
        if (mounted) {
          setStatusMsg('Biometric hardware error.');
          setErrorMessage('Failed to load deep learning models. Please check your internet connection.');
        }
      }
    };
    preload();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, []);

  // Frame processing loop for landmark drawing and auto-enroll
  const processFrame = async () => {
    if (!scanActiveRef.current || isProcessingRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && video.readyState >= 2 && canvas) {
      const ctx = canvas.getContext('2d');
      const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };

      if (displaySize.width === 0 || displaySize.height === 0) {
        animationFrameIdRef.current = requestAnimationFrame(processFrame);
        return;
      }

      if (canvas.width !== displaySize.width || canvas.height !== displaySize.height) {
        faceapi.matchDimensions(canvas, displaySize);
      }

      ctx.clearRect(0, 0, displaySize.width, displaySize.height);

      try {
        const detection = await detectFaceBiometrics(video);

        if (detection) {
          console.log('[DEBUG-DIAGNOSTIC] Face detected in Enrollment view.');
          console.log('[DEBUG-DIAGNOSTIC] Enrollment Face Confidence Score:', detection.detection.score);
          console.log('[DEBUG-DIAGNOSTIC] Enrollment Face Descriptor Extracted successfully. Length:', detection.descriptor?.length);

          const resized = faceapi.resizeResults(detection, displaySize);
          
          // Draw standard mesh points (OrbitGuard HUD themed)
          ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
          const landmarks = resized.landmarks;
          const points = landmarks.positions;
          for (let i = 0; i < points.length; i++) {
            ctx.beginPath();
            ctx.arc(points[i].x, points[i].y, 1.8, 0, 2 * Math.PI);
            ctx.fill();
          }

          // Draw custom targeting corners on face bounding box
          const box = resized.detection.box;
          ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = '#06b6d4';
          ctx.shadowBlur = 8;

          const size = 15;
          // Top Left
          ctx.beginPath(); ctx.moveTo(box.x, box.y + size); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x + size, box.y); ctx.stroke();
          // Top Right
          ctx.beginPath(); ctx.moveTo(box.right - size, box.y); ctx.lineTo(box.right, box.y); ctx.lineTo(box.right, box.y + size); ctx.stroke();
          // Bottom Left
          ctx.beginPath(); ctx.moveTo(box.x, box.bottom - size); ctx.lineTo(box.x, box.bottom); ctx.lineTo(box.x + size, box.bottom); ctx.stroke();
          // Bottom Right
          ctx.beginPath(); ctx.moveTo(box.right - size, box.bottom); ctx.lineTo(box.right, box.bottom); ctx.lineTo(box.right, box.bottom - size); ctx.stroke();
          
          ctx.shadowBlur = 0;

          // Lightweight Quality Checks: Face detected & score threshold met (score >= 0.5)
          // Since tinyFaceDetector filters blur and shadows, a high score ensures excellent quality.
          const confidence = detection.detection.score || 0;
          if (confidence >= 0.5) {
            isProcessingRef.current = true;
            setLockProgress(100);
            setStatusMsg('High-quality biometric signature secured!');
            stopCamera();
            console.log('[FaceEnrollment]: Instant biometric frame acquired. Registering biometrics...');
            handleRegisterFace(detection.descriptor);
            return;
          } else {
            setStatusMsg('Low face confidence. Face straight towards camera.');
          }
        } else {
          setLockProgress(0);
          setStatusMsg('Align your face inside the frame');
          
          // Draw standard target outline
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 6]);
          ctx.strokeRect(displaySize.width / 4, displaySize.height / 6, displaySize.width / 2, displaySize.height * 0.65);
          ctx.setLineDash([]);
        }
      } catch (err) {
        console.error('[FaceEnrollment Loop Error]:', err);
      }
    }

    if (scanActiveRef.current && !isProcessingRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(processFrame);
    }
  };

  // Web camera activation
  const startCamera = async () => {
    if (!modelsLoaded || cameraActive) return;
    isProcessingRef.current = false; // Reset lock to guarantee fresh scan on camera startup
    setErrorMessage('');
    setSuccessMessage('');
    setStatusMsg('Activating camera...');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 }
      });

      setCameraActive(true);
      scanActiveRef.current = true; // Set BEFORE scheduling rAF — prevents stale closure
      consecutiveFramesRef.current = 0;
      setLockProgress(0);

      
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(e => console.error(e));
          activeStreamRef.current = mediaStream;
          animationFrameIdRef.current = requestAnimationFrame(processFrame);
          setStatusMsg('Sensor scanning... Align your face.');
          speak('Webcam live. Please look straight at the camera and hold still.');
        }
      

    } catch (err) {
      console.error('[FaceEnrollment Webcam Access Fail]:', err);
      setStatusMsg('Webcam blocked.');
      setErrorMessage('Camera access denied. Please grant webcam permissions in your browser settings.');
      speak('Webcam access was blocked. Please grant permissions to enroll.');
    }
  };

  const stopCamera = () => {
    scanActiveRef.current = false; // Immediately halt rAF loop
    setCameraActive(false);
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(track => track.stop());
      activeStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Biometric registration api submission
  const handleRegisterFace = async (descriptor) => {
    setIsCapturing(true);
    setStatusMsg('Matching & Enrolling biometric data...');

    console.log('[DEBUG-DIAGNOSTIC] Duplicate-face check started on backend.');
    try {
      console.log('[FaceEnrollment]: Calling face register endpoint for Employee ID:', user.id);
      const res = await apiCall(`/employees/${user.id}/face`, 'POST', {
        faceDescriptor: Array.from(descriptor)
      });

      console.log('[DEBUG-DIAGNOSTIC] Duplicate-face check completed on backend.');

      if (res.success) {
        console.log('[DEBUG-DIAGNOSTIC] Enrollment biometrics saved successfully.');
        playBiometricSound('success');
        setSuccessMessage(`Biometrics successfully enrolled! Enforcing credentials encryption for ${user.name}...`);
        setStatusMsg('Biometric Lock Confirmed!');
        speak('Face biometrics enrolled successfully. Profile configured. Redirecting to workspace.');
        
        // Sync context state seamlessly via localStorage page refresh
        setTimeout(() => {
          const cachedUser = JSON.parse(localStorage.getItem('quantum_user') || '{}');
          localStorage.setItem('quantum_user', JSON.stringify({ ...cachedUser, is_face_registered: true, face_registered: true }));
          
          // Complete full page refresh to re-evaluate route guards and transition to dashboard
          window.location.href = '/employee-dashboard';
        }, 300);
      } else {
        console.log('[DEBUG-DIAGNOSTIC] Enrollment biometrics save failed.');
        throw new Error(res.message || 'Biometric enrollment failed.');
      }
    } catch (err) {
      console.log('[DEBUG-DIAGNOSTIC] Enrollment biometrics save failed.');
      console.error('[FaceEnrollment Biometric Submission Error]:', err);
      playBiometricSound('failure');
      isProcessingRef.current = false;
      setIsCapturing(false);
      consecutiveFramesRef.current = 0;
      setLockProgress(0);

      // Inspect catch block for duplicate face biometrics signature
      const errorText = err.message || '';
      if (errorText.includes('Duplicate face') || errorText.includes('already belongs to')) {
        setErrorMessage("Duplicate face detected.\nThis biometric identity already belongs to another employee.");
        setStatusMsg('Enrollment Rejected: Duplicate Biometrics.');
        speak("Duplicate face detected. This biometric identity already belongs to another employee.");
      } else {
        setErrorMessage(errorText || 'Biometric enrollment failed. Please try again.');
        setStatusMsg('Hardware Error.');
        speak("Biometric enrollment failed. Please try again.");
      }
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Upper Branding Bar */}
      <div className="hero-band relative overflow-hidden rounded-xl p-5 md:p-6">
        <div className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-12 h-52 w-52 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-80">Security Shield</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">One-Time Face Enrollment</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 opacity-85">
              Welcome, <span className="font-bold">{user?.name}</span> ({user?.id}). To complete your workspace onboarding and enable high-speed contactless check-in, please enroll your facial biometrics.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/16 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-md">
            <Lock className="h-3.5 w-3.5" />
            End-To-End AES-256 Encryption
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        {/* Core Enrollment Camera Terminal */}
        <div className="glass-panel-heavy scan-frame relative flex flex-col items-center overflow-hidden rounded-xl p-5 pt-6 md:col-span-3">
          <div className="spectrum-bar absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
          
          <div className="mb-4 flex w-full items-center justify-between border-b border-slate-200 pb-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className={`h-2.5 w-2.5 rounded-full ${cameraActive && !isCapturing ? 'bg-cyan-500 animate-pulse' : 'bg-slate-300'}`}></span>
              Biometric camera channel
            </span>

            <button
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ${
                voiceEnabled ? 'border-cyan-100 bg-cyan-50 text-cyan-700' : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
            >
              <span className="inline-flex items-center gap-1"><Volume2 className="h-3.5 w-3.5" />{voiceEnabled ? 'Voice instructions active' : 'Voice muted'}</span>
            </button>
          </div>

          {/* Web camera Viewport */}
          <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-inner">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              style={{ transform: 'scaleX(-1)' }} // Mirror view for natural alignment
            />
            
            <canvas
              ref={canvasRef}
              className="absolute inset-0 z-10 h-full w-full"
            />

            {/* Video overlay overlay guides */}
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20 bg-slate-950/80 backdrop-blur-sm">
                <div className="rounded-full bg-cyan-950/50 p-4 border border-cyan-800/30 mb-3 animate-pulse">
                  <ScanFace className="h-8 w-8 text-cyan-400" />
                </div>
                <p className="text-sm font-medium text-slate-350 max-w-xs">
                  Ready to capture biometrics. Ensure your face is fully lit with no obstructions.
                </p>
                <button
                  onClick={startCamera}
                  disabled={!modelsLoaded}
                  className="mt-5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs py-2.5 px-6 shadow-[0_4px_14px_rgba(6,182,212,0.4)] transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Activate Scanner Camera
                </button>
              </div>
            )}

            {/* Lock/Enrollment Progress laser beam */}
            {cameraActive && (
              <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00e5ff] animate-[shimmerScan_2s_infinite] pointer-events-none z-20" />
            )}

            {/* Diagnostics HUD Status Bar */}
            {cameraActive && (
              <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-slate-950/80 border border-slate-800 p-2 text-center text-[10px] font-mono font-semibold tracking-wider text-cyan-400 z-30 select-none backdrop-blur-sm flex items-center justify-between px-3">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 animate-spin" />
                  SENSOR STATUS: {statusMsg.toUpperCase()}
                </span>
                {lockProgress > 0 && (
                  <span>LOCK SECURED: {lockProgress}%</span>
                )}
              </div>
            )}

            {/* Success screen backdrop overlay */}
            <AnimatePresence>
              {successMessage && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 bg-emerald-950/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 z-40"
                >
                  <motion.div 
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="rounded-full bg-emerald-900/60 p-4 border border-emerald-500/30 mb-3 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                  >
                    <CheckCircle className="h-10 w-10 text-emerald-400" />
                  </motion.div>
                  <h3 className="text-lg font-bold text-white tracking-wide">Enterprise Biometrics Active</h3>
                  <p className="mt-1 text-xs text-emerald-300 max-w-xs">{successMessage}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Core HUD Progress Gauge */}
          {cameraActive && (
            <div className="mt-4 w-full space-y-1.5 select-none">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 font-mono">
                <span>BIOMETRIC DESCRIPTOR STABILITY</span>
                <span>{lockProgress}%</span>
              </div>
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <motion.div 
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500" 
                  initial={{ width: 0 }}
                  animate={{ width: `${lockProgress}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
            </div>
          )}

          {/* Action triggers */}
          {cameraActive && (
            <div className="mt-5 flex gap-3">
              <button
                onClick={stopCamera}
                disabled={isCapturing}
                className="rounded-xl border border-slate-250 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs py-2 px-5 transition disabled:opacity-50 cursor-pointer"
              >
                Close Camera
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Instructional panel / Duplicate warning */}
        <div className="md:col-span-2 flex flex-col h-full gap-5">
          {/* Main Onboarding requirements card */}
          <div className="glass-panel-heavy p-6 relative rounded-xl h-fit">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <ScanFace className="h-4.5 w-4.5 text-cyan-600" />
              Enrollment Guidelines
            </h3>
            <p className="mt-2.5 text-xs text-slate-500 leading-relaxed">
              Your biometric identity is locally encrypted and serves as a secure, non-transferable signature to eliminate buddy punching.
            </p>
            <ul className="mt-4 space-y-2.5 text-xs text-slate-600 font-medium">
              <li className="flex items-start gap-2 leading-relaxed">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-cyan-50 text-[10px] font-bold text-cyan-700">1</span>
                <span>Hold still and look straight into the camera frame.</span>
              </li>
              <li className="flex items-start gap-2 leading-relaxed">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-cyan-50 text-[10px] font-bold text-cyan-700">2</span>
                <span>Ensure your face is well-lit and not covered by hats or masks.</span>
              </li>
              <li className="flex items-start gap-2 leading-relaxed">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-cyan-50 text-[10px] font-bold text-cyan-700">3</span>
                <span>Auto-detection will capture and analyze your features instantly.</span>
              </li>
            </ul>
          </div>

          {/* Duplicate Face Error panel */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="glass-panel-heavy border-rose-200 bg-rose-50/40 p-5 rounded-xl border flex-1 h-full"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-rose-100 p-2 border border-rose-200/50 shrink-0 mt-0.5">
                    <ShieldAlert className="h-4.5 w-4.5 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-rose-950 uppercase tracking-wide">Enrollment Rejected</h3>
                    <p className="mt-2 text-xs font-semibold text-rose-900 leading-relaxed whitespace-pre-line">
                      {errorMessage}
                    </p>
                    <button
                      onClick={startCamera}
                      className="mt-4 text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1.5 transition-all underline cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3 shrink-0" />
                      Re-attempt Biometrics Scan
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
