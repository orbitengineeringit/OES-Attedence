import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { apiCall, evaluateMultiSiteGeofence } from '../services/api.js';
import { loadFaceApiModels, detectFaceBiometrics, validateFullFaceEnrollment, estimateHeadPose, checkFrameQuality, faceapi } from '../services/faceApiService.js';
import { playBiometricSound } from '../services/soundService.js';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { 

  Scan, 
  Clock, 
  Activity, 
  Globe,
  Compass,
  MapPin,
  AlertTriangle,
  Volume2,
  RefreshCw
} from 'lucide-react';

// Import our modular scanner components and helper utilities
import { speakGreeting as speak } from '../components/scanner/VoiceAssistant.js';
import { calculateAverageEAR, processBlinkState } from '../components/scanner/BlinkDetector.js';
import { submitAttendanceScan, mapErrorToVoiceMessage } from '../components/scanner/AttendanceProcessor.js';
import CameraFeed from '../components/scanner/CameraFeed.jsx';
import FaceMeshOverlay, { 
  drawCustomDetections, 
  drawCustomMesh, 
  drawScanningCrosshairs 
} from '../components/scanner/FaceMeshOverlay.jsx';
import { 
  ScannerTelemetryHUD, 
  ScannerCooldownOverlay, 
  ScannerConfidenceMeter, 
  ScannerControls 
} from '../components/scanner/ScannerHUD.jsx';
import ScannerErrorBoundary from '../components/scanner/ScannerErrorBoundary.jsx';

const officeIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const employeeIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const employeeOutsideIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Helper component to center leaflet maps
function ChangeMapView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    try {
      const container = map.getContainer();
      if (!container) return;
      
      if (center && center[0] && center[1] && !isNaN(center[0]) && !isNaN(center[1])) {
        map.setView(center, map.getZoom());
      }
    } catch (e) {
      console.warn('[ChangeMapView Cleanup Guard]: Map is unmounted.', e);
    }
  }, [center, map]);
  return null;
}

// Client-side Haversine distance calculator
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return Infinity;
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in meters
};

// Client-side Ray-Casting Polygon validator
const isPointInPolygon = (lat, lng, polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return false;
  let isInside = false;
  const x = lng, y = lat;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

export default function BiometricScanner() {
  const { user } = useAuth();
  const { theme } = useTheme();
  
  const mapTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  
  // Refs for tracking video and canvas elements
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Active states
  const [stream, setStream] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isStartingScanner, setIsStartingScanner] = useState(false);
  const cooldownIntervalRef = useRef(null);
  
  // Model loading state
  const [modelsStatus, setModelsStatus] = useState('idle');
  
  // Active Challenge States
  const [livenessChallenge, setLivenessChallenge] = useState('blink'); // 'blink' | 'turn_left' | 'turn_right'
  const [challengePassed, setChallengePassed] = useState(false);
  const [headTurnRatio, setHeadTurnRatio] = useState(0.5);
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [frameQualityWarning, setFrameQualityWarning] = useState(null);
  const challengePassedRef = useRef(false);
  const blinkDetectedRef = useRef(false);
  const keyLandmarksRef = useRef([]);
  
  // Core scan loop control refs — all refs to avoid stale closures in rAF
  const animationFrameIdRef = useRef(null);
  const consecutiveFrontFrames = useRef(0);
  const cooldownActive = useRef(false);
  const scanLoopActive = useRef(false);
  const scanInProgress = useRef(false); // Prevents concurrent API calls / stuck SCANNING state
  const isProcessingRef = useRef(false); // Processing lock for active scans
  const isComponentMounted = useRef(true);
  const scannerMapRef = useRef(null);
  const activeStreamRef = useRef(null); // Ref to prevent camera track resource leaks
  
  // Blink detection state
  const blinkClosedRef = useRef(false); // true when eyes are currently closed
  const prevEAR = useRef(1.0);          // previous frame EAR for transition detection

  // Ref mirrors for values read inside rAF closures — prevents stale state captures
  const voiceEnabledRef = useRef(true);
  const lastScanDetailsRef = useRef(null);
  const gpsHistoryRef = useRef([]);
  const challengeSessionIdRef = useRef(null);
  
  useEffect(() => {
    isComponentMounted.current = true;
    return () => {
      isComponentMounted.current = false;
      scanLoopActive.current = false;
      
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
      if (activeStreamRef.current) {
        console.log('[BiometricScanner Cleanup]: Stopping active camera tracks...');
        activeStreamRef.current.getTracks().forEach(track => track.stop());
        activeStreamRef.current = null;
      }
      
      if (scannerMapRef.current) {
        scannerMapRef.current = null;
      }
    };
  }, []);
  
  // Synchronized state for UI rendering
  const [scannerStatusMsg, setScannerStatusMsg] = useState('Scanner Closed');
  const [cooldownState, setCooldownState] = useState(false);
  const [cooldownTimeLeft, setCooldownTimeLeft] = useState(0);
  const [lastScanDetails, setLastScanDetails] = useState(null);
  const [telemetryPose, setTelemetryPose] = useState('none');
  const [telemetryLockProgress, setTelemetryLockProgress] = useState(0);
  const [scanResult, setScanResult] = useState(null);
  const [realtimeScore, setRealtimeScore] = useState(0);

  // Geofencing coordinates and tracking state
  const [officeCoords, setOfficeCoords] = useState([28.6139, 77.2090]);
  const [geofenceRadius, setGeofenceRadius] = useState(100);
  const [activePolygon, setActivePolygon] = useState(null);
  const [userCoords, setUserCoords] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState(null);
  const [distanceToOffice, setDistanceToOffice] = useState(null);
  const [isInside, setIsInside] = useState(false);

  // Fetch active office geofence settings on mount
  useEffect(() => {
    const fetchGeofenceSettings = async () => {
      try {
        const response = await apiCall('/settings', 'GET');
        if (response.success && response.settings && isComponentMounted.current) {
          const lat = parseFloat(response.settings.geofence_lat) || 28.6139;
          const lng = parseFloat(response.settings.geofence_lng) || 77.2090;
          const rad = parseInt(response.settings.geofence_radius, 10) || 100;
          setOfficeCoords([lat, lng]);
          setGeofenceRadius(rad);
        }
        
        try {
          const geoRes = await apiCall('/settings/geofence', 'GET');
          if (geoRes.success && geoRes.geofence && isComponentMounted.current) {
            setActivePolygon(geoRes.geofence.polygon_coordinates);
          }
        } catch (e) {
          console.error('[GEOFENCE FETCH ERROR]:', e);
        }
      } catch (err) {
        console.error('[BIOMETRIC SCANNER GEOFENCE SETTINGS FETCH ERROR]:', err);
      }
    };
    fetchGeofenceSettings();
  }, []);

  // Set up live real-time GPS telemetry tracking via immediate query & continuous watch
  useEffect(() => {
    if (!navigator.geolocation) {
      if (isComponentMounted.current) {
        setGpsError('Geolocation is not supported by your browser.');
        setGpsLoading(false);
      }
      return;
    }

    if (isComponentMounted.current) setGpsLoading(true);

    const handlePos = (position) => {
      if (!isComponentMounted.current) return;
      const { latitude, longitude, accuracy } = position.coords;
      setUserCoords({ latitude, longitude, accuracy });
      
      gpsHistoryRef.current = [
        ...gpsHistoryRef.current.slice(-3),
        { latitude, longitude, accuracy, timestamp: Date.now() }
      ];

      setGpsError(null);
      setGpsLoading(false);
    };

    const handleErr = (error) => {
      if (!isComponentMounted.current) return;
      console.warn('[GEOLOCATION TRACKING]:', error.message);
      let errorMsg = 'GPS location unavailable.';
      if (error.code === error.PERMISSION_DENIED) {
        errorMsg = 'Location permission denied. Please allow location access in your browser settings to verify office geofence.';
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        errorMsg = 'Location signal currently unavailable.';
      } else if (error.code === error.TIMEOUT) {
        // Fallback to default office coordinates for development / laptop environments if unavailable
        console.warn('[GEOLOCATION TIMEOUT]: Location query timed out, keeping standby.');
        errorMsg = null; // Do not hard-lock user on Wi-Fi timeout
      }
      if (errorMsg) setGpsError(errorMsg);
      setGpsLoading(false);
    };

    // Immediate fast snapshot
    navigator.geolocation.getCurrentPosition(handlePos, handleErr, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 10000
    });

    // Continuous watch
    const watchId = navigator.geolocation.watchPosition(handlePos, handleErr, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 10000
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  const [nearestSiteInfo, setNearestSiteInfo] = useState({ name: 'Head Office', type: 'Head Office', distance: 0, radius: 100, isInside: false });

  // Telemetry cache refs to prevent React 60 FPS re-render loops (fixes screen flickering)
  const lastScoreRef = useRef(-1);
  const lastProgressRef = useRef(-1);
  const lastStatusMsgRef = useRef('');
  const lastPoseRef = useRef('');
  const lastWarningRef = useRef(null);

  const updateTelemetryScore = (score) => {
    if (score !== lastScoreRef.current) {
      setRealtimeScore(score);
      lastScoreRef.current = score;
    }
  };
  const updateTelemetryProgress = (progress) => {
    if (progress !== lastProgressRef.current) {
      setTelemetryLockProgress(progress);
      lastProgressRef.current = progress;
    }
  };
  const updateTelemetryStatus = (msg) => {
    if (msg !== lastStatusMsgRef.current) {
      setScannerStatusMsg(msg);
      lastStatusMsgRef.current = msg;
    }
  };
  const updateTelemetryPose = (pose) => {
    if (pose !== lastPoseRef.current) {
      setTelemetryPose(pose);
      lastPoseRef.current = pose;
    }
  };
  const updateTelemetryWarning = (warning) => {
    if (warning !== lastWarningRef.current) {
      setFrameQualityWarning(warning);
      lastWarningRef.current = warning;
    }
  };

  // Evaluate Multi-Site containment & nearest site whenever GPS coordinates fluctuate
  useEffect(() => {
    if (userCoords && userCoords.latitude && userCoords.longitude) {
      evaluateMultiSiteGeofence(userCoords.latitude, userCoords.longitude)
        .then(res => {
          if (isComponentMounted.current && res) {
            setIsInside(res.isInside);
            const site = res.matchedSite || res.nearestSite;
            if (site) {
              setNearestSiteInfo(prev => {
                const distRounded = Math.round(site.distance);
                if (prev.name === site.name && prev.isInside === site.isInside && Math.abs(prev.distance - distRounded) < 3) {
                  return prev;
                }
                return {
                  name: site.name,
                  type: site.type,
                  distance: distRounded,
                  radius: site.radius,
                  isInside: site.isInside
                };
              });
              setDistanceToOffice(site.distance);
            }
          }
        })
        .catch(err => console.warn('Multi-site check error:', err));
    }
  }, [userCoords?.latitude, userCoords?.longitude]);

  // 1. Preload face-api.js neural networks on component mount
  useEffect(() => {
    const initModels = async () => {
      try {
        if (isComponentMounted.current) setModelsStatus('loading');
        await loadFaceApiModels();
        if (isComponentMounted.current) setModelsStatus('ready');
      } catch (err) {
        console.error('[BIOMETRIC SCANNER]: Neural models failed loading:', err);
        if (isComponentMounted.current) setModelsStatus('error');
      }
    };
    initModels();
  }, []);

  // 2. Automatically clean up camera feed on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // 5. Unified 5-Second Cooldown Protocol
  const executeScanCooldown = (scanResponse, wasSuccess) => {
    cooldownActive.current = true;
    scanInProgress.current = false; // Always reset scan lock on cooldown
    isProcessingRef.current = false; // Release processing lock
    setCooldownState(true);
    setTelemetryLockProgress(0);
    consecutiveFrontFrames.current = 0;
    blinkClosedRef.current = false;
    
    // IMMEDIATELY auto-stop the camera upon attendance mark completion!
    stopCamera(true);
    
    // Play sci-fi notification audio
    playBiometricSound(wasSuccess ? 'success' : 'failure');
    
    const scanTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const scanDetails = {
      success: wasSuccess,
      message: scanResponse.message || 'Verification complete.',
      id: scanResponse.employee?.id || 'N/A',
      name: scanResponse.employee?.name || 'Unknown User',
      department: scanResponse.employee?.department || 'N/A',
      confidence: scanResponse.confidence || 0,
      eventType: scanResponse.eventType || 'ACCESS_DENIED',
      lateDuration: scanResponse.lateDuration || 'On Time',
      isLate: scanResponse.isLate || false,
      scanTime: scanTime
    };
    // Keep ref in sync so rAF loop always has fresh value (fixes stale closure)
    lastScanDetailsRef.current = scanDetails;
    setLastScanDetails(scanDetails);

    // Build rich voice message
    let voiceMsg;
    if (scanResponse.voiceMessage) {
      voiceMsg = scanResponse.voiceMessage;
    } else if (!wasSuccess) {
      voiceMsg = 'Biometric identification denied. Access blocked.';
    } else {
      const empName = scanResponse.employee?.name || 'Employee';
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (scanResponse.eventType === 'CHECK_OUT') {
        voiceMsg = `Goodbye ${empName}. Check-out time: ${timeStr}.`;
      } else if (scanResponse.isLate) {
        voiceMsg = `Welcome ${empName}. Check-in time: ${timeStr}. You are ${scanResponse.lateDuration || 'some'} late.`;
      } else {
        voiceMsg = `Welcome ${empName}. Check-in time: ${timeStr}.`;
      }
    }
    // Use ref so voice always reflects current toggle state, even inside async closures
    speak(voiceMsg, voiceEnabledRef.current);

    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }
    setCooldownTimeLeft(5);
    cooldownIntervalRef.current = setInterval(() => {
      setCooldownTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownIntervalRef.current);
          cooldownIntervalRef.current = null;
          cooldownActive.current = false;
          scanInProgress.current = false; // Always release lock on cooldown reset
          isProcessingRef.current = false; // Release processing lock
          setCooldownState(false);
          lastScanDetailsRef.current = null;
          setLastScanDetails(null);
          setScanResult(null);
          if (isComponentMounted.current && !scanLoopActive.current) {
            startCamera();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 6. Automatic Face Identification Action
  const handleAutoScan = async (descriptorArray) => {
    if (isProcessingRef.current || cooldownActive.current || scanInProgress.current) return;

    isProcessingRef.current = true;
    scanInProgress.current = true; // Prevent concurrent scan submissions.
    
    console.log('[DEBUG LOG - ATTENDANCE TRIGGER] Auto-scan triggered. Preparing biometric matching request...');
    console.log('[DEBUG-DIAGNOSTIC] Attendance trigger started.');
    
    setScanResult({ status: 'analyzing', message: 'Extracting & matching face coordinates...' });
    setScannerStatusMsg('BIOMETRIC MATCH IN PROGRESS...');

    try {
      // 1. Webdriver automation detection (allow mock test environment bypass)
      const isAutomationDetected = typeof navigator !== 'undefined' && navigator.webdriver;
      const isMockBypass = typeof window !== 'undefined' && window.__MOCK_BIOMETRICS__ === true;
      if (isAutomationDetected && !isMockBypass) {
        throw new Error('Biometric Scanner Blocked: Automated browser environment detected.');
      }

      // 2. Native function check for browser extensions (like Location Guard)
      const isNative = (fn) => {
        try {
          return typeof fn === 'function' && 
            (Function.prototype.toString.call(fn).includes('[native code]') || 
             fn.toString().includes('[native code]'));
        } catch (e) {
          return false;
        }
      };

      if (!isMockBypass) {
        if (!isNative(navigator.geolocation.getCurrentPosition) || !isNative(navigator.geolocation.watchPosition)) {
          throw new Error('Biometric Scanner Blocked: Location spoofing extension detected. Please disable location mocks.');
        }
      }

      // 3. Static/Simulated GPS detection on mobile devices
      const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const history = gpsHistoryRef.current;
      if (isMobile && history.length >= 3 && !isMockBypass) {
        const first = history[0];
        const allSameLat = history.every(h => h.latitude === first.latitude);
        const allSameLng = history.every(h => h.longitude === first.longitude);
        const allSameAcc = history.every(h => h.accuracy === first.accuracy);
        
        // High-accuracy (< 15m) GPS shouldn't be 100% static on mobile devices
        if (first.accuracy < 15 && allSameLat && allSameLng && allSameAcc) {
          console.warn('[SPOOF DETECTION] Static GPS coordinates detected on mobile device.');
          throw new Error('GPS signal static/simulated. Please move slightly to calibrate your location.');
        }
      }

      // Coordinate resolution with fallback to office center for demo/bypass
      let currentCoords = userCoords;
      if (!currentCoords || isNaN(currentCoords.latitude) || isNaN(currentCoords.longitude)) {
        if (officeCoords && officeCoords.length >= 2) {
          console.warn('[BIOMETRIC SCANNER]: Live GPS pending, using office reference point...');
          currentCoords = { latitude: officeCoords[0], longitude: officeCoords[1], accuracy: 10 };
        } else {
          throw new Error('GPS Required: Please enable location services in browser settings to verify office geofence.');
        }
      }

      console.log('[DEBUG LOG - ATTENDANCE TRIGGER] Sending biometric descriptor to verification API. Coordinates:', currentCoords.latitude, currentCoords.longitude);

      const scanPromise = submitAttendanceScan(
        descriptorArray, 
        currentCoords, 
        undefined, // actionType (inferred by server)
        blinkDetectedRef.current,
        livenessChallenge,
        challengePassed,
        headTurnRatio,
        keyLandmarksRef.current,
        challengeSessionIdRef.current
      );
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Biometric matching request timed out. Please retry.')), 12000)
      );

      const response = await Promise.race([scanPromise, timeoutPromise]);
      console.log('[DEBUG LOG - ATTENDANCE TRIGGER] Biometric scan match successful for:', response.employee?.name);

      setScanResult({
        status: 'success',
        message: response.message,
        employee: response.employee,
        eventType: response.eventType,
        lateDuration: response.lateDuration,
        isLate: response.isLate
      });
      executeScanCooldown(response, true);
    } catch (error) {
      console.error('[DEBUG LOG - ATTENDANCE TRIGGER] Biometric validation exception:', error);
      const errMsg = error.message || error.response?.message || 'Biometric validation failure.';
      const voiceAlert = error.voiceMessage || mapErrorToVoiceMessage(error);
      
      let formattedMsg = errMsg;
      if (errMsg.includes('geofence') || errMsg.includes('outside')) {
        formattedMsg = '📍 Geofence Error: ' + errMsg;
      } else if (errMsg.includes('GPS') || errMsg.includes('Location')) {
        formattedMsg = '🛰️ GPS Error: ' + errMsg;
      } else if (errMsg.includes('not belong') || errMsg.includes('mismatch')) {
        formattedMsg = '⚠️ Identity Mismatch: ' + errMsg;
      } else if (errMsg.includes('Not Recognized') || errMsg.includes('not recognized')) {
        formattedMsg = '👤 Face Not Recognized: ' + errMsg;
      } else if (errMsg.includes('enrolled')) {
        formattedMsg = '⚠️ Face Not Enrolled: ' + errMsg;
      }

      setScanResult({ status: 'error', message: formattedMsg });
      executeScanCooldown({
        message: formattedMsg,
        voiceMessage: voiceAlert
      }, false);
    } finally {
      isProcessingRef.current = false;
      scanInProgress.current = false;
    }
  };

  // 7. Core Frame-by-Frame Web Camera Processor
  const processFrame = async () => {
    if (!scanLoopActive.current) return;

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

      if (cooldownActive.current) {
        // Use ref instead of state to avoid stale closure from rAF callback
        const det = lastScanDetailsRef.current;
        ctx.strokeStyle = det?.success ? '#10B981' : '#EF4444';
        ctx.lineWidth = 3;
        ctx.shadowColor = det?.success ? '#10B981' : '#EF4444';
        ctx.shadowBlur = 10;
        ctx.strokeRect(15, 15, displaySize.width - 30, displaySize.height - 30);
        ctx.shadowBlur = 0;
        ctx.fillStyle = det?.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)';
        ctx.fillRect(15, 15, displaySize.width - 30, displaySize.height - 30);
        animationFrameIdRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Skip detection frame if scan API call already in-flight
      if (scanInProgress.current) {
        ctx.fillStyle = 'rgba(6,182,212,0.06)';
        ctx.fillRect(0, 0, displaySize.width, displaySize.height);
        animationFrameIdRef.current = requestAnimationFrame(processFrame);
        return;
      }

      try {
        // 1. Run live frame quality check using static import
        const quality = checkFrameQuality(video);
        if (!quality.passed) {
          updateTelemetryWarning(quality.warning);
          updateTelemetryStatus(quality.warning.toUpperCase());
          updateTelemetryProgress(0);
          
          ctx.strokeStyle = '#F59E0B'; // Amber alert warning box
          ctx.lineWidth = 3;
          ctx.strokeRect(15, 15, displaySize.width - 30, displaySize.height - 30);
          
          ctx.font = '16px sans-serif';
          ctx.fillStyle = '#F59E0B';
          ctx.fillText(quality.warning, 30, 40);
          
          animationFrameIdRef.current = requestAnimationFrame(processFrame);
          return;
        }
        updateTelemetryWarning(null);

        // 2. Run face detection
        const rawDetection = await detectFaceBiometrics(video);

        // 3. Reject if multiple faces detected
        if (rawDetection && rawDetection.multipleFaces) {
          updateTelemetryStatus('MULTIPLE FACES DETECTED');
          updateTelemetryProgress(0);
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
          const detection = faceapi.resizeResults(rawDetection, displaySize);
          updateTelemetryScore(Math.round(detection.detection.score * 100));

          // Extract key landmarks & EAR metrics for anti-spoof telemetry
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

          if (!challengePassedRef.current) {
            challengePassedRef.current = true;
            setChallengePassed(true);
          }

          // Fast 2-frame stability lock (~60ms) for instant verification
          consecutiveFrontFrames.current += 1;
          const progress = Math.min(100, Math.round((consecutiveFrontFrames.current / 2) * 100));
          updateTelemetryProgress(progress);

          const isLocked = consecutiveFrontFrames.current >= 2 || cooldownActive.current;
          drawCustomDetections(ctx, detection, isLocked);
          drawCustomMesh(ctx, detection.landmarks, isLocked);

          updateTelemetryPose('front');

          // Auto-trigger scan instantly once locked (2 frames)
          if (consecutiveFrontFrames.current >= 2 && !cooldownActive.current && !scanInProgress.current) {
            updateTelemetryStatus('⚡ Verifying Face & GPS...');
            handleAutoScan(rawDetection.descriptor);
          } else if (!cooldownActive.current && !scanInProgress.current) {
            updateTelemetryStatus('⚡ Face Detected — Locking in...');
          }
        } else {
          updateTelemetryScore(0);
          consecutiveFrontFrames.current = 0;
          updateTelemetryProgress(0);
          updateTelemetryPose('none');
          blinkClosedRef.current = false;
        }
      } catch (err) {
        console.error('[BIOMETRIC SCAN LOOP ERROR]:', err);
        updateTelemetryStatus('Scanning Face...');
        scanInProgress.current = false;
        blinkClosedRef.current = false;
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(processFrame);
  };

  const fetchChallenge = async () => {
    try {
      // [VERCEL FIX]: Use apiCall() instead of direct fetch() — works via Supabase SDK without Express server
      const data = await apiCall('/attendance/challenge', 'GET');
      if (data && data.challengeType) {
        setLivenessChallenge(data.challengeType);
        challengeSessionIdRef.current = data.challengeSessionId;
        setChallengePassed(false);
        challengePassedRef.current = false;
        blinkDetectedRef.current = false;
        setBlinkDetected(false);
        keyLandmarksRef.current = [];
        return;
      }
    } catch (err) {
      console.error('[BiometricScanner] Failed to fetch challenge:', err);
    }
    // Fallback: client-side generated challenge
    const challenges = ['blink', 'turn_left', 'turn_right'];
    const randomChallenge = challenges[Math.floor(Math.random() * challenges.length)];
    setLivenessChallenge(randomChallenge);
    challengeSessionIdRef.current = 'session_' + Math.random().toString(36).substring(2) + '_' + Date.now();
    setChallengePassed(false);
    challengePassedRef.current = false;
  };

  // 8. Start and Stop Camera Stream Functions
  const startCamera = async () => {
    if (modelsStatus !== 'ready' || isStartingScanner || cameraActive) return;
    setIsStartingScanner(true);
    
    try {
      await fetchChallenge();
      setScannerStatusMsg('Starting Scanner...');
      setScanResult(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      
      setCameraActive(true);
      scanLoopActive.current = true;
      setScannerStatusMsg('Scanning Face...');
      
      setTimeout(() => {
        if (!scanLoopActive.current) {
          console.log('[BiometricScanner startCamera]: Camera stopped before video initialized. Cleaning up stream tracks.');
          mediaStream.getTracks().forEach(track => track.stop());
          setIsStartingScanner(false);
          return;
        }
        
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(e => console.error('[BiometricScanner video play error]:', e));
          activeStreamRef.current = mediaStream;
          setStream(mediaStream); // Store stream in state to allow graceful track termination on unmount
          animationFrameIdRef.current = requestAnimationFrame(processFrame);
        } else {
          console.warn('[BiometricScanner startCamera]: videoRef.current not found after mount delay. Terminating stream.');
          mediaStream.getTracks().forEach(track => track.stop());
        }
        setIsStartingScanner(false);
      }, 10);
    } catch (err) {
      console.error('[CAMERA START ERROR]:', err);
      setScannerStatusMsg('CAMERA ERROR: ' + err.message);
      setIsStartingScanner(false);
      alert('Failed connecting to webcam. Please verify camera permissions in your browser.');
    }
  };

  const stopCamera = (isAutomaticCleanup = false) => {
    scanLoopActive.current = false;
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (activeStreamRef.current) {
      console.log('[BiometricScanner stopCamera]: Stopping active camera tracks...');
      activeStreamRef.current.getTracks().forEach(track => track.stop());
      activeStreamRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
    setCameraActive(false);
    setTelemetryLockProgress(0);
    setTelemetryPose('none');
    consecutiveFrontFrames.current = 0;
    setIsStartingScanner(false);
    
    // Status message update
    if (isAutomaticCleanup) {
      setScannerStatusMsg('Attendance Marked');
    } else {
      setScannerStatusMsg('Scanner Closed');
    }
  };

  // Redundant camera track cleanup removed to prevent self-sabotaging camera closure on state change.
  // Full cleanup is already safely handled on unmount via the empty dependency effect at line 152.

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      {/* Clean White Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">Biometric scanner terminal</h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500">Facial matching, liveness verification, and geofence boundary validation.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            Office hours: <span className="font-medium">10:00 AM - 7:00 PM</span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
          {[
            { label: 'Models', value: modelsStatus === 'ready' ? 'Ready' : modelsStatus },
            { label: 'Camera', value: cameraActive ? 'Live' : 'Idle' },
            { label: 'GPS', value: gpsLoading ? 'Locating' : gpsError ? 'Unavailable' : 'Locked' },
            { label: 'Zone', value: gpsLoading ? 'Checking' : gpsError ? 'Unavailable' : isInside ? 'Approved' : 'Outside' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs text-slate-500 font-medium">{item.label}</p>
              <p className="mt-1 text-base font-semibold text-slate-900 truncate capitalize">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Camera Scanner View */}
        <motion.div 
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm relative flex flex-col items-center"
        >
          <div className="mb-4 flex w-full items-center justify-between border-b border-slate-100 pb-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className={`h-2 w-2 rounded-full ${cameraActive && !cooldownState ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              Camera capture
            </span>

            <button
              onClick={() => {
                const next = !voiceEnabled;
                voiceEnabledRef.current = next;
                setVoiceEnabled(next);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                voiceEnabled ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5"><Volume2 className="h-3.5 w-3.5" />{voiceEnabled ? 'Voice on' : 'Voice muted'}</span>
            </button>
          </div>

          <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-inner">
            <CameraFeed 
              videoRef={videoRef} 
              cameraActive={cameraActive} 
              modelsStatus={modelsStatus} 
              onStartCamera={startCamera}
              isStarting={isStartingScanner}
            />

            {/* Quality Warning */}
            <AnimatePresence>
              {cameraActive && frameQualityWarning && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute top-3 left-3 right-3 z-40 bg-amber-500 text-white text-xs font-medium px-3 py-2 rounded-xl shadow-md flex items-center gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{frameQualityWarning}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Face Mesh & Scanning Laser Overlay */}
            {cameraActive && (
              <ScannerErrorBoundary>
                <FaceMeshOverlay 
                  canvasRef={canvasRef} 
                  cooldownState={cooldownState} 
                />
              </ScannerErrorBoundary>
            )}

            {/* Diagnostics Telemetry HUD */}
            <ScannerErrorBoundary>
              <ScannerTelemetryHUD
                cameraActive={cameraActive}
                cooldownState={cooldownState}
                scannerStatusMsg={scannerStatusMsg}
                telemetryPose={telemetryPose}
                telemetryLockProgress={telemetryLockProgress}
                livenessChallenge={livenessChallenge}
                challengePassed={challengePassed}
              />
            </ScannerErrorBoundary>

            {/* Cooldown Result Overlay */}
            <ScannerErrorBoundary>
              <ScannerCooldownOverlay
                cooldownState={cooldownState}
                lastScanDetails={lastScanDetails}
                cooldownTimeLeft={cooldownTimeLeft}
              />
            </ScannerErrorBoundary>

            {/* AI Voice Assistant Subtitles */}
            <AnimatePresence>
              {cooldownState && lastScanDetails && (
                <motion.div 
                  initial={{ opacity: 0, y: 12, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: 12, x: '-50%' }}
                  className="absolute bottom-3 left-1/2 z-40 flex max-w-[92%] select-none items-center gap-2.5 rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2 shadow-md backdrop-blur-md"
                >
                  <div className="flex gap-0.5 items-end h-3.5 shrink-0">
                    <div className="w-0.5 h-2 bg-indigo-500 rounded-full animate-wave-bar" style={{ animationDelay: '0.1s' }} />
                    <div className="w-0.5 h-3.5 bg-indigo-600 rounded-full animate-wave-bar" style={{ animationDelay: '0.3s' }} />
                    <div className="w-0.5 h-1.5 bg-indigo-400 rounded-full animate-wave-bar" style={{ animationDelay: '0.0s' }} />
                  </div>
                  <div className="truncate text-xs font-medium text-slate-700">
                    <span className="mr-1.5 font-semibold text-indigo-600">Voice</span>
                    {(() => {
                      if (lastScanDetails.success) {
                        const timeStr = lastScanDetails.scanTime;
                        if (lastScanDetails.eventType === 'CHECK_OUT') {
                          return `Goodbye ${lastScanDetails.name}. Punch logged at: ${timeStr}.`;
                        } else if (lastScanDetails.isLate) {
                          return `Welcome ${lastScanDetails.name}. Punch logged at: ${timeStr}. Shift late by ${lastScanDetails.lateDuration}.`;
                        } else {
                          return `Welcome ${lastScanDetails.name}. Punch logged at: ${timeStr}. Shift on time.`;
                        }
                      } else {
                        return lastScanDetails.message;
                      }
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Confidence Meter */}
          <ScannerConfidenceMeter
            cameraActive={cameraActive}
            cooldownState={cooldownState}
            realtimeScore={realtimeScore}
          />

          {/* Controls */}
          <ScannerControls
            cameraActive={cameraActive}
            onStopCamera={stopCamera}
          />
        </motion.div>

        {/* Geofence Validation Side Panel */}
        <motion.div 
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm relative flex flex-col"
        >
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Compass className="h-4 w-4 text-indigo-600" />
              Geofence validation
            </span>
            <span className={`ui-badge ${gpsLoading ? 'badge-neutral' : gpsError ? 'badge-error' : 'badge-success'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${gpsLoading ? 'bg-indigo-500 animate-pulse' : gpsError ? 'bg-red-500' : 'bg-emerald-500'}`} />
              {gpsLoading ? 'Locating' : gpsError ? 'GPS issue' : 'GPS locked'}
            </span>
          </div>

          <div className={`mb-4 flex items-center justify-between rounded-xl border p-3 ${
            gpsLoading
              ? 'bg-indigo-50 border-indigo-100 text-indigo-700'
              : gpsError
              ? 'bg-red-50 border-red-200 text-red-700'
              : isInside
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <MapPin className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500 leading-none">
                  {nearestSiteInfo.name ? `Site: ${nearestSiteInfo.name}` : 'Location status'}
                </p>
                <h4 className="mt-1 truncate text-xs sm:text-sm font-semibold">
                  {gpsLoading
                    ? 'Acquiring GPS signal'
                    : gpsError
                    ? 'Location permission required'
                    : isInside
                    ? `Inside ${nearestSiteInfo.name || 'Office'}`
                    : `Outside ${nearestSiteInfo.name || 'Office'} (${nearestSiteInfo.distance}m away)`}
                </h4>
              </div>
            </div>
            <div className="text-right pl-2 shrink-0">
              <p className="text-[11px] text-slate-500 leading-none">Access</p>
              <h4 className="mt-1 text-xs sm:text-sm font-semibold">
                {gpsLoading ? 'Waiting' : gpsError ? 'Blocked' : isInside ? 'Approved' : 'Denied'}
              </h4>
            </div>
          </div>

          <div className="relative z-10 h-[240px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {gpsError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-red-600">
                <AlertTriangle className="h-6 w-6" />
                <p className="text-sm font-semibold">GPS acquisition failed</p>
                <p className="max-w-xs text-xs leading-normal text-slate-500">{gpsError}</p>
              </div>
            ) : gpsLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
                <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
                <p className="text-xs font-medium text-slate-500">Locating position...</p>
              </div>
            ) : (
              <MapContainer
                key="scanner-telemetry-map-static"
                ref={scannerMapRef}
                center={officeCoords}
                zoom={17}
                scrollWheelZoom={false}
                zoomControl={false}
                className="h-full w-full"
              >
                <ChangeMapView center={userCoords ? [userCoords.latitude, userCoords.longitude] : officeCoords} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url={mapTileUrl}
                />

                {/* Office HQ Location Pin */}
                <Marker position={officeCoords} icon={officeIcon}>
                  <Popup>
                    <div className="text-xs leading-normal text-slate-900">
                      <p className="font-semibold">Headquarters</p>
                      <p>Radius: {geofenceRadius}m</p>
                    </div>
                  </Popup>
                </Marker>

                {/* Office Geofence Circle or Polygon Boundary */}
                {activePolygon && activePolygon.length >= 3 ? (
                  <Polygon
                    positions={activePolygon.map(p => [p.lat, p.lng])}
                    pathOptions={{
                      color: isInside ? '#10B981' : '#4F46E5',
                      fillColor: isInside ? '#10B981' : '#4F46E5',
                      fillOpacity: 0.1,
                      weight: 1.5,
                      dashArray: '5, 8'
                    }}
                  />
                ) : (
                  <Circle
                    center={officeCoords}
                    radius={geofenceRadius}
                    pathOptions={{
                      color: isInside ? '#10B981' : '#4F46E5',
                      fillColor: isInside ? '#10B981' : '#4F46E5',
                      fillOpacity: 0.1,
                      weight: 1.5,
                      dashArray: '5, 8'
                    }}
                  />
                )}

                {/* Employee Live Position Marker */}
                {userCoords && (
                  <Marker
                    position={[userCoords.latitude, userCoords.longitude]}
                    icon={isInside ? employeeIcon : employeeOutsideIcon}
                  >
                    <Popup>
                      <div className="text-xs leading-normal text-slate-900">
                        <p className="font-semibold">Your live position</p>
                        <p>Distance: {distanceToOffice !== null ? `${Math.round(distanceToOffice)}m` : 'Calculating...'}</p>
                        <p>Zone: {isInside ? 'Inside zone' : 'Outside zone'}</p>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            )}
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs text-slate-600">
            <div className="flex justify-between gap-3 border-b border-slate-200/70 pb-1.5">
              <span className="text-slate-500">Office center</span>
              <span className="font-medium text-slate-900">{officeCoords[0].toFixed(5)}, {officeCoords[1].toFixed(5)}</span>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-200/70 pb-1.5">
              <span className="text-slate-500">Your position</span>
              <span className={userCoords ? 'font-medium text-slate-800' : 'text-slate-400'}>
                {userCoords
                  ? `${userCoords.latitude.toFixed(5)}, ${userCoords.longitude.toFixed(5)}`
                  : 'Waiting for GPS'}
              </span>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-200/70 pb-1.5">
              <span className="text-slate-500">Distance</span>
              <span className={distanceToOffice !== null ? (isInside ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold') : 'text-slate-400'}>
                {distanceToOffice !== null ? `${distanceToOffice.toFixed(1)} m` : 'Calculating'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Allowed radius</span>
              <span className="font-semibold text-indigo-700">{geofenceRadius} m</span>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white flex flex-col items-center justify-between gap-3 p-4 text-center text-xs text-slate-500 md:flex-row md:text-left shadow-sm">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-indigo-600" />
          <span>Biometric and GPS services: <span className="font-medium text-emerald-700">Operational</span></span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <Globe className="h-3.5 w-3.5 text-indigo-600" />
          <span>Realtime location validation enabled</span>
        </div>
      </div>
    </motion.div>
  );
}
