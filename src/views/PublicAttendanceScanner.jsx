import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { loadFaceApiModels, detectFaceBiometrics, validateFullFaceEnrollment, faceapi } from '../services/faceApiService.js';
import { playBiometricSound } from '../services/soundService.js';
import { calculateAverageEAR, processBlinkState } from '../components/scanner/BlinkDetector.js';
import { submitPublicAttendanceScan } from '../components/scanner/AttendanceProcessor.js';
import { speakGreeting } from '../components/scanner/VoiceAssistant.js';
import { apiCall } from '../services/api.js';
import CameraFeed from '../components/scanner/CameraFeed.jsx';
import FaceMeshOverlay, { drawCustomDetections, drawCustomMesh, drawScanningCrosshairs } from '../components/scanner/FaceMeshOverlay.jsx';
import { ShieldCheck, Camera, UserCheck, AlertCircle, Clock, MapPin, CheckCircle2, XCircle, RefreshCw, Building2, Sparkles, LogIn } from 'lucide-react';

export default function PublicAttendanceScanner() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const activeStreamRef = useRef(null);
  const latestDetectionRef = useRef(null);

  // States
  const [modelsStatus, setModelsStatus] = useState('loading'); // loading, ready, error
  const [cameraActive, setCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Initializing biometric hardware...');
  
  // Verification states
  const [faceDetected, setFaceDetected] = useState(false);
  const [livenessVerified, setLivenessVerified] = useState(false);
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [userCoords, setUserCoords] = useState(null);
  const [gpsStatus, setGpsStatus] = useState({ acquired: false, message: 'Locating GPS...' });
  const [geofenceStatus, setGeofenceStatus] = useState({ inside: false, message: 'Checking geofence...' });
  
  // Execution & Result state
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  const [currentDateStr, setCurrentDateStr] = useState('');

  // EAR tracking refs for blink detection
  const blinkClosedRef = useRef(false);
  const blinkDetectedRef = useRef(false);
  const latestDescriptorRef = useRef(null);
  const scanInProgressRef = useRef(false);
  const isComponentMounted = useRef(true);

  // Active Challenge States
  const [livenessChallenge, setLivenessChallenge] = useState('blink'); // 'blink' | 'turn_left' | 'turn_right'
  const [challengePassed, setChallengePassed] = useState(false);
  const [headTurnRatio, setHeadTurnRatio] = useState(0.5);
  const challengePassedRef = useRef(false);
  const keyLandmarksRef = useRef([]);
  const challengeSessionIdRef = useRef(null);
  const [frameQualityWarning, setFrameQualityWarning] = useState(null);

  // Clock tick
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCurrentDateStr(now.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Preload face-api models
  useEffect(() => {
    isComponentMounted.current = true;
    const init = async () => {
      try {
        setModelsStatus('loading');
        setStatusMsg('Loading neural recognition models...');
        await loadFaceApiModels();
        if (isComponentMounted.current) {
          setModelsStatus('ready');
          setStatusMsg('Models ready. Starting camera...');
          autoStartCamera();
        }
      } catch (err) {
        console.error('[PUBLIC SCANNER]: Model load error', err);
        if (isComponentMounted.current) {
          setModelsStatus('error');
          setStatusMsg('Failed to load biometric models.');
        }
      }
    };
    init();

    return () => {
      isComponentMounted.current = false;
      stopCamera();
    };
  }, []);

  // Geolocation tracking
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus({ acquired: false, message: 'Geolocation unsupported by browser.' });
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isComponentMounted.current) return;
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserCoords(coords);
        setGpsStatus({ acquired: true, message: 'GPS Locked' });

        // Evaluate distance to office settings
        apiCall('/settings', 'GET').then(res => {
          if (res?.success && res?.settings) {
            const officeLat = parseFloat(res.settings.geofence_lat) || 28.6139;
            const officeLng = parseFloat(res.settings.geofence_lng) || 77.2090;
            const radius = parseInt(res.settings.geofence_radius, 10) || 100;

            const dist = calculateHaversineDistance(coords.latitude, coords.longitude, officeLat, officeLng);
            const inside = dist <= radius;
            setGeofenceStatus({
              inside,
              message: inside ? 'Inside Office Radius' : `Outside Radius (${Math.round(dist - radius)}m away)`
            });
          }
        }).catch(err => console.warn('Geofence check error:', err));
      },
      (err) => {
        if (!isComponentMounted.current) return;
        setGpsStatus({ acquired: false, message: 'GPS Access Denied / Unavailable' });
        setGeofenceStatus({ inside: false, message: 'GPS Unavailable' });
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Haversine formula
  function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const fetchChallenge = async () => {
    try {
      const res = await apiCall('/attendance/challenge', 'GET');
      if (res && res.challengeType) {
        setLivenessChallenge(res.challengeType);
        challengeSessionIdRef.current = res.challengeSessionId;
        setChallengePassed(false);
        challengePassedRef.current = false;
        blinkDetectedRef.current = false;
        setBlinkDetected(false);
        keyLandmarksRef.current = [];
        return;
      }
    } catch (err) {
      console.warn('[PublicAttendanceScanner] Falling back to client-generated challenge:', err);
    }
    const challenges = ['blink', 'turn_left', 'turn_right'];
    const randomChallenge = challenges[Math.floor(Math.random() * challenges.length)];
    setLivenessChallenge(randomChallenge);
    challengeSessionIdRef.current = 'session_' + Math.random().toString(36).substring(2) + '_' + Date.now();
    setChallengePassed(false);
    challengePassedRef.current = false;
    blinkDetectedRef.current = false;
    setBlinkDetected(false);
    keyLandmarksRef.current = [];
  };

  // Camera start / stop
  const autoStartCamera = async () => {
    if (cameraActive || isStartingCamera) return;
    try {
      await fetchChallenge();

      setIsStartingCamera(true);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });

      activeStreamRef.current = mediaStream;
      setCameraActive(true);
      setIsStartingCamera(false);
      setStatusMsg('Position your face in frame...');

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
          requestAnimationFrame(processFrame);
        }
      }, 50);
    } catch (err) {
      console.error('Camera permissions denied or device missing:', err);
      setIsStartingCamera(false);
      setStatusMsg('Camera permission required. Please allow camera access.');
    }
  };

  const stopCamera = () => {
    if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
    }
    setCameraActive(false);
  };

  // Main frame processing loop
  const processFrame = async () => {
    if (!isComponentMounted.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && video.readyState >= 2 && canvas) {
      const ctx = canvas.getContext('2d');
      const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };

      if (displaySize.width > 0 && displaySize.height > 0) {
        if (canvas.width !== displaySize.width || canvas.height !== displaySize.height) {
          faceapi.matchDimensions(canvas, displaySize);
        }
        ctx.clearRect(0, 0, displaySize.width, displaySize.height);

        try {
          // 1. Run live frame quality check
          const { checkFrameQuality } = await import('../services/faceApiService.js');
          const quality = checkFrameQuality(video);
          if (!quality.passed) {
            setFrameQualityWarning(quality.warning);
            setStatusMsg(quality.warning.toUpperCase());
            
            ctx.strokeStyle = '#F59E0B'; // Amber alert warning box
            ctx.lineWidth = 3;
            ctx.strokeRect(15, 15, displaySize.width - 30, displaySize.height - 30);
            
            ctx.font = '16px sans-serif';
            ctx.fillStyle = '#F59E0B';
            ctx.fillText(quality.warning, 30, 40);
            
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }
          setFrameQualityWarning(null);

          // 2. Run face detection
          const rawDetection = await detectFaceBiometrics(video);

          // 3. Reject if multiple faces detected
          if (rawDetection && rawDetection.multipleFaces) {
            setStatusMsg('MULTIPLE FACES DETECTED');
            challengePassedRef.current = false;
            setChallengePassed(false);
            
            ctx.strokeStyle = '#EF4444'; // Red error box
            ctx.lineWidth = 3;
            ctx.strokeRect(15, 15, displaySize.width - 30, displaySize.height - 30);
            
            ctx.font = '16px sans-serif';
            ctx.fillStyle = '#EF4444';
            ctx.fillText('Multiple faces detected! Only 1 person allowed.', 30, 40);
            
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
            return;
          }

          if (rawDetection) {
            // 4. Validate that this is a COMPLETE FULL-FRONTAL FACE (reject cut-off, side-profile, or partial face)
            const fullFaceValidation = validateFullFaceEnrollment(rawDetection, displaySize.width, displaySize.height);
            if (!fullFaceValidation.isFullFace) {
              setFaceDetected(false);
              setLivenessVerified(false);
              challengePassedRef.current = false;
              setChallengePassed(false);
              latestDetectionRef.current = null;
              setStatusMsg(fullFaceValidation.reason);

              ctx.strokeStyle = '#F59E0B'; // Amber alert warning box
              ctx.lineWidth = 3;
              ctx.strokeRect(15, 15, displaySize.width - 30, displaySize.height - 30);
              ctx.font = '14px sans-serif';
              ctx.fillStyle = '#F59E0B';
              ctx.fillText(fullFaceValidation.reason, 30, 40);

              const resized = faceapi.resizeResults(rawDetection, displaySize);
              drawCustomDetections(ctx, resized, false);

              animationFrameIdRef.current = requestAnimationFrame(processFrame);
              return;
            }

            setFaceDetected(true);
            latestDetectionRef.current = rawDetection;
            latestDescriptorRef.current = rawDetection.descriptor;

            // Liveness challenge: auto-pass as soon as a valid face is detected
            if (rawDetection.landmarks) {
              const positions = rawDetection.landmarks.positions;
              const jawLeft = positions[0];
              const jawRight = positions[16];
              const noseTip = positions[30];

              if (jawLeft && jawRight && noseTip) {
                keyLandmarksRef.current = [
                  { x: jawLeft.x, y: jawLeft.y },
                  { x: jawRight.x, y: jawRight.y },
                  { x: noseTip.x, y: noseTip.y }
                ];

                const normNose = (noseTip.x - jawLeft.x) / (jawRight.x - jawLeft.x);
                setHeadTurnRatio(normNose);
              }

              // Record blink data for server verification but do not block on it
              const leftEye = rawDetection.landmarks.getLeftEye();
              const rightEye = rawDetection.landmarks.getRightEye();
              const ear = calculateAverageEAR(leftEye, rightEye);

              const blinkState = processBlinkState(ear, blinkClosedRef.current);
              blinkClosedRef.current = blinkState.isClosed;

              if (blinkState.isBlinkDetected || ear < 0.22) {
                blinkDetectedRef.current = true;
                setBlinkDetected(true);
              }
            }

            // Verify Active Liveness Challenge
            let passedChallenge = false;
            if (livenessChallenge === 'blink') {
              passedChallenge = blinkDetectedRef.current;
            } else if (livenessChallenge === 'turn_left') {
              passedChallenge = headTurnRatio < 0.42;
            } else if (livenessChallenge === 'turn_right') {
              passedChallenge = headTurnRatio > 0.58;
            }

            if (passedChallenge && !challengePassedRef.current) {
              challengePassedRef.current = true;
              setChallengePassed(true);
            }

            const verified = challengePassedRef.current;
            setLivenessVerified(verified);

            const resized = faceapi.resizeResults(rawDetection, displaySize);
            drawCustomDetections(ctx, resized, verified);
            drawCustomMesh(ctx, resized.landmarks, verified);

            setStatusMsg('Face detected — click Scan Face to mark attendance');

          } else {
            setFaceDetected(false);
            setLivenessVerified(false);
            latestDetectionRef.current = null;
            drawScanningCrosshairs(ctx, displaySize.width, displaySize.height);
            setStatusMsg('Scanning for face...');
          }
        } catch (err) {
          console.warn('Frame processing exception:', err);
        }
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  };

  // Handle Scan Face trigger
  const handleExecuteScan = async () => {
    if (isProcessing || scanInProgressRef.current) return;

    setIsProcessing(true);
    scanInProgressRef.current = true;
    setScanResult(null);
    setStatusMsg('Verifying biometrics, GPS, and geofence...');

    try {
      if (!userCoords) {
        throw new Error('GPS Available: Failed. Location access is disabled or unavailable.');
      }
      if (!latestDetectionRef.current) {
        throw new Error('Full face not detected. Please align your entire face inside the frame.');
      }
      const fullFaceCheck = validateFullFaceEnrollment(latestDetectionRef.current, 640, 480);
      if (!fullFaceCheck.isFullFace) {
        throw new Error(fullFaceCheck.reason);
      }
      if (!challengePassedRef.current) {
        throw new Error('Liveness: Failed. Challenge has not been completed yet.');
      }

      const response = await submitPublicAttendanceScan(
        latestDescriptorRef.current,
        userCoords,
        blinkDetectedRef.current,
        livenessChallenge,
        challengePassed,
        headTurnRatio,
        keyLandmarksRef.current,
        challengeSessionIdRef.current
      );

      playBiometricSound('success');
      speakGreeting(`Welcome ${response.employee?.name || 'Employee'}. Attendance recorded.`);
      setScanResult({
        success: true,
        name: response.employee?.name || 'Employee',
        avatar: response.employee?.avatar || null,
        message: response.message || 'Attendance Marked Successfully',
        date: response.date || currentDateStr,
        time: response.time || currentTimeStr,
        alreadyCompleted: response.alreadyCompleted || false
      });
      setStatusMsg('Attendance Marked Successfully');

      // Auto-reset after 5s for the next employee
      setTimeout(() => {
        if (isComponentMounted.current) {
          setScanResult(prev => (prev?.success ? null : prev));
          fetchChallenge();
        }
      }, 5000);
    } catch (err) {
      console.error('[PUBLIC SCAN FAILURE]:', err);
      playBiometricSound('failure');

      // [M-07 FIX]: Map server reason codes to distinct user-facing messages.
      const reason = err.response?.reason || err.reason || '';
      const serverMessage = err.response?.message || err.message || '';

      const reasonMessages = {
        GPS_UNAVAILABLE: { title: 'GPS Required', subtext: 'Please enable location access in your browser and try again.' },
        GEOFENCE_INVALID: { title: 'Outside Office Premises', subtext: serverMessage || 'You must be inside the office area to mark attendance.' },
        LIVENESS_FAILED: { title: 'Liveness Check Failed', subtext: 'Please blink naturally during the scan to confirm you are present.' },
        FACE_NOT_RECOGNIZED: { title: 'Face Not Recognized', subtext: 'Please contact your HR administrator to verify your enrollment.' },
        STALE_REQUEST: { title: 'Request Expired', subtext: 'The scan request timed out. Please try again.' },
        RATE_LIMITED: { title: 'Too Many Attempts', subtext: 'Please wait a moment before trying again.' },
        VELOCITY_BREACH: { title: 'Location Anomaly Detected', subtext: 'Suspicious travel speed detected. Please contact HR.' },
        INVALID_DESCRIPTOR: { title: 'Scan Error', subtext: 'Face data could not be captured. Please position your face clearly and retry.' },
      };

      const mapped = reasonMessages[reason] || { title: 'Verification Failed', subtext: serverMessage || 'Please try again or contact HR.' };
      speakGreeting(mapped.title + '. ' + mapped.subtext);

      setScanResult({
        success: false,
        isUnrecognized: reason === 'FACE_NOT_RECOGNIZED',
        message: mapped.title,
        subtext: mapped.subtext
      });
      setStatusMsg('Attendance Failed');

      // Auto-reset on error after 6s
      setTimeout(() => {
        if (isComponentMounted.current) {
          setScanResult(prev => (!prev?.success ? null : prev));
          fetchChallenge();
        }
      }, 6000);

    } finally {
      setIsProcessing(false);
      scanInProgressRef.current = false;
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-800 flex flex-col items-center justify-between p-4 md:p-8 font-sans select-none relative overflow-hidden">
      {/* Top Header Card */}
      <motion.header 
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl flex items-center justify-between py-3 px-5 sm:px-6 rounded-2xl bg-white border border-slate-200 shadow-sm mb-6 relative z-10"
      >
        {/* Left: Orbit Logo in Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-900 p-1 border border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
            <img 
              src="/orbit_logo.png" 
              alt="Orbit Logo" 
              className="w-full h-full object-contain"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <ShieldCheck className="w-5 h-5 text-indigo-400 hidden" />
          </div>

          <div>
            <h1 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight leading-tight">
              Orbit Engineering Solutions
            </h1>
            <p className="text-[11px] text-slate-500 font-medium leading-tight">
              Biometric attendance verification terminal
            </p>
          </div>
        </div>

        {/* Right: Realtime Clock & Date + Login Navigation Button */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm sm:text-base font-semibold text-indigo-700">{currentTimeStr}</div>
            <div className="text-[11px] text-slate-500">{currentDateStr}</div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-600 hover:text-white text-indigo-700 font-semibold text-xs rounded-xl shadow-xs transition-all duration-150 cursor-pointer"
            title="Switch to Portal Login"
          >
            <LogIn className="w-4 h-4" />
            <span>Login</span>
          </button>
        </div>
      </motion.header>

      {/* Main Terminal Container */}
      <main className="w-full max-w-2xl flex-1 flex flex-col items-center justify-center relative z-10 my-auto">
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="w-full bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm flex flex-col items-center relative overflow-hidden"
        >
          {/* Camera Viewport Container */}
          <div className="relative w-full aspect-[16/10] min-h-[340px] sm:min-h-[380px] bg-slate-950 rounded-xl overflow-hidden border border-slate-200 shadow-inner flex flex-col justify-between group">
            
            {/* Top Viewport Status HUD Bar */}
            <div className="relative top-0 left-0 right-0 px-3.5 py-2 bg-white/95 border-b border-slate-200 flex items-center justify-between text-xs backdrop-blur-md z-20">
              <span className="flex items-center gap-2 font-medium text-slate-900">
                <span className={`w-2 h-2 rounded-full ${cameraActive ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'}`} />
                <span>{statusMsg}</span>
              </span>
              <span className="font-semibold text-indigo-700 text-xs">{currentTimeStr}</span>
            </div>

            {/* Camera Video Stream & Canvas Overlay */}
            <div className="relative flex-1 w-full h-full bg-slate-950">
              <CameraFeed 
                videoRef={videoRef}
                cameraActive={cameraActive}
                modelsStatus={modelsStatus}
                onStartCamera={autoStartCamera}
                isStarting={isStartingCamera}
              />

              {cameraActive && (
                <FaceMeshOverlay canvasRef={canvasRef} cooldownState={isProcessing} />
              )}
            </div>

            {/* Bottom Status Telemetry Cards inside Camera Viewport */}
            <div className="relative bottom-0 left-0 right-0 p-2.5 bg-white/95 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 z-20 backdrop-blur-md">
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                <UserCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="text-[11px] truncate">
                  <span className="block text-slate-400 text-[10px]">Face</span>
                  <span className={faceDetected ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                    {faceDetected ? 'Detected' : 'Scanning'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="text-[11px] truncate">
                  <span className="block text-slate-400 text-[10px]">Liveness</span>
                  <span className={livenessVerified ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                    {livenessVerified ? 'Verified' : 'Checking'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="text-[11px] truncate">
                  <span className="block text-slate-400 text-[10px]">Challenge</span>
                  <span className={challengePassed ? 'text-emerald-700 font-semibold' : 'text-slate-600'}>
                    {livenessChallenge === 'blink' ? 'Blink' : (livenessChallenge === 'turn_left' ? 'Turn left' : 'Turn right')}
                    {challengePassed ? ' (Passed)' : ' (Req)'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="text-[11px] truncate">
                  <span className="block text-slate-400 text-[10px]">Zone</span>
                  <span className={geofenceStatus.inside ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                    {geofenceStatus.inside ? 'Inside office' : 'Outside'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Trigger Button with Dynamic Guidance */}
          <div className="mt-5 w-full flex flex-col items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleExecuteScan}
              disabled={isProcessing || modelsStatus !== 'ready' || !faceDetected}
              className={`w-full max-w-sm py-3 px-6 rounded-xl font-semibold text-sm tracking-wide flex items-center justify-center gap-2.5 transition-all duration-200 min-h-[48px] ${
                isProcessing
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : modelsStatus !== 'ready'
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  : !faceDetected
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md cursor-pointer'
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-600" />
                  <span>Verifying biometrics...</span>
                </>
              ) : modelsStatus !== 'ready' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                  <span>Loading AI models...</span>
                </>
              ) : !faceDetected ? (
                <>
                  <UserCheck className="w-4 h-4 text-slate-400" />
                  <span>Position full face in frame</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>Scan face for attendance</span>
                </>
              )}
            </button>
            
            {/* Realtime guidance under the button */}
            <p className="text-[11px] text-slate-500 text-center font-medium">
              {!faceDetected
                ? 'Align your full face in the center of the camera to activate.'
                : isProcessing
                ? 'Please wait while biometrics are being verified...'
                : '✓ Face detected! Click the button above to mark your attendance.'}
            </p>
          </div>
        </motion.div>

        {/* Attendance Result Card */}
        <AnimatePresence mode="wait">
          {scanResult && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="mt-5 w-full max-w-2xl p-6 rounded-2xl border bg-white shadow-md flex flex-col items-center text-center space-y-4 relative z-30"
              style={{
                borderColor: scanResult.success ? '#a7f3d0' : '#fecaca',
              }}
            >
              {scanResult.success ? (
                <>
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.05 }}
                    className="p-3 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200"
                  >
                    <CheckCircle2 className="w-10 h-10" />
                  </motion.div>

                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-slate-900">
                      Welcome, {scanResult.name}
                    </h2>
                    <p className="text-sm font-medium text-emerald-700">
                      {scanResult.message}
                    </p>
                  </div>

                  <div className="w-full pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <span className="block text-[11px] text-slate-500 font-medium mb-0.5">Date</span>
                      <span className="text-sm font-semibold text-slate-900">{scanResult.date}</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <span className="block text-[11px] text-slate-500 font-medium mb-0.5">Time</span>
                      <span className="text-sm font-semibold text-slate-900">{scanResult.time}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setScanResult(null);
                      fetchChallenge();
                    }}
                    className="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    Scan next employee
                  </button>
                </>
              ) : (
                <>
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring' }}
                    className="p-3 rounded-full bg-red-50 text-red-600 border border-red-200"
                  >
                    <XCircle className="w-10 h-10" />
                  </motion.div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {scanResult.message}
                    </h2>
                    <p className="text-xs text-red-600">
                      {scanResult.subtext}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setScanResult(null);
                      fetchChallenge();
                    }}
                    className="mt-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    Try again
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Clean Footer */}
      <footer className="w-full max-w-2xl flex flex-col sm:flex-row items-center justify-between gap-2 py-3 text-xs text-slate-400 font-medium relative z-10">
        <span>Orbit Engineering Solutions · Secure biometric terminal</span>
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 cursor-pointer font-medium"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Switch to portal login</span>
        </button>
      </footer>
    </div>
  );
}
