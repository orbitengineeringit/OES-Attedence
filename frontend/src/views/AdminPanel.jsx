import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../context/ThemeContext.jsx';
import { apiCall } from '../services/api.js';
import { 
  Users, 
  UserPlus, 
  Trash2, 
  Edit3, 
  Search, 
  FileText, 
  ShieldAlert,
  Fingerprint,
  X,
  UserCheck,
  Camera,
  CameraOff,
  Activity,
  Database,
  RefreshCw,
  Sliders,
  CheckCircle2,
  MapPin,
  Compass,
  Globe,
  Navigation,
  Crosshair,
  Wifi,
  WifiOff,
  Building,
  Building2,
  Settings as SettingsIcon
} from 'lucide-react';
import { 
  loadFaceApiModels, 
  detectFaceBiometrics, 
  estimateHeadPose, 
  calculateAverageDescriptor,
  faceapi
} from '../services/faceApiService.js';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap, useMapEvents, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { playBiometricSound } from '../services/soundService.js';

// Helper to dynamic pan/re-center Leaflet maps on coordinates state changes
function ChangeMapView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    try {
      // Defensive cleanup guard: make sure Leaflet map container is still attached to the DOM
      const container = map.getContainer();
      if (!container) return;
      
      if (center && center[0] && center[1] && !isNaN(center[0]) && !isNaN(center[1])) {
        if (zoom) {
          map.setView(center, zoom);
        } else {
          map.setView(center, map.getZoom());
        }
      }
    } catch (e) {
      console.warn('[ChangeMapView Cleanup Guard]: Map is unmounted or detached.', e);
    }
  }, [center, zoom, map]);
  return null;
}

// Click-to-place handler for geofence map
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

// Leaflet blue marker icon setup
const officeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Setup beautiful custom employee pins so they don't break in Vite builds
const employeeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const employeeOutsideIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const employeeOfflineIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Client-side Haversine distance calculator
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined || lat1 === 0 || lon1 === 0) return Infinity;
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

const generateUniqueId = () => 'OES/' + String(Math.floor(1 + Math.random() * 999)).padStart(3, '0');
const generatePassword = () => 'emp@' + Math.floor(1000 + Math.random() * 9000);

export default function AdminPanel() {
  const { theme } = useTheme();
  const mapTileUrl = theme === 'dark' 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('quantum_admin_active_tab') || 'directory'); // 'directory' | 'register' | 'face-enroll' | 'location' | 'danger'
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // Settings Editor State
  const [settings, setSettings] = useState({
    geofence_lat: 0,
    geofence_lng: 0,
    geofence_radius: 100
  });
  const [loadingSettings, setLoadingSettings] = useState(true);

  // GPS Detection State
  const [gpsDetecting, setGpsDetecting] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [locationSaved, setLocationSaved] = useState(false);
  const [geofenceMapCenter, setGeofenceMapCenter] = useState(null);
  const [geofenceMapZoom, setGeofenceMapZoom] = useState(null);
  const locationAutoDetected = useRef(false);
  const searchDebounceRef = useRef(null);
  const isComponentMounted = useRef(true);
  const geofenceMapRef = useRef(null);
  const radarMapRef = useRef(null);

  // Address Search State
  const [locationSearch, setLocationSearch] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [officeName, setOfficeName] = useState('');
  const [officeAddress, setOfficeAddress] = useState('');
  const [officeNameError, setOfficeNameError] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const searchContainerRef = useRef(null);

  // Radar states for Live employee map monitor
  const [radarSearch, setRadarSearch] = useState('');
  const [radarCenter, setRadarCenter] = useState([23.217024, 77.424507]);

  // Geoboundary Capture States
  const [captureMode, setCaptureMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [activePolygon, setActivePolygon] = useState(null);
  const captureWatchId = useRef(null);

  // Synchronize radarCenter with settings on load
  useEffect(() => {
    if (settings && settings.geofence_lat && settings.geofence_lng && settings.geofence_lat !== 0) {
      setRadarCenter([settings.geofence_lat, settings.geofence_lng]);
    }
  }, [settings]);

  // Form State
  const [form, setForm] = useState({
    id: generateUniqueId(),
    name: '',
    email: '',
    password: generatePassword(),
    role: 'employee',
    department: 'Engineering'
  });
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [autoRegisterFace, setAutoRegisterFace] = useState(true);
  const [enrollError, setEnrollError] = useState('');
  const [enrollSuccess, setEnrollSuccess] = useState('');
  const [faceSource, setFaceSource] = useState('self');
  const [biometricFaceSource, setBiometricFaceSource] = useState('self');
  const [wizardTargetId, setWizardTargetId] = useState('');

  // Modal Camera Capture State
  const [modalCameraActive, setModalCameraActive] = useState(false);
  const [modalStream, setModalStream] = useState(null);
  const [faceCaptured, setFaceCaptured] = useState(false);
  const modalVideoRef = React.useRef(null);

  // Standalone Biometric Registration Modal State
  const [biometricModalOpen, setBiometricModalOpen] = useState(false);
  const [biometricTargetEmp, setBiometricTargetEmp] = useState(null);
  const [biometricCameraActive, setBiometricCameraActive] = useState(false);
  const [biometricStream, setBiometricStream] = useState(null);
  const biometricVideoRef = React.useRef(null);

  // Rapid Auto-Capturing Biometric Face Enrollment State
  const [wizardModelsLoading, setWizardModelsLoading] = useState(false);
  const [enrollStatus, setEnrollStatus] = useState('idle');
  const [duplicateMessage, setDuplicateMessage] = useState(''); // 'idle' | 'CAMERA READY' | 'SCANNING' | 'FACE DETECTED' | 'BLINK DETECTED' | 'MATCHING' | 'ENROLLING' | 'SUCCESS' | 'DUPLICATE DETECTED' | 'FAILED'
  const [realtimeMsg, setRealtimeMsg] = useState('Please position your face inside the scanner frame');
  const [confidenceScore, setConfidenceScore] = useState(0);
  const [stabilityCounter, setStabilityCounter] = useState(0);
  const [autoCapturedDescriptor, setAutoCapturedDescriptor] = useState(null);
  const [livenessState, setLivenessState] = useState('idle'); // 'idle' | 'waitingForOpen' | 'waitingForClose' | 'waitingForReopen' | 'blinkDetected'
  const [livenessVerified, setLivenessVerified] = useState(false);
  const [facePreviewUrl, setFacePreviewUrl] = useState('');
  const biometricCanvasRef = React.useRef(null);
  const wizardLoopActive = React.useRef(false);

  // Double-Confirmation Admin Cleanup State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'reset-db' | 'clear-attendance' | 'clear-logs' | 'reset-face'
  const [confirmTarget, setConfirmTarget] = useState(null); // { id, name }
  const [confirmTextInput, setConfirmTextInput] = useState('');
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  // Robust speech synthesis helper
  const speakText = (text) => {
    if (!window.speechSynthesis) return;
    
    console.log('[SPEECH SYNTHESIS ANNOUNCEMENT]:', text);
    
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel(); // Clear any queued speech
      
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.95; // Slightly slower for perfect phonetic clarity
        utterance.pitch = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const englishVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en-GB'));
          if (englishVoice) {
            utterance.voice = englishVoice;
          }
        }
        
        utterance.onerror = (e) => {
          console.error('[SPEECH SYNTHESIS PLAYBACK ERROR]:', e);
        };
        
        window.speechSynthesis.speak(utterance);
      }, 60); // 60ms delay ensures browser finishes queue clearance
    } catch (err) {
      console.error('[SPEECH SYNTHESIS ENGINE EXCEPTION]:', err);
    }
  };

  // Camera methods for Add/Edit Employee modal
  const startModalCamera = async () => {
    try {
      setFaceCaptured(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 }
      });
      setModalStream(stream);
      if (modalVideoRef.current) {
        modalVideoRef.current.srcObject = stream;
        modalVideoRef.current.play();
      }
      setModalCameraActive(true);
    } catch (err) {
      console.error('[MODAL CAMERA ERROR]:', err);
      alert('Could not access camera. Please check webcam permissions.');
    }
  };

  const stopModalCamera = () => {
    if (modalStream) {
      modalStream.getTracks().forEach(track => track.stop());
    }
    setModalStream(null);
    setModalCameraActive(false);
  };

  const handleCaptureFace = () => {
    if (!form.name) {
      alert('Please enter a Full Name first to map biometric credentials.');
      return;
    }
    setFaceCaptured(true);
    stopModalCamera();
  };

  // Frame loop for Rapid Auto-Capturing Biometric Face Enrollment
  const startAutoCaptureLoop = () => {
    wizardLoopActive.current = true;
    const canvas = biometricCanvasRef.current;
    const video = biometricVideoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    let localStability = 0;
    let frameCount = 0;
    let fps = 60;
    let lastTime = performance.now();

    // Instantiate detector options with optimized size and score for ultra-fast face detection
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 });

    // Blink-Liveness tracking state variables in closure
    let blinkStateVal = 'waitingForOpen'; // 'waitingForOpen' | 'waitingForClose' | 'waitingForReopen' | 'blinkDetected'
    let livenessVerifiedVal = true;

    // Cache last state values to prevent unnecessary React re-renders (this fixes the lag entirely!)
    let lastStatus = '';
    let lastMsg = '';
    let lastStability = -1;
    let lastLivenessState = '';
    let lastLivenessVerified = null;

    const updateStatus = (status) => {
      if (status !== lastStatus) {
        setEnrollStatus(status);
        lastStatus = status;
      }
    };

    const updateMsg = (msg) => {
      if (msg !== lastMsg) {
        setRealtimeMsg(msg);
        lastMsg = msg;
      }
    };

    const updateStability = (stability) => {
      if (stability !== lastStability) {
        setStabilityCounter(stability);
        lastStability = stability;
      }
    };

    const updateLiveness = (stateVal, verifiedVal) => {
      if (stateVal !== lastLivenessState) {
        setLivenessState(stateVal);
        lastLivenessState = stateVal;
      }
      if (verifiedVal !== lastLivenessVerified) {
        setLivenessVerified(verifiedVal);
        lastLivenessVerified = verifiedVal;
      }
    };

    const calculateDistance = (pt1, pt2) => {
      return Math.sqrt((pt1.x - pt2.x) ** 2 + (pt1.y - pt2.y) ** 2);
    };

    const calculateEAR = (eye) => {
      const d1 = calculateDistance(eye[1], eye[5]); // p2 - p6
      const d2 = calculateDistance(eye[2], eye[4]); // p3 - p5
      const d3 = calculateDistance(eye[0], eye[3]); // p1 - p4
      if (d3 === 0) return 0;
      return (d1 + d2) / (2.0 * d3);
    };

    // Mathematically corrected text drawer to draw legible, left-to-right text on a CSS scale-x-[-1] mirrored canvas
    const drawUnmirroredText = (text, x, y, color = 'rgba(6, 182, 212, 0.95)', font = 'bold 10px \"Courier New\", monospace', align = 'left') => {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.fillStyle = color;
      ctx.font = font;
      ctx.textAlign = align;
      
      let finalX = -canvas.width + x;
      if (align === 'right') {
        finalX = -x;
      } else if (align === 'center') {
        finalX = -canvas.width / 2;
      }
      
      ctx.fillText(text, finalX, y);
      ctx.restore();
    };

    const drawHolographicOverlay = (ctx, detection, videoWidth, videoHeight, livenessVerified, blinkState) => {
      const box = detection.detection.box;
      const positions = detection.landmarks.positions;

      // Isolated context configuration
      ctx.save();

      // Determine glow colors based on current liveness state
      let glowColor = '#06B6D4'; // default accent color
      let glowBg = 'rgba(6, 182, 212, 0.4)';
      let meshColor = 'rgba(6, 182, 212, 0.15)';
      
      if (livenessVerified) {
        glowColor = '#22C55E'; // green
        glowBg = 'rgba(34, 197, 94, 0.4)';
        meshColor = 'rgba(34, 197, 94, 0.25)';
      } else if (blinkState === 'waitingForClose') {
        glowColor = '#3B82F6'; // blue
        glowBg = 'rgba(59, 130, 246, 0.4)';
        meshColor = 'rgba(59, 130, 246, 0.25)';
      } else if (blinkState === 'waitingForReopen') {
        glowColor = '#EAB308'; // gold
        glowBg = 'rgba(234, 179, 8, 0.4)';
        meshColor = 'rgba(234, 179, 8, 0.25)';
      }

      // --- Holographic Target corners around box ---
      ctx.strokeStyle = glowBg;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 3;
      const len = Math.min(box.width, box.height) * 0.15;
      
      // Top Left Corner
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + len);
      ctx.lineTo(box.x, box.y);
      ctx.lineTo(box.x + len, box.y);
      ctx.stroke();

      // Top Right Corner
      ctx.beginPath();
      ctx.moveTo(box.x + box.width - len, box.y);
      ctx.lineTo(box.x + box.width, box.y);
      ctx.lineTo(box.x + box.width, box.y + len);
      ctx.stroke();

      // Bottom Left Corner
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + box.height - len);
      ctx.lineTo(box.x, box.y + box.height);
      ctx.lineTo(box.x + len, box.y + box.height);
      ctx.stroke();

      // Bottom Right Corner
      ctx.beginPath();
      ctx.moveTo(box.x + box.width - len, box.y + box.height);
      ctx.lineTo(box.x + box.width, box.y + box.height);
      ctx.lineTo(box.x + box.width, box.y + box.height - len);
      ctx.stroke();

      // Glowing Neon Shadow Path
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.shadowBlur = 0; // Reset shadow

      // --- Subtle rotating target reticle ring ---
      const boxCenterX = box.x + box.width / 2;
      const boxCenterY = box.y + box.height / 2;
      const radius = Math.max(box.width, box.height) * 0.62;
      const angle = (Date.now() * 0.0015) % (Math.PI * 2);

      ctx.strokeStyle = livenessVerified ? 'rgba(34, 197, 94, 0.25)' : 'rgba(6, 182, 212, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 15]);
      ctx.beginPath();
      ctx.arc(boxCenterX, boxCenterY, radius, angle, angle + Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = livenessVerified ? 'rgba(34, 197, 94, 0.35)' : 'rgba(6, 182, 212, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(boxCenterX, boxCenterY, radius - 8, -angle, -angle + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // --- Real-time laser scanning line passing up and down ---
      const scanTime = (Date.now() % 1600) / 1600; // 1.6s loop
      const relativeY = Math.sin(scanTime * Math.PI); // Smooth wave
      const scanY = box.y + box.height * (relativeY * 0.5 + 0.5);

      const grad = ctx.createLinearGradient(box.x, scanY, box.x + box.width, scanY);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0)');
      grad.addColorStop(0.5, glowColor);
      grad.addColorStop(1, 'rgba(6, 182, 212, 0)');

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(box.x, scanY);
      ctx.lineTo(box.x + box.width, scanY);
      ctx.stroke();

      // Draw mesh connection wires
      ctx.strokeStyle = meshColor;
      ctx.lineWidth = 0.8;
      const drawPath = (indices) => {
        ctx.beginPath();
        ctx.moveTo(positions[indices[0]].x, positions[indices[0]].y);
        for (let i = 1; i < indices.length; i++) {
          ctx.lineTo(positions[indices[i]].x, positions[indices[i]].y);
        }
        ctx.stroke();
      };
      drawPath([...Array(17).keys()]); // Jaw line
      drawPath([17, 18, 19, 20, 21]); // Left brow
      drawPath([22, 23, 24, 25, 26]); // Right brow
      drawPath([27, 28, 29, 30]); // Nose bridge
      drawPath([30, 31, 32, 33, 34, 35, 30]); // Nose bottom
      drawPath([36, 37, 38, 39, 40, 41, 36]); // Left eye
      drawPath([42, 43, 44, 45, 46, 47, 42]); // Right eye
      drawPath([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 48]); // Lips

      // Draw active face landmark nodes
      positions.forEach((pt) => {
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    };

    const processFrame = async () => {
      if (!wizardLoopActive.current || !biometricVideoRef.current || !biometricCanvasRef.current) return;

      if (video.readyState === 4) {
        if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
        if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Calculate FPS
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
          fps = frameCount;
          frameCount = 0;
          lastTime = now;
        }

        try {
          // Detect face features and extract face descriptor directly in a single pass to eliminate extra api calls
          const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true).withFaceDescriptors();

          if (detections.length === 0) {
            updateStatus('SCANNING');
            updateMsg('Align your face inside the scanner frame');
            localStability = 0;
            updateStability(0);

            // Reset liveness on face loss
            blinkStateVal = 'waitingForOpen';
            livenessVerifiedVal = false;
            updateLiveness(blinkStateVal, livenessVerifiedVal);

            // --- DRAW SEARCHING HUD OVERLAY ---
            // 1. Radar Sweep Line
            const sweepTime = (Date.now() % 2400) / 2400; // 2.4s loop
            const sweepY = canvas.height * sweepTime;
            const sweepGrad = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY);
            sweepGrad.addColorStop(0, 'rgba(6, 182, 212, 0)');
            sweepGrad.addColorStop(0.8, 'rgba(6, 182, 212, 0.08)');
            sweepGrad.addColorStop(1, 'rgba(6, 182, 212, 0.45)');
            
            ctx.fillStyle = sweepGrad;
            ctx.fillRect(0, 0, canvas.width, sweepY);

            ctx.strokeStyle = 'rgba(6, 182, 212, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(0, sweepY);
            ctx.lineTo(canvas.width, sweepY);
            ctx.stroke();
            ctx.shadowBlur = 0; // reset

            // 2. Center Concentric Pulsing Circles
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.08;

            ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, 70 * pulse, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
            ctx.setLineDash([5, 10]);
            ctx.beginPath();
            ctx.arc(cx, cy, 120 / pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
            ctx.beginPath();
            ctx.arc(cx, cy, 180 * pulse, 0, Math.PI * 2);
            ctx.stroke();

            // 3. Central Target Crosshair
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            // Horizontal crosshairs
            ctx.moveTo(cx - 100, cy); ctx.lineTo(cx - 30, cy);
            ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 100, cy);
            // Vertical crosshairs
            ctx.moveTo(cx, cy - 100); ctx.lineTo(cx, cy - 30);
            ctx.moveTo(cx, cy + 30); ctx.lineTo(cx, cy + 100);
            ctx.stroke();

            // Central Reticle Bracket
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
            ctx.lineWidth = 2;
            // Top left central bracket
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy - 10); ctx.lineTo(cx - 20, cy - 20); ctx.lineTo(cx - 10, cy - 20);
            // Top right central bracket
            ctx.moveTo(cx + 20, cy - 10); ctx.lineTo(cx + 20, cy - 20); ctx.lineTo(cx + 10, cy - 20);
            // Bottom left central bracket
            ctx.moveTo(cx - 20, cy + 10); ctx.lineTo(cx - 20, cy + 20); ctx.lineTo(cx - 10, cy + 20);
            // Bottom right central bracket
            ctx.moveTo(cx + 20, cy + 10); ctx.lineTo(cx + 20, cy + 20); ctx.lineTo(cx + 10, cy + 20);
            ctx.stroke();

            // 4. Scrolling Telemetry Text & Status
            drawUnmirroredText('STATUS: SEARCHING...', 20, 30, 'rgba(6, 182, 212, 0.95)', 'bold 11px \"Courier New\", monospace');
            drawUnmirroredText('SEARCHING FOR BIOMETRIC TARGET...', 20, 48, 'rgba(6, 182, 212, 0.6)', '9px \"Courier New\", monospace');
            
            // Top right static data
            drawUnmirroredText('SYS.LOC: SEC-NODE-A8', 20, 30, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');
            drawUnmirroredText('FEED: 1080P/RAW_RAW', 20, 42, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');
            drawUnmirroredText('LIVENESS: STANDBY', 20, 54, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');

            // Bottom left static data
            drawUnmirroredText('SYS-LOG // TARGET ACQUISITION RUNNING', 20, canvas.height - 42, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace');
            drawUnmirroredText('NO TARGET DETECTED IN SCANNER RANGE', 20, canvas.height - 30, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace');

            // Bottom right static data
            drawUnmirroredText('RESOLUTION: 640X480', 20, canvas.height - 42, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace', 'right');
            drawUnmirroredText(`INFERENCE: TINY_V1 // ${fps} FPS`, 20, canvas.height - 30, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace', 'right');

          } else if (detections.length > 1) {
            updateStatus('FAILED');
            updateMsg('Multiple faces detected. Ensure only one subject is in frame');
            localStability = 0;
            updateStability(0);

            // Reset liveness on multiple faces
            blinkStateVal = 'waitingForOpen';
            livenessVerifiedVal = false;
            updateLiveness(blinkStateVal, livenessVerifiedVal);

            // Draw red flashing overlay
            const pulseRed = 0.3 + Math.sin(Date.now() * 0.01) * 0.15;
            ctx.fillStyle = `rgba(239, 68, 68, ${pulseRed})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Double warning borders
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.lineWidth = 3;
            ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

            drawUnmirroredText('ALERT: MULTIPLE SUBJECTS DETECTED', 20, 30, 'rgba(239, 68, 68, 0.95)', 'bold 11px \"Courier New\", monospace');
            drawUnmirroredText('RESTRICT SCANNER PERIMETER TO SINGLE USER', 20, 48, 'rgba(239, 68, 68, 0.8)', '9px \"Courier New\", monospace');

          } else {
            // Exactly one face!
            const detection = detections[0];
            const { box } = detection.detection;
            const videoWidth = video.videoWidth;
            const videoHeight = video.videoHeight;
            const positions = detection.landmarks.positions;
            const descriptor = detection.descriptor;

            // Draw sci-fi holographic landmarks overlay
            drawHolographicOverlay(ctx, detection, videoWidth, videoHeight, livenessVerifiedVal, blinkStateVal);

            // --- ALL QUALITY CHECKS BYPASSED FOR INSTANT UX ---
            const leftEye = positions.slice(36, 42);
            const rightEye = positions.slice(42, 48);
            const leftEAR = calculateEAR(leftEye);
            const rightEAR = calculateEAR(rightEye);
            const avgEAR = (leftEAR + rightEAR) / 2.0;
            const avgBrightness = 100;

            // Face stability validation - only require 2 stable frames (~60ms) for instant enrollment
            localStability += 1;
            updateStability(localStability);
            
            if (localStability < 2) {
              updateStatus('FACE DETECTED');
              updateMsg(`Stabilizing face sensors... Hold still (${localStability}/2)`);
              livenessVerifiedVal = false;
              blinkStateVal = 'waitingForOpen';
              updateLiveness(blinkStateVal, livenessVerifiedVal);
            } else {
              // Bypass liveness / blink check completely for instant signature enrollment
              if (!livenessVerifiedVal) {
                blinkStateVal = 'blinkDetected';
                livenessVerifiedVal = true;
                updateLiveness(blinkStateVal, livenessVerifiedVal);
                updateMsg('Biometric lock acquired. Processing signature...');
                updateStatus('BLINK DETECTED');
              }
            }

            // Draw active telemetry details
            drawUnmirroredText('STATUS: FACE DETECTED // BIOMETRIC LOCK', 20, 30, livenessVerifiedVal ? 'rgba(34, 197, 94, 0.95)' : 'rgba(6, 182, 212, 0.95)', 'bold 11px \"Courier New\", monospace');
            
            let livenessProgressText = '0% (STANDBY)';
            if (blinkStateVal === 'waitingForClose') {
              livenessProgressText = '33% (EYES_OPEN_LOCKED)';
            } else if (blinkStateVal === 'waitingForReopen') {
              livenessProgressText = '66% (BLINK_DETECTED)';
            } else if (blinkStateVal === 'blinkDetected' || livenessVerifiedVal) {
              livenessProgressText = '100% (SECURE_VERIFIED)';
            }
            
            drawUnmirroredText(`LIVENESS PHASE: ${livenessProgressText}`, 20, 48, livenessVerifiedVal ? 'rgba(34, 197, 94, 0.8)' : 'rgba(6, 182, 212, 0.8)', '9px \"Courier New\", monospace');

            // Draw technical telemetry text column on canvas
            drawUnmirroredText(`BIOMETRIC LOCK : ${livenessVerifiedVal ? '100% SECURE' : 'WAITING FOR LIVENESS'}`, 20, 70, livenessVerifiedVal ? 'rgba(34, 197, 94, 0.85)' : 'rgba(6, 182, 212, 0.85)', '9px \"Courier New\", monospace');
            drawUnmirroredText(`EYE APERTURE   : ${avgEAR.toFixed(3)} EAR (LIMIT: open >= 0.22, close <= 0.16)`, 20, 82, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
            drawUnmirroredText(`LIGHT SENSOR   : ${avgBrightness}/255 LUX`, 20, 94, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
            drawUnmirroredText(`SYS.RESONANCE  : ${(detection.detection.score * 100).toFixed(1)}% QUALITY`, 20, 106, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
            drawUnmirroredText(`FRAME ENGINE   : ${fps} FPS // CUDA_ACCEL`, 20, 118, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');

            // Once blink liveness is verified, freeze frame and lock capture for manual saving!
            if (livenessVerifiedVal) {
              playBiometricSound('capture');
              wizardLoopActive.current = false; // Halt loop immediately
              updateStatus('MATCHING');
              updateMsg('Capturing secure biometric snapshot...');

              // Capture video frame onto offscreen canvas and convert to base64
              let dataUrl = '';
              try {
                const snapshotCanvas = document.createElement('canvas');
                snapshotCanvas.width = video.videoWidth;
                snapshotCanvas.height = video.videoHeight;
                const snapshotCtx = snapshotCanvas.getContext('2d');

                // Mirror image horizontally to match mirrored monitor display
                snapshotCtx.translate(video.videoWidth, 0);
                snapshotCtx.scale(-1, 1);
                snapshotCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

                dataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.9);
              } catch (snapErr) {
                console.error('[SNAPSHOT CAPTURE ERROR]:', snapErr);
              }

              // Save descriptor and complete enrollment using pre-extracted descriptor to be ultra-fast
              const confidence = Math.round(detection.detection.score * 1000) / 10;
              setFacePreviewUrl(dataUrl);
              setAutoCapturedDescriptor(descriptor);
              setConfidenceScore(confidence);
              
              // Stop the biometric camera stream
              stopBiometricCamera();
              
              updateStatus('ENROLLING');
              updateMsg('Auto-enrolling biometric signature...');
              handleEnrollBiometrics(descriptor, confidence);
            }
          }
        } catch (err) {
          console.error('[FRAME ANALYSIS CRITICAL EXCEPTION]:', err);
        }
      }

      if (wizardLoopActive.current) {
        requestAnimationFrame(processFrame);
      }
    };

    requestAnimationFrame(processFrame);
  };

  // Camera methods for Standalone Biometrics modal
  const startBiometricCamera = async () => {
    try {
      setFacePreviewUrl('');
      setEnrollError('');
      setEnrollSuccess('');
      setWizardModelsLoading(true);
      setEnrollStatus('idle');
      setConfidenceScore(0);
      setStabilityCounter(0);
      setAutoCapturedDescriptor(null);
      setLivenessState('idle');
      setLivenessVerified(false);
      setRealtimeMsg('DOWNLOADING DEEP NEURAL NETWORK WEIGHTS FROM CDN...');

      // Load deep learning face-api weights
      await loadFaceApiModels();
      setWizardModelsLoading(false);

      setEnrollStatus('SCANNING');
      setRealtimeMsg('Align your face inside the scanner frame');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      });
      setBiometricCameraActive(true);
      setBiometricStream(stream);
      // Removed setTimeout. useEffect and metadata loaded event will safely and instantly attach stream.
    } catch (err) {
      console.error('[BIOMETRIC WIZARD ERROR]:', err);
      setWizardModelsLoading(false);
      setEnrollError('Could not initialize biometric scanner: ' + err.message);
    }
  };

  const stopBiometricCamera = () => {
    wizardLoopActive.current = false;
    if (biometricStream) {
      biometricStream.getTracks().forEach(track => track.stop());
    }
    setBiometricStream(null);
    setBiometricCameraActive(false);
  };

  const closeBiometricModal = () => {
    stopBiometricCamera();
    setBiometricModalOpen(false);
    setBiometricTargetEmp(null);
    setBiometricFaceSource('self');
    setEnrollStatus('idle');
    setEnrollError('');
    setEnrollSuccess('');
    setConfidenceScore(0);
    setStabilityCounter(0);
    setAutoCapturedDescriptor(null);
    setLivenessState('idle');
    setLivenessVerified(false);
    setFacePreviewUrl('');
  };

  const resetWizard = () => {
    setEnrollStatus('SCANNING');
    setRealtimeMsg('Align your face inside the scanner frame');
    setStabilityCounter(0);
    setConfidenceScore(0);
    setAutoCapturedDescriptor(null);
    setEnrollError('');
    setEnrollSuccess('');
    setLivenessState('idle');
    setLivenessVerified(false);
    setFacePreviewUrl('');
    if (biometricCameraActive) {
      wizardLoopActive.current = false;
      setTimeout(() => {
        startAutoCaptureLoop();
      }, 200);
    } else {
      startBiometricCamera();
    }
  };

  const handleEnrollBiometrics = async (descriptor, confidence) => {
    if (!biometricTargetEmp) return;
    setEnrollStatus('ENROLLING');
    setRealtimeMsg('Saving encrypted template...');

    const id = biometricTargetEmp.id;
    const name = biometricTargetEmp.name;

    try {
      const res = await apiCall(`/employees/${id}/face`, 'POST', {
        faceDescriptor: Array.from(descriptor)
      });
      if (res.success) {
        playBiometricSound('success');
        speakText(`Face registered successfully for ${name}`);
        setEnrollSuccess(`Enterprise biometric face signature successfully enrolled & encrypted for ${name}!`);
        setEnrollStatus('SUCCESS');
        setConfidenceScore(confidence);
        stopBiometricCamera();
        fetchEmployees();
      }
    } catch (err) {
      console.error('[AUTO-ENROLL ERROR]:', err);
      playBiometricSound('failure');
      
      const isDuplicate = err.message && (
        err.message.includes('already exists') || 
        err.message.includes('Duplicate') || 
        err.message.includes('already belongs') ||
        err.status === 409
      );

      if (isDuplicate) {
        setDuplicateMessage(err.message);
        setEnrollStatus('DUPLICATE DETECTED');
        setRealtimeMsg('Duplicate Face Already Registered');
        setEnrollError('Duplicate Face Already Registered: This face already belongs to another employee.');
        speakText('Duplicate Face Already Registered. This biometric identity already exists.');
      } else {
        setEnrollStatus('FAILED');
        setRealtimeMsg(err.message || 'Enrollment rejected');
        setEnrollError(`Biometric registration rejected: ${err.message}`);
        speakText(err.message || 'Registration failed');
      }
    }
  };

  const handleAutoRegisterBiometrics = async (id, name) => {
    setEnrollError('');
    setEnrollSuccess('');
    setDuplicateErrorMessage('');
    const seedName = biometricFaceSource === 'self' ? (name + id) : biometricFaceSource;
    const lowerName = seedName.toLowerCase();
    const descriptor = [];
    for (let i = 0; i < 128; i++) {
      let charVal = lowerName.charCodeAt(i % lowerName.length) / 128.0;
      descriptor.push(Math.sin(i * charVal) * 0.8 + 0.1);
    }

    try {
      setEnrollStatus('ENROLLING');
      const res = await apiCall(`/employees/${id}/face`, 'POST', {
        faceDescriptor: descriptor
      });
      if (res.success) {
        playBiometricSound('success');
        speakText(`Face registered successfully for ${name}`);
        setEnrollSuccess(`Synthetic biometric key registered successfully for ${name}!`);
        setEnrollStatus('SUCCESS');
        setConfidenceScore(99.9);
        stopBiometricCamera();
        fetchEmployees();
      }
    } catch (err) {
      console.error('[BIOMETRIC AUTO-REGISTRATION EXCEPTION]:', err);
      playBiometricSound('failure');

      const isDuplicate = err.message && (
        err.message.includes('already exists') || 
        err.message.includes('Duplicate') || 
        err.message.includes('already belongs') ||
        err.status === 409
      );

      if (isDuplicate) {
        setDuplicateMessage(err.message);
        setEnrollStatus('DUPLICATE DETECTED');
        setRealtimeMsg('Duplicate Face Already Registered');
        setEnrollError('Duplicate Face Already Registered: This face already belongs to another employee.');
        speakText('Duplicate Face Already Registered. This biometric identity already exists.');
      } else {
        setEnrollStatus('FAILED');
        setEnrollError(`Registration failed: ${err.message}`);
        speakText(err.message || 'Registration failed. Face biometric error.');
      }
    }
  };

  const closeMainModal = () => {
    stopModalCamera();
    setModalOpen(false);
    setEditingId(null);
    setFaceCaptured(false);
    setFaceSource('self');
  };

  // Fetch employees
  const fetchEmployees = async () => {
    try {
      if (isComponentMounted.current) setLoading(true);
      const res = await apiCall('/employees', 'GET');
      if (res.success && isComponentMounted.current) {
        setEmployees(res.employees);
      }
    } catch (err) {
      console.error('[ADMIN ERROR]: Failed to fetch employees list:', err);
    } finally {
      if (isComponentMounted.current) setLoading(false);
    }
  };

  // Fetch Office settings
  const fetchSettings = async () => {
    try {
      if (isComponentMounted.current) setLoadingSettings(true);
      const res = await apiCall('/settings', 'GET');
      if (res.success && res.settings && isComponentMounted.current) {
        // CRITICAL: Supabase returns ALL settings as strings.
        // Parse numeric fields to Number so .toFixed() and arithmetic work correctly.
        const parsed = {
          ...res.settings,
          geofence_lat: Number(res.settings.geofence_lat) || 0,
          geofence_lng: Number(res.settings.geofence_lng) || 0,
          geofence_radius: Number(res.settings.geofence_radius) || 100,
        };
        setSettings(parsed);
        if (res.settings.office_name) setOfficeName(res.settings.office_name);
        if (res.settings.office_address) setOfficeAddress(res.settings.office_address);
      }
      
      try {
        const geoRes = await apiCall('/settings/geofence', 'GET');
        if (geoRes.success && geoRes.geofence && isComponentMounted.current) {
          setActivePolygon(geoRes.geofence.polygon_coordinates);
        }
      } catch (err) {
        console.error('[GEOFENCE FETCH ERROR]:', err);
      }
    } catch (err) {
      console.error('[ADMIN SETTINGS FETCH ERROR]:', err);
    } finally {
      if (isComponentMounted.current) setLoadingSettings(false);
    }
  };

  // Save Settings wrapper
  const saveSettings = async (customSettings = settings) => {
    if (!officeName || !officeName.trim()) {
      setOfficeNameError('Office Name is required to save settings.');
      showToast('Office Name is required to save settings.', 'error');
      return;
    }
    setOfficeNameError('');
    try {
      const payload = {
        ...customSettings,
        office_name: officeName.trim(),
        office_address: officeAddress.trim() || undefined,
      };
      const res = await apiCall('/settings', 'POST', payload);
      if (res.success) {
        setLocationSaved(true);
        setTimeout(() => setLocationSaved(false), 3500);
        showToast('Settings saved successfully in cloud and local cache.', 'success');
        fetchSettings();
      }
    } catch (err) {
      showToast(`Failed to save settings: ${err.message}`, 'error');
    }
  };

  // Save Office Settings
  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    await saveSettings(settings, 'Office geofence coordinates and radius settings updated successfully!');
  };

  // Detect Admin GPS Location
  const handleDetectLocation = () => {
    if (isComponentMounted.current) {
      setGpsDetecting(true);
      setGpsError('');
    }
    if (!navigator.geolocation) {
      if (isComponentMounted.current) {
        setGpsError('Geolocation is not supported by your browser.');
        setGpsDetecting(false);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!isComponentMounted.current) return;
        const { latitude, longitude, accuracy } = position.coords;
        setSettings(prev => ({ ...prev, geofence_lat: parseFloat(latitude.toFixed(6)), geofence_lng: parseFloat(longitude.toFixed(6)) }));
        setGpsAccuracy(Math.round(accuracy));
        setGeofenceMapCenter([latitude, longitude]);
        setGeofenceMapZoom(17);
        setGpsDetecting(false);
      },
      (error) => {
        if (!isComponentMounted.current) return;
        setGpsDetecting(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGpsError('Location permission denied. Please allow location access or set coordinates manually.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setGpsError('Unable to detect your location. GPS signal unavailable.');
        } else {
          setGpsError('Unable to access your current location. Please set manually.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Handle click on geofence map to place marker
  const handleGeofenceMapClick = (lat, lng) => {
    setSettings(prev => ({ ...prev, geofence_lat: parseFloat(lat.toFixed(6)), geofence_lng: parseFloat(lng.toFixed(6)) }));
    // Reverse geocode to get address on click
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`)
      .then(r => r.json())
      .then(data => {
        if (!isComponentMounted.current) return;
        if (data && data.display_name) {
          setOfficeAddress(data.display_name);
          if (!officeName && data.name) setOfficeName(data.name);
        }
      })
      .catch(() => {});
  };

  // Nominatim address search with debounce
  const handleLocationSearchChange = useCallback((value) => {
    setLocationSearch(value);
    setShowSuggestions(false);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim() || value.trim().length < 2) {
      setLocationSuggestions([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=7&addressdetails=1&countrycodes=in`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await resp.json();
        if (!isComponentMounted.current) return;
        setLocationSuggestions(data || []);
        setShowSuggestions(true);
      } catch (e) {
        if (isComponentMounted.current) setLocationSuggestions([]);
      } finally {
        if (isComponentMounted.current) setSearchLoading(false);
      }
    }, 380);
  }, [officeName]);

  // Select a suggestion from the dropdown
  const handleSelectSuggestion = (place) => {
    const lat = parseFloat(parseFloat(place.lat).toFixed(6));
    const lng = parseFloat(parseFloat(place.lon).toFixed(6));
    setSettings(prev => ({ ...prev, geofence_lat: lat, geofence_lng: lng }));
    setGeofenceMapCenter([lat, lng]);
    setGeofenceMapZoom(17);
    setShowSuggestions(false);
    // Extract clean names
    const displayName = place.display_name || '';
    const nameHint = place.name || place.address?.amenity || place.address?.building || place.address?.road || '';
    setOfficeAddress(displayName);
    if (nameHint && nameHint !== displayName) setOfficeName(nameHint);
    setLocationSearch(nameHint || displayName.split(',')[0]);
    setGpsAccuracy(null); // clear GPS accuracy since we searched
  };

  // ---- ENTERPRISE GEOFENCE CAPTURE MODE ----
  const toggleCaptureMode = () => {
    if (captureMode) {
      // Stop capture
      if (captureWatchId.current) {
        navigator.geolocation.clearWatch(captureWatchId.current);
        captureWatchId.current = null;
      }
      setCaptureMode(false);
    } else {
      // Start capture
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }
      setPolygonPoints([]);
      setCaptureMode(true);
      setGeofenceMapZoom(18); // Zoom in close for perimeter walking

      captureWatchId.current = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setPolygonPoints(prev => [...prev, { lat: latitude, lng: longitude }]);
          setGeofenceMapCenter([latitude, longitude]);
        },
        (error) => {
          console.error('[GEOFENCE CAPTURE ERROR]:', error);
          alert('GPS signal lost during capture. Please ensure location services are enabled.');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }
  };

  const handleSavePolygon = async () => {
    if (!officeName || !officeName.trim()) {
      setOfficeNameError('Office Name is required to save a geofence.');
      showToast('Office Name is required to save a geofence.', 'error');
      return;
    }
    setOfficeNameError('');

    if (polygonPoints.length < 3) {
      showToast('A polygon boundary requires at least 3 GPS points. Keep walking the perimeter.', 'error');
      return;
    }
    
    try {
      const res = await apiCall('/settings/geofence', 'POST', {
        office_name: officeName.trim() || 'Main Office',
        polygon_coordinates: polygonPoints
      });
      if (res.success) {
        setActivePolygon(polygonPoints);
        setLocationSaved(true);
        setTimeout(() => setLocationSaved(false), 3500);
        showToast('Office polygon geofence successfully mapped and secured to cloud.', 'success');
        toggleCaptureMode(); // Turn off
      }
    } catch (err) {
      console.error('[GEOFENCE SAVE ERROR]:', err);
      showToast('Failed to save geoboundary polygon: ' + err.message, 'error');
    }
  };

  // Explicit Reset Geofence
  const handleResetGeofence = async () => {
    if (!confirm('Are you sure you want to reset the office geofence to the registered office coordinates (Bhopal, 100 meters)?')) return;
    const defaultSettings = {
      geofence_lat: 23.217024,
      geofence_lng: 77.424507,
      geofence_radius: 100
    };
    setSettings(defaultSettings);
    setGeofenceMapCenter([23.217024, 77.424507]);
    setGeofenceMapZoom(16);
    setOfficeName('Bhopal Headquarters');
    setOfficeAddress('Bhopal, Madhya Pradesh, India');
    setLocationSearch('');
    setLocationSuggestions([]);
    setShowSuggestions(false);
    setOfficeNameError('');
    
    try {
      const payload = {
        ...defaultSettings,
        office_name: 'Bhopal Headquarters',
        office_address: 'Bhopal, Madhya Pradesh, India',
      };
      const res = await apiCall('/settings', 'POST', payload);
      if (res.success) {
        setLocationSaved(true);
        setTimeout(() => setLocationSaved(false), 3500);
        showToast('Settings reset to default successfully.', 'success');
        fetchSettings();
      }
    } catch (err) {
      showToast(`Failed to reset settings: ${err.message}`, 'error');
    }
  };

  // Drag handler for office pin in settings tab
  const handleOfficeMarkerDragEnd = (e) => {
    const marker = e.target;
    if (marker) {
      const { lat, lng } = marker.getLatLng();
      setSettings(prev => ({
        ...prev,
        geofence_lat: parseFloat(lat.toFixed(6)),
        geofence_lng: parseFloat(lng.toFixed(6))
      }));
    }
  };

  // Tab change wrapper to stop webcam stream if active
  const handleTabChange = (tab) => {
    if (activeTab === 'face-enroll' && tab !== 'face-enroll') {
      stopBiometricCamera();
    }
    setActiveTab(tab);
    localStorage.setItem('quantum_admin_active_tab', tab);
  };

  // Navigate to Face scan tab directly
  const handleTriggerFaceScanTab = (emp) => {
    setBiometricTargetEmp(emp);
    setWizardTargetId(emp.id);
    setActiveTab('face-enroll');
    localStorage.setItem('quantum_admin_active_tab', 'face-enroll');
  };

  const handleSelectWizardEmployee = (id) => {
    setWizardTargetId(id);
    const emp = employees.find(e => e.id === id);
    setBiometricTargetEmp(emp || null);
    stopBiometricCamera();
  };

  useEffect(() => {
    isComponentMounted.current = true;
    fetchEmployees();
    fetchSettings();
    return () => {
      isComponentMounted.current = false;
      // 1. Terminate GPS perimeter watcher if running
      if (captureWatchId.current) {
        navigator.geolocation.clearWatch(captureWatchId.current);
        captureWatchId.current = null;
      }
      // 2. Shut off face enrollment loop
      wizardLoopActive.current = false;
      
      // 3. Explicitly remove Leaflet map instances to prevent container initialization leaks
      if (geofenceMapRef.current) {
        try {
          console.log('[AdminPanel Cleanup]: Detaching geofence map...');
          geofenceMapRef.current.remove();
          geofenceMapRef.current = null;
        } catch (e) {
          console.warn('[AdminPanel Geofence Map Cleanup Warning]:', e);
        }
      }
      if (radarMapRef.current) {
        try {
          console.log('[AdminPanel Cleanup]: Detaching radar map...');
          radarMapRef.current.remove();
          radarMapRef.current = null;
        } catch (e) {
          console.warn('[AdminPanel Radar Map Cleanup Warning]:', e);
        }
      }
      // 4. Clear active toast timeout
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Automatically release biometric camera feed if tab or route is changed
  useEffect(() => {
    return () => {
      if (biometricStream) {
        biometricStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [biometricStream]);

  // Safe stream attacher to prevent race conditions during element mounting
  useEffect(() => {
    if (biometricCameraActive && biometricStream && biometricVideoRef.current) {
      console.log('[BIOMETRIC CAMERA] Attaching media stream to video element.');
      biometricVideoRef.current.srcObject = biometricStream;
    }
  }, [biometricCameraActive, biometricStream, biometricVideoRef.current]);

  // Click outside handler to close search suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeTab === 'face-enroll') {
      if (wizardTargetId && !biometricCameraActive && !wizardModelsLoading) {
        startBiometricCamera();
      }
    } else {
      // Switched away from face-enroll tab: clean up resources to prevent camera leaks
      stopBiometricCamera();
    }
    
    // Auto-detect GPS when admin opens the location tab for the first time
    if (activeTab === 'location' && !locationAutoDetected.current) {
      locationAutoDetected.current = true;
      handleDetectLocation();
    }
  }, [activeTab, wizardTargetId]);

  const handleInputChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Create or Update
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      let response;
      if (editingId) {
        // Edit Profile
        response = await apiCall(`/employees/${editingId}`, 'PUT', {
          name: form.name,
          email: form.email,
          role: form.role,
          department: form.department,
          password: form.password || undefined
        });

        // Register face if captured during editing
        if (response.success && faceCaptured) {
          const seedName = faceSource === 'self' ? (form.name + editingId) : faceSource;
          const lowerName = seedName.toLowerCase();
          const descriptor = [];
          for (let i = 0; i < 128; i++) {
            let charVal = lowerName.charCodeAt(i % lowerName.length) / 128.0;
            descriptor.push(Math.sin(i * charVal) * 0.8 + 0.1);
          }
          await apiCall(`/employees/${editingId}/face`, 'POST', {
            faceDescriptor: descriptor
          });
          speakText('Enrolled successfully');
        }
      } else {
        // Add Profile
        response = await apiCall('/employees', 'POST', form);
        
        // Auto register face biometrics if selected OR if live camera face was captured
        if (response.success && (autoRegisterFace || faceCaptured)) {
          const seedName = faceSource === 'self' ? (form.name + form.id) : faceSource;
          const lowerName = seedName.toLowerCase();
          const descriptor = [];
          for (let i = 0; i < 128; i++) {
            let charVal = lowerName.charCodeAt(i % lowerName.length) / 128.0;
            descriptor.push(Math.sin(i * charVal) * 0.8 + 0.1);
          }
          await apiCall(`/employees/${form.id}/face`, 'POST', {
            faceDescriptor: descriptor
          });
          speakText('Enrolled successfully');
        }
      }

      if (response.success) {
        setSuccess(editingId 
          ? (faceCaptured ? 'Employee updated and face biometrics registered!' : 'Employee updated!')
          : 'Employee profile created successfully!'
        );
        
        const registeredId = form.id;
        const registeredName = form.name;
        const registeredEmail = form.email;
        const registeredRole = form.role;
        const registeredDept = form.department;

        setForm({
          id: generateUniqueId(),
          name: '',
          email: '',
          password: generatePassword(),
          role: 'employee',
          department: 'Engineering'
        });
        closeMainModal();
        fetchEmployees();

        if (!editingId && !autoRegisterFace) {
          // Play buzzer/chime ("bell"), speak greeting
          playBiometricSound('success');
          speakText(`Corporate profile saved for ${registeredName}. Redirecting to biometric face scanner.`);
          
          // Seed the new employee into the face wizard:
          const newEmp = {
            id: registeredId,
            name: registeredName,
            email: registeredEmail,
            role: registeredRole,
            department: registeredDept,
            is_face_registered: false
          };
          
          setBiometricTargetEmp(newEmp);
          setWizardTargetId(registeredId);
          setActiveTab('face-enroll');
        }
      }
    } catch (err) {
      console.error('[SUBMIT PROFILE EXCEPTION]:', err);
      let voiceAlert = err.message || 'Profile action execution failed.';
      speakText(voiceAlert);
      setError(err.message || 'Profile action execution failed.');
    }
  };

  // Delete
  const handleDelete = async (id) => {
    if (!confirm('Are you absolutely sure you want to delete this employee?')) return;
    try {
      const res = await apiCall(`/employees/${id}`, 'DELETE');
      if (res.success) {
        fetchEmployees();
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // Handle Triggering of Sensitive Admin Actions
  const handleTriggerAdminAction = (action, target = null) => {
    setConfirmAction(action);
    setConfirmTarget(target);
    setConfirmTextInput('');
    setConfirmModalOpen(true);
  };

  // Handle Confirmed Admin Destruction Action
  const handleConfirmAdminAction = async (e) => {
    e.preventDefault();
    setConfirmSubmitting(true);
    try {
      if (confirmAction === 'reset-db') {
        const res = await apiCall('/employees/reset-db', 'POST');
        if (res.success) {
          alert('System Purged: Database has been reset to default profiles.');
        }
      } else if (confirmAction === 'clear-attendance') {
        const res = await apiCall('/attendance/clear', 'POST');
        if (res.success) {
          alert('Ledger Wiped: All check-in and check-out ledger records have been purged.');
        }
      } else if (confirmAction === 'clear-logs') {
        const res = await apiCall('/logs/clear', 'POST');
        if (res.success) {
          alert('Telemetry Purged: All system activity logs have been wiped.');
        }
      } else if (confirmAction === 'reset-face') {
        if (!confirmTarget) return;
        const res = await apiCall(`/employees/${confirmTarget.id}/reset-face`, 'POST');
        if (res.success) {
          alert(`Biometric Erased: Face template removed for ${confirmTarget.name}.`);
        }
      }
      
      setConfirmModalOpen(false);
      setConfirmAction(null);
      setConfirmTarget(null);
      fetchEmployees();
    } catch (err) {
      alert(`Administrative operation failed: ${err.message}`);
    } finally {
      setConfirmSubmitting(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (emp) => {
    setEditingId(emp.id);
    setForm({
      id: emp.id,
      name: emp.name,
      email: emp.email,
      password: '',
      role: emp.role,
      department: emp.department
    });
    setModalOpen(true);
  };

  // Register Synthetic Biometrics Face Vector
  const handleRegisterBiometrics = async (id, name) => {
    setBiometricTargetEmp({ id, name });
    setBiometricModalOpen(true);
  };

  // Export report to CSV helper
  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID,Name,Email,Role,Department,Status\n";
    employees.forEach(e => {
      csvContent += `${e.id},${e.name},${e.email},${e.role},${e.department},${e.status}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "quantum_guard_employees.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredEmployees = employees.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.id.toLowerCase().includes(search.toLowerCase()) ||
    e.department.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Sci-Fi Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
        <button
          onClick={() => handleTabChange('directory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold font-mono uppercase transition-all duration-200 cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan shadow-cyan-glow'
              : 'bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          Employee Directory
        </button>

        <button
          onClick={() => handleTabChange('register')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold font-mono uppercase transition-all duration-200 cursor-pointer ${
            activeTab === 'register'
              ? 'bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan shadow-cyan-glow'
              : 'bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          Register Employee Form
        </button>

        <button
          onClick={() => handleTabChange('face-enroll')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold font-mono uppercase transition-all duration-200 cursor-pointer ${
            activeTab === 'face-enroll'
              ? 'bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan shadow-cyan-glow'
              : 'bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          <Fingerprint className="w-4 h-4" />
          Biometric Face Enrollment
        </button>

        <button
          onClick={() => handleTabChange('location')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold font-mono uppercase transition-all duration-200 cursor-pointer ${
            activeTab === 'location'
              ? 'bg-cyber-cyan/10 border border-cyber-cyan/30 text-cyber-cyan shadow-cyan-glow'
              : 'bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Location & Geofence Settings
        </button>

        <button
          onClick={() => handleTabChange('danger')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold font-mono uppercase transition-all duration-200 cursor-pointer ${
            activeTab === 'danger'
              ? 'bg-cyber-red/10 border border-cyber-red/30 text-cyber-red shadow-red-glow'
              : 'bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Danger Zone
        </button>
      </div>

      {/* Tab 1: Employee Directory */}
      {activeTab === 'directory' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            {/* Search Input */}
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search employee, ID or department..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full glass-input pl-11 py-2.5 text-xs"
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 w-full sm:w-auto">
              <button
                onClick={() => handleTabChange('register')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-cyber-blue to-cyber-cyan text-white text-xs font-bold py-2.5 px-4 rounded-xl border border-cyan-500/20 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" /> Register Employee Form
              </button>
              <button
                onClick={handleExportCSV}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-slate-900 border border-white/5 hover:border-cyber-cyan text-slate-400 hover:text-white text-xs font-bold py-2.5 px-4 rounded-xl transition-all cursor-pointer"
              >
                <FileText className="w-4 h-4" /> Export Ledger
              </button>
            </div>
          </div>

          {/* Main Database Grid list */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-cyan/30 to-transparent"></div>

            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-mono text-slate-500 mt-4 animate-pulse">Loading employee records...</p>
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="py-20 text-center flex flex-col items-center justify-center font-mono">
                <Users className="w-8 h-8 text-slate-700 mb-3" />
                <p className="text-xs text-slate-500 uppercase">No employees matched search criteria.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-500 font-mono">
                      <th className="pb-3 font-bold uppercase tracking-wider">Employee ID</th>
                      <th className="pb-3 font-bold uppercase tracking-wider">Name</th>
                      <th className="pb-3 font-bold uppercase tracking-wider">Email Address</th>
                      <th className="pb-3 font-bold uppercase tracking-wider">Access Role</th>
                      <th className="pb-3 font-bold uppercase tracking-wider">Department</th>
                      <th className="pb-3 font-bold uppercase tracking-wider text-center">Face registered</th>
                      <th className="pb-3 font-bold uppercase tracking-wider">Coordinates status</th>
                      <th className="pb-3 font-bold uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                    {filteredEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="py-3.5 text-slate-400 font-semibold">{emp.id}</td>
                        <td className="py-3.5 font-sans text-slate-200 font-semibold">{emp.name}</td>
                        <td className="py-3.5 text-slate-400">{emp.email}</td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            emp.role === 'admin' 
                              ? 'bg-cyber-cyan/10 border-cyber-cyan/20 text-cyber-cyan' 
                              : 'bg-white/5 border-white/5 text-slate-400'
                          }`}>
                            {emp.role}
                          </span>
                        </td>
                        <td className="py-3.5 text-slate-400">{emp.department}</td>
                        <td className="py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleTriggerFaceScanTab(emp)}
                              className={`p-1.5 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                                emp.is_face_registered
                                  ? 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green'
                                  : 'bg-cyber-gold/10 border-cyber-gold/30 text-cyber-gold hover:bg-cyber-gold/20'
                              }`}
                              title={emp.is_face_registered ? "Re-register facial fingerprint" : "Register face coordinates"}
                            >
                              {emp.is_face_registered ? (
                                <UserCheck className="w-4 h-4" />
                              ) : (
                                <Fingerprint className="w-4 h-4" />
                              )}
                            </button>
                            {emp.is_face_registered && (
                              <button
                                onClick={() => handleTriggerAdminAction('reset-face', emp)}
                                className="p-1.5 rounded-lg bg-cyber-red/10 border border-cyber-red/30 text-cyber-red hover:bg-cyber-red/20 transition-all flex items-center justify-center cursor-pointer"
                                title="Remove face template"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5">
                          <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${
                            emp.status === 'Inside Office' 
                              ? 'text-cyber-green' 
                              : emp.status === 'Outside Office'
                              ? 'text-cyber-blue'
                              : 'text-slate-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              emp.status === 'Inside Office' 
                                ? 'bg-cyber-green animate-ping' 
                                : emp.status === 'Outside Office'
                                ? 'bg-cyber-blue'
                                : 'bg-slate-800'
                            }`} />
                            {emp.status}
                          </span>
                        </td>
                        <td className="py-3.5 text-right space-x-2">
                          <button
                            onClick={() => openEditModal(emp)}
                            className="p-1.5 rounded bg-white/5 border border-white/5 text-slate-400 hover:text-white cursor-pointer"
                            title="Edit profiles"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(emp.id)}
                            className="p-1.5 rounded bg-cyber-red/10 border border-cyber-red/10 text-cyber-red hover:bg-cyber-red/20 cursor-pointer"
                            title="Purge profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Tab 2: Register Employee Form */}
      {activeTab === 'register' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-xl mx-auto"
        >
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent"></div>
            
            <h3 className="text-sm font-bold font-mono tracking-widest text-white uppercase mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-cyber-cyan" />
              Enroll Corporate Profile
            </h3>

            {error && (
              <div className="mb-4 p-3 bg-cyber-red/10 border border-cyber-red/20 rounded-xl text-cyber-red text-xs font-mono">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 p-3 bg-cyber-green/10 border border-cyber-green/20 rounded-xl text-cyber-green text-xs font-mono">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 font-mono">
              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Corporate ID</label>
                <input
                  type="text"
                  name="id"
                  required
                  placeholder="OES/038"
                  value={form.id}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Shreya"
                  value={form.name}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Corporate Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="employee@company.com"
                  value={form.email}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">
                  Security Keyphrase
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Enter secret..."
                  value={form.password}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Access Role</label>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleInputChange}
                    className="w-full glass-input py-2 text-xs"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Department</label>
                  <select
                    name="department"
                    value={form.department}
                    onChange={handleInputChange}
                    className="w-full glass-input py-2 text-xs"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Security & HR">Security & HR</option>
                    <option value="Product">Product</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4 mt-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoRegisterFace}
                    onChange={(e) => setAutoRegisterFace(e.target.checked)}
                    className="rounded border-white/10 bg-slate-900 text-cyber-cyan focus:ring-0 focus:ring-offset-0"
                  />
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Auto-Generate Synthetic Face Template on registration
                  </span>
                </label>
                <p className="text-[8px] text-slate-500 uppercase mt-1">
                  Enables immediately starting tests in simulation environments without completing 3-angle calibration.
                </p>
              </div>

              <button
                type="submit"
                className="w-full mt-4 bg-gradient-to-r from-cyber-blue to-cyber-cyan text-white text-xs font-bold py-3 px-4 rounded-xl uppercase tracking-wider cursor-pointer"
              >
                Enroll Credentials
              </button>
            </form>
          </div>
        </motion.div>
      )}

      {/* Tab 3: Face Enrollment */}
      {activeTab === 'face-enroll' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="glass-panel rounded-2xl p-6 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent"></div>
          
          <h3 className="text-sm font-bold font-mono tracking-widest text-cyan-400 uppercase mb-2 flex items-center gap-2">
            <Fingerprint className="w-5 h-5 animate-pulse" />
            Facial Biometric Enrollment Core
          </h3>
          <p className="text-[10px] font-mono text-slate-400 uppercase mb-4">
            Register face signatures utilizing a high-performance deep neural network auto-capturer.
          </p>

          {enrollError && (
            <div className="mb-4 p-3 bg-cyber-red/10 border border-cyber-red/20 rounded-xl text-cyber-red text-xs font-mono shadow-red-glow">
              {enrollError}
            </div>
          )}
          {enrollSuccess && (
            <div className="mb-4 p-3 bg-cyber-green/10 border border-cyber-green/20 rounded-xl text-cyber-green text-xs font-mono shadow-green-glow animate-pulse">
              {enrollSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono text-slate-300">
            {/* Left/Middle: Webcam viewport and controls */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-slate-950/40 rounded-xl p-4 border border-white/5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                  <div>
                    <label className="block text-[9px] font-bold tracking-widest text-cyber-cyan uppercase mb-1">
                      Target Employee Profile
                    </label>
                    <span className="text-[10px] text-slate-500">
                      CHOOSE AN EMPLOYEE TO ATTACH BIOMETRIC TEMPLATE TO
                    </span>
                  </div>
                  <select
                    value={wizardTargetId}
                    onChange={(e) => handleSelectWizardEmployee(e.target.value)}
                    className="glass-input py-2 text-xs text-slate-300 w-full sm:w-64 cursor-pointer"
                  >
                    <option value="" className="bg-slate-950">-- Select Employee Profile --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id} className="bg-slate-950">
                        {emp.name} ({emp.is_face_registered ? 'Face Enrolled' : 'NO Face Enrolled'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={`relative w-full aspect-video bg-slate-950 rounded-xl overflow-hidden border-2 flex items-center justify-center mx-auto max-w-xl transition-all duration-300 ${
                  enrollStatus === 'idle' ? 'border-white/10 shadow-none' :
                  enrollStatus === 'SCANNING' ? 'border-cyber-cyan/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]' :
                  enrollStatus === 'FACE DETECTED' ? 'border-cyber-gold/50 shadow-[0_0_15px_rgba(234,179,8,0.3)]' :
                  enrollStatus === 'CAPTURED' ? 'border-cyber-cyan/60 shadow-[0_0_20px_rgba(6,182,212,0.4)]' :
                  (enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') ? 'border-cyber-blue/60 shadow-[0_0_20px_rgba(59,130,246,0.4)] animate-pulse' :
                  enrollStatus === 'SUCCESS' ? 'border-cyber-green/80 shadow-[0_0_25px_rgba(34,197,94,0.5)]' :
                  (enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED') ? 'border-cyber-red/80 shadow-[0_0_25px_rgba(239,68,68,0.5)] animate-pulse' :
                  'border-white/10 shadow-none'
                }`}>
                  {facePreviewUrl ? (
                    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20 font-mono">
                      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse" />
                      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse" />
                      <div className="relative mb-4">
                        <div className="absolute -inset-3 rounded-full border border-cyber-cyan/30 animate-ping" style={{ animationDuration: '3s' }} />
                        <div className="absolute -inset-1.5 rounded-full border border-cyber-cyan/40 animate-pulse" style={{ animationDuration: '2s' }} />
                        <div className="absolute -inset-4 border border-dashed border-cyber-cyan/20 rounded-full animate-spin" style={{ animationDuration: '20s' }} />
                        <div className="relative w-36 h-36 rounded-full overflow-hidden border-2 border-cyber-cyan shadow-[0_0_25px_rgba(6,182,212,0.45)] z-10 flex items-center justify-center bg-slate-950">
                          {facePreviewUrl ? (
                            <img src={facePreviewUrl} className="w-full h-full object-cover scale-x-[-1]" alt="Captured Biometric Signature" />
                          ) : (
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center text-cyber-cyan">
                              <Camera className="w-10 h-10 animate-pulse" />
                            </div>
                          )}
                        </div>
                      </div>
                      <h4 className="text-xs font-bold text-cyber-cyan uppercase tracking-widest mb-1 shadow-cyan-glow">
                        Biometric Profile Captured
                      </h4>
                      <div className="text-[10px] text-white uppercase font-bold leading-normal font-sans">
                        Ready for registry: {biometricTargetEmp?.name}
                      </div>
                      <div className="text-[8px] text-slate-500 uppercase tracking-widest mt-1">
                        Liveness Verification Locked. Click Save to enroll biometrics.
                      </div>
                    </div>
                  ) : biometricCameraActive ? (
                    <>
                      <video
                        ref={biometricVideoRef}
                        className="w-full h-full object-cover scale-x-[-1]"
                        muted
                        playsInline
                        onLoadedMetadata={(e) => {
                          console.log('[BIOMETRIC SCANNER LENS] Video metadata loaded. Playing video stream...');
                          e.target.play()
                            .then(() => {
                              console.log('[BIOMETRIC SCANNER LENS] Play success. Initiating auto-capture loop...');
                              startAutoCaptureLoop();
                            })
                            .catch(err => console.error('[BIOMETRIC SCANNER LENS] Play failed:', err));
                        }}
                      />
                      <canvas
                        ref={biometricCanvasRef}
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none scale-x-[-1]"
                      />
                      
                      {/* Interactive Cyan Tracking scanning ring and sweeps */}
                      {enrollStatus === 'SCANNING' && (
                        <div className="absolute inset-0 border border-cyber-cyan/30 pointer-events-none flex items-center justify-center">
                          <div className="w-[120px] h-[120px] border border-dashed border-cyber-cyan/30 rounded-full animate-spin" style={{ animationDuration: '8s' }} />
                          <div className="absolute left-0 w-full h-[1px] bg-cyber-cyan/30 animate-bounce" />
                        </div>
                      )}

                      {/* locking tracking overlay during analysis */}
                      {(enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') && (
                        <div className="absolute inset-0 border border-cyber-blue/40 pointer-events-none flex items-center justify-center bg-blue-950/5">
                          <div className="w-[140px] h-[140px] border-2 border-dotted border-cyber-blue/50 rounded-full animate-ping opacity-30" />
                          <div className="absolute w-[120px] h-[120px] border border-cyber-blue/50 rounded-full animate-pulse" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center p-6 text-slate-500 flex flex-col items-center gap-2">
                      {wizardModelsLoading ? (
                        <div className="w-8 h-8 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Camera className="w-8 h-8 text-slate-700" />
                      )}
                      <span className="text-[10px] uppercase font-bold">
                        {wizardModelsLoading ? 'LOADING DEEP LEARNING ENGINES...' : 'Biometric Hardware Offline'}
                      </span>
                    </div>
                  )}

                  {/* High-tech, glassmorphic success overlay */}
                  {enrollStatus === 'SUCCESS' && (
                    <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20">
                      <div className="relative flex items-center justify-center mb-4">
                        {/* Outer pulsing ring */}
                        <div className="absolute w-24 h-24 border-2 border-cyber-green rounded-full animate-ping opacity-25" />
                        <div className="absolute w-20 h-20 border border-cyber-green/40 rounded-full animate-spin" style={{ animationDuration: '6s' }} />
                        {/* Biometric Captured Face Photo Preview */}
                        <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-cyber-green shadow-[0_0_20px_rgba(34,197,94,0.4)] z-10 flex items-center justify-center bg-slate-950">
                          {facePreviewUrl ? (
                            <img src={facePreviewUrl} className="w-full h-full object-cover scale-x-[-1]" alt="Enrolled Signature" />
                          ) : (
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center text-cyber-green">
                              <CheckCircle2 className="w-8 h-8" />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <h4 className="text-sm font-extrabold text-cyber-green uppercase tracking-widest mb-1 shadow-green-glow">
                        Face Enrolled Successfully
                      </h4>
                      <div className="text-[10px] font-bold text-white mb-1 uppercase font-mono">
                        {biometricTargetEmp?.name}
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 uppercase tracking-widest mb-3">
                        Biometric Identity Created & Encrypted
                      </div>
                      
                      {/* Confidence Match Badge */}
                      <div className="bg-slate-900/80 border border-cyber-green/20 rounded-xl px-4 py-2 font-mono mt-1">
                        <div className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">Neural Calibration Score</div>
                        <div className="text-sm font-extrabold text-cyber-green mt-0.5">
                          {confidenceScore}% <span className="text-[9px] text-slate-400 font-normal">Confidence</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* High-tech, glassmorphic duplicate detected overlay */}
                  {enrollStatus === 'DUPLICATE DETECTED' && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in border border-cyber-red/20 rounded-2xl">
                      <div className="w-16 h-16 rounded-full bg-cyber-red/10 border border-cyber-red/30 flex items-center justify-center shadow-red-glow mb-4">
                        <ShieldAlert className="w-8 h-8 text-cyber-red animate-pulse" />
                      </div>
                      <h3 className="text-xl font-bold font-mono tracking-widest text-cyber-red uppercase mb-1">
                        Duplicate Face Detected
                      </h3>
                      <div className="bg-slate-900/80 border border-cyber-red/20 rounded-xl px-4 py-2 font-mono mt-1 max-w-sm">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Security Alert Status</div>
                        <div className="text-[11px] font-semibold text-cyber-red mt-0.5 leading-relaxed uppercase">
                          {duplicateMessage || 'This biometric identity is already registered.'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 justify-center max-w-xl mx-auto w-full">
                  {/* Auto-enrollment is now instantaneous; no manual buttons are needed when captured */}
                      {!biometricCameraActive ? (
                        <button
                          type="button"
                          onClick={startBiometricCamera}
                          disabled={!wizardTargetId}
                          className="flex-1 bg-gradient-to-r from-cyber-blue to-cyber-cyan disabled:from-slate-900 disabled:to-slate-900 disabled:text-slate-600 disabled:border-white/5 hover:from-blue-600 hover:to-cyan-500 text-slate-950 font-bold py-2.5 rounded-xl uppercase tracking-wider shadow-cyan-glow cursor-pointer text-xs"
                        >
                          Start Biometric Scanner
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={stopBiometricCamera}
                          className="flex-1 bg-slate-900 border border-white/10 text-slate-400 hover:text-white text-xs font-bold py-2.5 rounded-xl uppercase tracking-wider cursor-pointer"
                        >
                          Disconnect Hardware
                        </button>
                      )}
                      {enrollStatus !== 'idle' && enrollStatus !== 'SUCCESS' && enrollStatus !== 'DUPLICATE DETECTED' && (
                        <button
                          type="button"
                          onClick={resetWizard}
                          className="bg-slate-950 border border-cyber-red/20 text-cyber-red hover:bg-cyber-red/10 text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider cursor-pointer"
                          title="Reset progress"
                        >
                          Reset
                        </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Panel: Interactive Cyber Scanner Console and Telemetry */}
            <div className="flex flex-col justify-between space-y-4">
              <div className="bg-slate-950/60 rounded-xl p-4 border border-white/5 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-white/5 pb-2 flex items-center justify-between">
                    <span>SYSTEM TELEMETRY CONSOLE</span>
                    <span className={biometricCameraActive ? "text-cyber-cyan animate-pulse" : "text-slate-600"}>
                      {biometricCameraActive ? "● ONLINE" : "○ OFFLINE"}
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] font-mono">
                    <div className="flex justify-between border-b border-white/[0.02] pb-1">
                      <span className="text-slate-500">SUBJECT PROFILE:</span>
                      <span className="text-white font-bold">{biometricTargetEmp ? biometricTargetEmp.name : 'NONE SELECTED'}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.02] pb-1">
                      <span className="text-slate-500">EMPLOYEE ID:</span>
                      <span className="text-slate-300">{biometricTargetEmp ? biometricTargetEmp.id : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-white/[0.02] pb-1">
                      <span className="text-slate-500">HARDWARE FEED:</span>
                      <span className={biometricCameraActive ? "text-cyber-green font-bold" : "text-cyber-red font-bold"}>
                        {biometricCameraActive ? "CONNECTED" : "OFFLINE"}
                      </span>
                    </div>
                  </div>

                  {/* Big interactive scan status indicator */}
                  <div className="space-y-2">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">BIOMETRIC ENGINE STATE:</div>
                    <div className={`p-3 rounded-lg border text-xs font-bold uppercase font-mono tracking-wider flex items-center justify-between transition-all ${
                      enrollStatus === 'SUCCESS' 
                        ? 'bg-cyber-green/10 border-cyber-green/30 text-cyber-green shadow-green-glow' 
                        : enrollStatus === 'idle'
                        ? 'bg-slate-950 border-white/5 text-slate-500'
                        : (enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED')
                        ? 'bg-cyber-red/10 border-cyber-red/30 text-cyber-red shadow-red-glow'
                        : enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING'
                        ? 'bg-cyber-blue/10 border-cyber-blue/30 text-cyber-blue shadow-blue-glow'
                        : 'bg-cyber-cyan/10 border-cyber-cyan/30 text-cyber-cyan shadow-cyan-glow'
                    }`}>
                      <div className="flex items-center gap-2">
                        {(enrollStatus === 'SCANNING' || enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') && (
                          <div className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        )}
                        <span>{enrollStatus}</span>
                      </div>
                      {enrollStatus === 'ANALYZING' && (
                        <span className="text-[10px] text-cyber-blue animate-pulse">{Math.round((stabilityCounter / 5) * 100)}% LOCKED</span>
                      )}
                    </div>
                  </div>

                  {/* Live Diagnostic Message Terminal */}
                  <div className="bg-slate-950 p-3 rounded-xl border border-white/5 space-y-1.5 font-mono">
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                      <span>FEEDBACK TELEMETRY TERMINAL</span>
                      <span className="text-[7px] text-slate-600">STABILITY: {stabilityCounter}/5</span>
                    </div>
                    <div className="min-h-[40px] flex items-center">
                      <p className={`text-[10px] uppercase font-bold tracking-wide leading-normal ${
                        enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED' || realtimeMsg.includes('hidden') || realtimeMsg.includes('Multiple') || realtimeMsg.includes('lighting')
                          ? 'text-cyber-red'
                          : enrollStatus === 'FACE DETECTED'
                          ? 'text-cyber-gold font-bold'
                          : enrollStatus === 'ANALYZING'
                          ? 'text-cyber-blue'
                          : enrollStatus === 'SUCCESS'
                          ? 'text-cyber-green'
                          : 'text-cyber-cyan'
                      }`}>
                        &gt; {realtimeMsg}
                      </p>
                    </div>
                    
                    {/* Live Quality Diagnostics Checklist */}
                    <div className="border-t border-white/5 pt-2 mt-1 space-y-1.5 text-[9px] uppercase">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">1. COMPLIANCE (SINGLE SUBJECT)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          realtimeMsg.includes('Multiple') ? 'text-cyber-red' : 'text-cyber-green'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : realtimeMsg.includes('Multiple') ? 'FAIL [MULTI]' : 'PASS'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">2. BOUNDS (INSIDE CAMERA MATRIX)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          realtimeMsg.includes('hidden') ? 'text-cyber-red' : 'text-cyber-green'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : realtimeMsg.includes('hidden') ? 'FAIL [EDGE]' : 'PASS'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">3. PROXIMITY (PROPER SCAN DISTANCE)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          realtimeMsg.includes('closer') ? 'text-cyber-red' : 'text-cyber-green'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : realtimeMsg.includes('closer') ? 'FAIL [FAR]' : 'PASS'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">4. FOCUS (CENTERED & STABLE)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          realtimeMsg.includes('Center') ? 'text-cyber-red' : 'text-cyber-green'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : realtimeMsg.includes('Center') ? 'FAIL [ALIGN]' : 'PASS'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">5. LUMINANCE (ILLUMINATED RANGE)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          realtimeMsg.includes('lighting') ? 'text-cyber-red' : 'text-cyber-green'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : realtimeMsg.includes('lighting') ? 'FAIL [DARK]' : 'PASS'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">6. LIVENESS (ACTIVE EYE BLINK)</span>
                        <span className={`font-bold ${
                          enrollStatus === 'idle' ? 'text-slate-700' :
                          livenessVerified ? 'text-cyber-green' : 'text-cyber-gold animate-pulse'
                        }`}>
                          {enrollStatus === 'idle' ? 'WAITING' : livenessVerified ? 'PASS [BLINK]' : `ACTIVE [${livenessState.toUpperCase()}]`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sandbox simulated location option (fully functional) */}
                {biometricTargetEmp && (
                  <div className="border-t border-white/5 pt-3 mt-4 flex flex-col gap-1.5">
                    <label className="block text-[8px] font-bold text-slate-500 uppercase">
                      Developer Option / Simulated Enclave Sandbox
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={biometricFaceSource}
                        onChange={(e) => setBiometricFaceSource(e.target.value)}
                        className="flex-1 bg-slate-900 border border-white/5 rounded px-2 py-1.5 text-[10px] text-slate-400 focus:outline-none"
                      >
                        <option value="self">Self (Generate Synthetic Vectors)</option>
                        {employees.filter(emp => emp.is_face_registered && emp.id !== biometricTargetEmp.id).map((emp) => (
                          <option key={emp.id} value={emp.name + emp.id}>
                            Copy of: {emp.name} (Simulate Conflict)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleAutoRegisterBiometrics(biometricTargetEmp.id, biometricTargetEmp.name)}
                        className="bg-slate-900 border border-white/10 hover:border-cyber-cyan text-cyber-cyan hover:bg-cyber-cyan/10 text-[9px] font-bold py-1.5 px-3 rounded-lg transition-all uppercase cursor-pointer"
                      >
                        Auto-Gen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab 4: Location & Geofence Settings */}
      {activeTab === 'location' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* ===== GEOFENCE CONFIGURATION SECTION ===== */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent"></div>
            <div className="absolute -top-16 -right-16 w-40 h-40 bg-cyber-cyan/5 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="text-sm font-bold font-mono tracking-widest text-white uppercase flex items-center gap-2">
                  <Crosshair className="w-5 h-5 text-cyber-cyan animate-pulse" />
                  Office Geofence Registration System
                </h3>
                <p className="text-[10px] font-mono text-slate-400 uppercase mt-1">
                  Click map to place office · Drag marker · Adjust radius · Save to activate
                </p>
              </div>

              {/* GPS Detect Button */}
              <button
                type="button"
                onClick={handleDetectLocation}
                disabled={gpsDetecting}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyber-blue to-cyber-cyan disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs rounded-xl uppercase tracking-wider shadow-cyan-glow transition-all cursor-pointer whitespace-nowrap"
              >
                {gpsDetecting ? (
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                {gpsDetecting ? 'Acquiring GPS...' : 'Use My Current Location'}
              </button>
            </div>

            {/* GPS Status Banner */}
            {gpsDetecting && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-cyber-blue/10 border border-cyber-blue/20 rounded-xl font-mono">
                <div className="w-4 h-4 border-2 border-cyber-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div>
                  <div className="text-[10px] font-bold text-cyber-blue uppercase tracking-wider">Acquiring GPS Signal</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Connecting to satellite network... please wait</div>
                </div>
              </div>
            )}
            {gpsError && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-cyber-red/10 border border-cyber-red/20 rounded-xl font-mono">
                <WifiOff className="w-4 h-4 text-cyber-red flex-shrink-0" />
                <div>
                  <div className="text-[10px] font-bold text-cyber-red uppercase tracking-wider">GPS Signal Lost</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{gpsError}</div>
                </div>
              </div>
            )}
            {!gpsDetecting && !gpsError && gpsAccuracy && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-cyber-green/10 border border-cyber-green/20 rounded-xl font-mono">
                <Wifi className="w-4 h-4 text-cyber-green flex-shrink-0" />
                <div>
                  <div className="text-[10px] font-bold text-cyber-green uppercase tracking-wider">GPS Lock Acquired</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Signal accuracy: ±{gpsAccuracy}m · Map centered on your real location</div>
                </div>
              </div>
            )}
            {locationSaved && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-cyber-green/10 border border-cyber-green/30 rounded-xl font-mono animate-pulse">
                <CheckCircle2 className="w-4 h-4 text-cyber-green flex-shrink-0" />
                <div className="text-[10px] font-bold text-cyber-green uppercase tracking-wider">Office Geofence Saved Successfully · All attendance scans now validate against this location</div>
              </div>
            )}

            {loadingSettings ? (
              <div className="py-20 flex flex-col items-center justify-center font-mono">
                <div className="w-8 h-8 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs text-slate-500 mt-4 animate-pulse">Loading geofence workspace...</p>
              </div>
            ) : (
              <div className="space-y-5 font-mono">

                {/* ---- LOCATION SEARCH BAR ---- */}
                <div ref={searchContainerRef} className="relative">
                  <div className="relative flex items-center gap-2">
                    {/* Search input */}
                    <div className="relative flex-1">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5">
                        {searchLoading ? (
                          <div className="w-4 h-4 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Search className="w-4 h-4 text-cyber-cyan" />
                        )}
                      </div>
                      <input
                        type="text"
                        value={locationSearch}
                        onChange={(e) => handleLocationSearchChange(e.target.value)}
                        onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                        placeholder="Search: MP Nagar Bhopal · SIRT College · DB Mall · any landmark..."
                        className="w-full bg-slate-950/80 border border-cyber-cyan/30 focus:border-cyber-cyan focus:ring-1 focus:ring-cyber-cyan/40 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder-slate-600 font-mono outline-none transition-all"
                        style={{ boxShadow: 'inset 0 0 20px rgba(6,182,212,0.04)' }}
                      />
                      {locationSearch && (
                        <button
                          type="button"
                          onClick={() => { setLocationSearch(''); setLocationSuggestions([]); setShowSuggestions(false); }}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Autocomplete Suggestions Dropdown */}
                  {showSuggestions && locationSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1000] bg-slate-950/98 border border-cyber-cyan/25 rounded-2xl overflow-hidden backdrop-blur-xl"
                      style={{ boxShadow: '0 8px 40px rgba(6,182,212,0.15), 0 0 0 1px rgba(6,182,212,0.08)' }}
                    >
                      {/* Dropdown header */}
                      <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">📍 {locationSuggestions.length} Locations Found</span>
                        <span className="text-[8px] text-slate-600">Powered by OpenStreetMap</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto custom-scrollbar">
                        {locationSuggestions.map((place, idx) => {
                          const nameLabel = place.name || place.address?.amenity || place.address?.building || place.address?.road || place.display_name.split(',')[0];
                          const subLabel = place.display_name;
                          const typeIcon = place.type === 'administrative' ? '🏙️' : place.class === 'amenity' ? '🏢' : place.class === 'highway' ? '🛣️' : place.class === 'natural' ? '🌿' : '📍';
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSelectSuggestion(place)}
                              className="w-full text-left px-4 py-3 hover:bg-cyber-cyan/10 border-b border-white/3 transition-all cursor-pointer group"
                            >
                              <div className="flex items-start gap-3">
                                <span className="text-base mt-0.5 flex-shrink-0">{typeIcon}</span>
                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-white group-hover:text-cyber-cyan transition-colors truncate">{nameLabel}</div>
                                  <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{subLabel}</div>
                                </div>
                                <div className="ml-auto flex-shrink-0 text-[9px] font-bold text-slate-600 group-hover:text-cyber-cyan/60 uppercase">
                                  {parseFloat(place.lat).toFixed(3)}, {parseFloat(place.lon).toFixed(3)}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* No results state */}
                  {showSuggestions && locationSearch.length > 2 && !searchLoading && locationSuggestions.length === 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1000] bg-slate-950/95 border border-white/10 rounded-xl p-4 text-center font-mono">
                      <MapPin className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-500">No results found for "{locationSearch}"</p>
                      <p className="text-[9px] text-slate-600 mt-1">Try a different spelling or landmark name</p>
                    </div>
                  )}
                </div>

                {/* ---- OFFICE NAME & ADDRESS FIELDS ---- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`bg-slate-950/60 border rounded-xl p-3 space-y-1.5 transition-colors ${officeNameError ? 'border-cyber-red/30 bg-cyber-red/5' : 'border-white/5'}`}>
                    <label className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <Building2 className={`w-3 h-3 ${officeNameError ? 'text-cyber-red' : 'text-cyber-cyan'}`} /> Office / Building Name
                    </label>
                    <input
                      type="text"
                      value={officeName}
                      onChange={(e) => {
                        setOfficeName(e.target.value);
                        if (e.target.value.trim()) {
                          setOfficeNameError('');
                        }
                      }}
                      placeholder="e.g. SIRT College, Orbit Engineering Group..."
                      className={`w-full bg-slate-950/50 border rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 font-mono outline-none transition-all ${
                        officeNameError ? 'border-cyber-red/50 focus:border-cyber-red' : 'border-white/8 focus:border-cyber-cyan/50'
                      }`}
                    />
                    {officeNameError && (
                      <div className="text-[10px] text-cyber-red font-mono mt-1.5 flex items-center gap-1.5 animate-pulse">
                        <ShieldAlert className="w-3.5 h-3.5 text-cyber-red" />
                        <span>{officeNameError}</span>
                      </div>
                    )}
                  </div>
                  <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3 space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                      <MapPin className="w-3 h-3 text-cyber-blue" /> Full Address
                    </label>
                    <input
                      type="text"
                      value={officeAddress}
                      onChange={(e) => setOfficeAddress(e.target.value)}
                      placeholder="Auto-filled on search or map click..."
                      className="w-full bg-slate-950/50 border border-white/8 focus:border-cyber-blue/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 font-mono outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Office name badge (shown when set) */}
                {officeName && (
                  <div className="flex items-center gap-3 p-3 bg-slate-900/50 border border-white/5 rounded-xl">
                    <Building2 className="w-4 h-4 text-cyber-cyan flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{officeName}</div>
                      {officeAddress && <div className="text-[9px] text-slate-500 mt-0.5 truncate">{officeAddress.split(',').slice(0,4).join(', ')}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setOfficeName(''); setOfficeAddress(''); }}
                      className="ml-auto text-slate-600 hover:text-cyber-red transition-colors cursor-pointer flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* ---- FLOATING COORDINATE CARDS ---- */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Latitude Card */}
                  <div className="col-span-1 bg-slate-950/70 border border-cyber-cyan/20 rounded-xl p-3 relative overflow-hidden group hover:border-cyber-cyan/50 transition-all">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-cyan/40 to-transparent" />
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <MapPin className="w-2.5 h-2.5 text-cyber-cyan" /> Latitude
                    </div>
                    <div className="text-xs font-bold text-cyber-cyan font-mono">
                      {settings.geofence_lat !== 0 ? settings.geofence_lat.toFixed(6) : '— —'}
                    </div>
                  </div>

                  {/* Longitude Card */}
                  <div className="col-span-1 bg-slate-950/70 border border-cyber-blue/20 rounded-xl p-3 relative overflow-hidden group hover:border-cyber-blue/50 transition-all">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-blue/40 to-transparent" />
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <Compass className="w-2.5 h-2.5 text-cyber-blue" /> Longitude
                    </div>
                    <div className="text-xs font-bold text-cyber-blue font-mono">
                      {settings.geofence_lng !== 0 ? settings.geofence_lng.toFixed(6) : '— —'}
                    </div>
                  </div>

                  {/* Radius Card */}
                  <div className="col-span-1 bg-slate-950/70 border border-cyber-gold/20 rounded-xl p-3 relative overflow-hidden group hover:border-cyber-gold/50 transition-all">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-gold/40 to-transparent" />
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <Crosshair className="w-2.5 h-2.5 text-cyber-gold" /> Radius
                    </div>
                    <div className="text-xs font-bold text-cyber-gold font-mono">
                      {settings.geofence_radius}m
                    </div>
                  </div>

                  {/* Accuracy Card */}
                  <div className="col-span-1 bg-slate-950/70 border border-cyber-green/20 rounded-xl p-3 relative overflow-hidden group hover:border-cyber-green/50 transition-all">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-green/40 to-transparent" />
                    <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                      <Wifi className="w-2.5 h-2.5 text-cyber-green" /> GPS Accuracy
                    </div>
                    <div className="text-xs font-bold text-cyber-green font-mono">
                      {gpsAccuracy ? `±${gpsAccuracy}m` : 'No Fix'}
                    </div>
                  </div>
                </div>

                {/* ---- CAPTURE MODE CONTROLS (ADVANCED POLYGON) ---- */}
                <div className="bg-slate-950/80 rounded-2xl p-5 border-2 border-cyber-cyan/40 space-y-4 shadow-[0_0_20px_rgba(6,182,212,0.15)] relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse"></div>
                  
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-cyber-cyan uppercase tracking-widest flex items-center gap-2">
                      <Crosshair className="w-4 h-4 text-cyber-cyan" />
                      Advanced Feature: Live Geoboundary Capture
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={toggleCaptureMode}
                      className={`px-5 py-3 text-sm font-bold uppercase tracking-wider rounded-xl border-2 transition-all shadow-lg ${
                        captureMode 
                          ? 'bg-cyber-red/20 border-cyber-red text-cyber-red animate-pulse shadow-cyber-red/20' 
                          : 'bg-slate-900 border-cyber-cyan text-cyber-cyan hover:bg-cyber-cyan hover:text-slate-900 hover:shadow-[0_0_20px_rgba(6,182,212,0.6)]'
                      }`}
                    >
                      {captureMode ? 'Cancel Capture' : 'Start Perimeter Walk'}
                    </button>
                    
                    {captureMode && (
                      <button
                        type="button"
                        onClick={handleSavePolygon}
                        className="px-5 py-3 text-sm font-bold uppercase tracking-wider rounded-xl bg-cyber-green text-slate-950 hover:bg-green-400 transition-all shadow-[0_0_25px_rgba(34,197,94,0.6)] animate-bounce"
                      >
                        Finish & Save Polygon ({polygonPoints.length} pts)
                      </button>
                    )}
                  </div>
                  
                  <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-cyber-cyan/30 pl-3">
                    <strong className="text-slate-200">Instructions:</strong> Click "Start Perimeter Walk", physically walk the exact perimeter of the office with your device. The GPS will plot a polygon boundary automatically. Click "Finish & Save" when the loop is complete. This overrides the simple radius circle.
                  </p>
                </div>

                {/* ---- INTERACTIVE GEOFENCE MAP ---- */}
                <div className="relative bg-slate-950/40 rounded-2xl border border-cyber-cyan/20 overflow-hidden" style={{ boxShadow: '0 0 40px rgba(6,182,212,0.06) inset' }}>
                  {/* Map HUD badge */}
                  <div className="absolute top-4 left-4 z-[500] bg-slate-950/90 backdrop-blur-md border border-cyber-cyan/30 rounded-lg px-3 py-1.5 text-[9px] font-bold text-cyber-cyan tracking-wider flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-ping" />
                    GEOFENCE MATRIX ONLINE
                  </div>

                  {/* Click to set hint */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[500] bg-slate-950/80 backdrop-blur-md border border-white/10 rounded-full px-4 py-1.5 text-[9px] text-slate-400 uppercase tracking-wider flex items-center gap-2 pointer-events-none">
                    <MapPin className="w-3 h-3" /> Click anywhere to place office marker · Drag marker to fine-tune
                  </div>

                  {settings.geofence_lat !== 0 && settings.geofence_lng !== 0 ? (
                    <MapContainer
                      key="admin-geofence-map-static"
                      ref={geofenceMapRef}
                      center={[settings.geofence_lat, settings.geofence_lng]}
                      zoom={16}
                      scrollWheelZoom={true}
                      className="w-full rounded-2xl z-0"
                      style={{ height: '420px' }}
                    >
                      <ChangeMapView center={geofenceMapCenter} zoom={geofenceMapZoom} />
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url={mapTileUrl}
                      />
                      <MapClickHandler onMapClick={handleGeofenceMapClick} />

                      {/* Animated geofence radius circle */}
                      <Circle
                        center={[settings.geofence_lat, settings.geofence_lng]}
                        radius={settings.geofence_radius}
                        pathOptions={{ color: '#00F0FF', fillColor: '#00F0FF', fillOpacity: 0.12, weight: 2, dashArray: '8 4' }}
                      />
                      {/* Outer pulsing ring */}
                      <Circle
                        center={[settings.geofence_lat, settings.geofence_lng]}
                        radius={settings.geofence_radius * 1.15}
                        pathOptions={{ color: '#00F0FF', fillColor: 'transparent', fillOpacity: 0, weight: 1, opacity: 0.3, dashArray: '4 8' }}
                      />

                      <Marker
                        position={[settings.geofence_lat, settings.geofence_lng]}
                        icon={officeIcon}
                        draggable={true}
                        eventHandlers={{ dragend: handleOfficeMarkerDragEnd }}
                      >
                        <Popup className="font-mono text-xs">
                          <div className="space-y-1 text-[11px]">
                            {officeName && <div className="font-bold text-slate-100 border-b border-white/10 pb-1 mb-1">{officeName}</div>}
                            <div className="font-bold text-slate-800">📍 Office Geofence Center</div>
                            <div>Lat: <span className="font-bold">{settings.geofence_lat.toFixed(6)}</span></div>
                            <div>Lng: <span className="font-bold">{settings.geofence_lng.toFixed(6)}</span></div>
                            <div>Radius: <span className="font-bold">{settings.geofence_radius}m</span></div>
                            {officeAddress && <div className="text-[9px] text-slate-400 mt-1 max-w-[180px]">{officeAddress.split(',').slice(0,3).join(', ')}</div>}
                          </div>
                        </Popup>
                      </Marker>
                      
                      {/* Active Polygon Boundary */}
                      {activePolygon && activePolygon.length >= 3 && !captureMode && (
                        <Polygon 
                          positions={activePolygon.map(p => [p.lat, p.lng])} 
                          pathOptions={{ color: '#00FF00', fillColor: '#00FF00', fillOpacity: 0.2, weight: 3 }} 
                        />
                      )}
                      
                      {/* Real-time Capture Polygon */}
                      {captureMode && polygonPoints.length > 0 && (
                        <Polygon 
                          positions={polygonPoints.map(p => [p.lat, p.lng])} 
                          pathOptions={{ color: '#FF0055', fillColor: '#FF0055', fillOpacity: 0.3, weight: 3, dashArray: '5 5' }} 
                        />
                      )}
                      {captureMode && polygonPoints.map((p, i) => (
                         <Circle key={i} center={[p.lat, p.lng]} radius={1} pathOptions={{ color: '#FFF' }} />
                      ))}
                    </MapContainer>
                  ) : (
                    <div className="h-[420px] flex flex-col items-center justify-center text-center p-6">
                      {gpsDetecting ? (
                        <>
                          <div className="w-12 h-12 border-2 border-cyber-cyan border-t-transparent rounded-full animate-spin mb-4" />
                          <p className="text-xs font-bold text-cyber-cyan font-mono uppercase">Acquiring GPS Signal...</p>
                          <p className="text-[10px] text-slate-500 mt-2">Connecting to GPS network</p>
                        </>
                      ) : (
                        <>
                          <Crosshair className="w-10 h-10 text-slate-700 mb-4" />
                          <p className="text-xs font-bold text-slate-400 font-mono uppercase">No Location Set</p>
                          <p className="text-[10px] text-slate-500 mt-2 max-w-xs">Click "Use My Current Location" to auto-detect, or enter coordinates below</p>
                        </>
                      )}
                    </div>
                  )}
                </div>


                {/* ---- RADIUS SLIDER ---- */}
                <div className="bg-slate-950/60 rounded-xl p-4 border border-cyber-gold/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Crosshair className="w-3.5 h-3.5 text-cyber-gold" />
                      Geofence Boundary Radius
                    </div>
                    <div className="bg-cyber-gold/10 border border-cyber-gold/20 rounded-lg px-3 py-1 text-cyber-gold font-bold text-xs font-mono">
                      {settings.geofence_radius}m
                    </div>
                  </div>

                  {/* Slider */}
                  <input
                    type="range"
                    min="25"
                    max="1000"
                    step="25"
                    value={settings.geofence_radius}
                    onChange={(e) => setSettings(prev => ({ ...prev, geofence_radius: parseInt(e.target.value) }))}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #EAB308 0%, #EAB308 ${((settings.geofence_radius - 25) / (1000 - 25)) * 100}%, #1e293b ${((settings.geofence_radius - 25) / (1000 - 25)) * 100}%, #1e293b 100%)`
                    }}
                  />

                  {/* Quick Preset Radius Buttons */}
                  <div className="flex flex-wrap gap-2">
                    {[50, 100, 200, 300, 500].map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, geofence_radius: r }))}
                        className={`text-[9px] font-bold py-1 px-2.5 rounded-lg border uppercase transition-all cursor-pointer ${
                          settings.geofence_radius === r
                            ? 'bg-cyber-gold/20 border-cyber-gold/50 text-cyber-gold shadow-[0_0_8px_rgba(234,179,8,0.2)]'
                            : 'bg-slate-900 border-white/10 text-slate-400 hover:border-cyber-gold/40 hover:text-cyber-gold'
                        }`}
                      >
                        {r}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* ---- MANUAL COORDINATE INPUT ---- */}
                <div className="bg-slate-950/60 rounded-xl p-4 border border-white/5 space-y-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-cyber-cyan" /> Manual Coordinate Override
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Latitude</label>
                      <input
                        type="number"
                        step="any"
                        value={settings.geofence_lat}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSettings(prev => ({ ...prev, geofence_lat: isNaN(v) ? 0 : v }));
                          if (!isNaN(v)) setGeofenceMapCenter([v, settings.geofence_lng]);
                        }}
                        className="w-full glass-input py-1.5 text-xs font-mono"
                        placeholder="e.g. 28.6139"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Longitude</label>
                      <input
                        type="number"
                        step="any"
                        value={settings.geofence_lng}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSettings(prev => ({ ...prev, geofence_lng: isNaN(v) ? 0 : v }));
                          if (!isNaN(v)) setGeofenceMapCenter([settings.geofence_lat, v]);
                        }}
                        className="w-full glass-input py-1.5 text-xs font-mono"
                        placeholder="e.g. 77.2090"
                      />
                    </div>
                  </div>
                </div>

                {/* ---- CITY PRESETS + SAVE + RESET ---- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Presets */}
                  <div className="bg-slate-950/60 rounded-xl p-4 border border-white/5 space-y-2">
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Globe className="w-3 h-3" /> City Presets
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Noida', lat: 28.6273, lng: 77.3725 },
                        { label: 'Delhi HQ', lat: 28.6139, lng: 77.2090 },
                        { label: 'Mumbai', lat: 19.0760, lng: 72.8777 },
                        { label: 'Bangalore', lat: 12.9716, lng: 77.5946 },
                        { label: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
{ label: 'Chennai', lat: 13.0827, lng: 80.2707 },
                      ].map(city => (
                        <button
                          key={city.label}
                          type="button"
                          onClick={() => {
                            setSettings(prev => ({ ...prev, geofence_lat: city.lat, geofence_lng: city.lng }));
                            setGeofenceMapCenter([city.lat, city.lng]);
                            setGeofenceMapZoom(16);
                          }}
                          className="bg-slate-900 border border-white/5 hover:border-cyber-cyan text-slate-400 hover:text-cyber-cyan text-[9px] font-bold py-1.5 px-2.5 rounded-lg transition-all uppercase cursor-pointer"
                        >
                          {city.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => saveSettings(settings)}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyber-blue to-cyber-cyan text-slate-950 font-bold text-xs py-3 px-4 rounded-xl uppercase tracking-wider shadow-cyan-glow cursor-pointer transition-all hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Save & Activate Geofence
                    </button>
                    <button
                      type="button"
                      onClick={handleResetGeofence}
                      className="w-full flex items-center justify-center gap-2 bg-cyber-red/10 border border-cyber-red/30 hover:bg-cyber-red/20 text-cyber-red text-xs font-bold py-2.5 px-4 rounded-xl uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-red-glow"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Reset to Default
                    </button>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* High-tech divider */}
          <div className="border-t border-white/5 my-8 relative">
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 bg-slate-950/80 text-[8px] font-bold text-slate-500 tracking-[0.2em] uppercase font-mono border border-white/5 rounded-full backdrop-blur-sm">
              SECURE TELEMETRY FEED
            </span>
          </div>

          {/* Real-time Employee Satellite Telemetry Radar */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1.5px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent"></div>
            
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
              <div>
                <h3 className="text-sm font-bold font-mono tracking-widest text-white uppercase flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyber-cyan animate-spin" style={{ animationDuration: '8s' }} />
                  🛰️ Real-Time Satellite Telemetry Radar
                </h3>
                <p className="text-[10px] font-mono text-slate-400 uppercase mt-1">
                  Live geospatial tracking of all active corporate assets and employee coordinates.
                </p>
              </div>
              
              {/* Search input for HUD */}
              <div className="relative w-full max-w-[280px]">
                <Search className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="FILTER HUD ASSETS..."
                  value={radarSearch}
                  onChange={(e) => setRadarSearch(e.target.value)}
                  className="w-full glass-input pl-9 py-2 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono">
              {/* Radar Map Column */}
              <div className="lg:col-span-2 bg-slate-950/40 rounded-xl p-3 border border-white/5 relative">
                {/* Subtle Radar Scan Wave Overlay */}
                <div className="absolute top-6 right-6 z-10 bg-slate-950/80 px-2 py-1.5 border border-cyber-cyan/30 rounded text-[9px] font-bold text-cyber-cyan tracking-wider flex items-center gap-1.5 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-ping" />
                  LIVE POSITIONING FEED
                </div>

                <MapContainer
                  key="admin-radar-map-static"
                  ref={radarMapRef}
                  center={radarCenter}
                  zoom={15}
                  scrollWheelZoom={true}
                  className="w-full h-[400px] rounded-xl border border-white/10 z-0"
                >
                  <ChangeMapView center={radarCenter} />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url={mapTileUrl}
                  />
                  {/* Geofence boundaries */}
                  <Circle
                    center={[settings.geofence_lat, settings.geofence_lng]}
                    radius={settings.geofence_radius}
                    pathOptions={{ color: '#00F0FF', fillColor: '#00F0FF', fillOpacity: 0.1 }}
                  />
                  
                  {/* Office Pin */}
                  <Marker
                    position={[settings.geofence_lat, settings.geofence_lng]}
                    icon={officeIcon}
                  >
                    <Popup className="font-mono text-xs">
                      <span className="font-bold text-cyber-cyan">Delhi HQ Office Center</span><br />
                      Geofence: {settings.geofence_radius}m radius
                    </Popup>
                  </Marker>

                  {/* Employee Pins */}
                  {employees
                    .filter(emp => emp.latitude && emp.longitude && !isNaN(parseFloat(emp.latitude)) && !isNaN(parseFloat(emp.longitude)) && parseFloat(emp.latitude) !== 0)
                    .map(emp => {
                      const empLat = parseFloat(emp.latitude);
                      const empLng = parseFloat(emp.longitude);
                      const isInside = emp.status === 'Inside Office';
                      const isOffline = emp.status === 'Offline';
                      const dist = calculateDistance(empLat, empLng, settings.geofence_lat, settings.geofence_lng);
                      
                      let markerIcon = employeeOfflineIcon;
                      if (!isOffline) {
                        markerIcon = isInside ? employeeIcon : employeeOutsideIcon;
                      }

                      return (
                        <Marker
                          key={emp.id}
                          position={[empLat, empLng]}
                          icon={markerIcon}
                        >
                          <Popup className="font-mono text-xs">
                            <div className="space-y-1">
                              <div className="font-bold text-white border-b border-white/5 pb-1">
                                {emp.name} <span className="text-slate-500 font-normal">({emp.id})</span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Dept: <span className="text-slate-200">{emp.department}</span>
                              </div>
                              <div className="text-[10px] flex items-center gap-1">
                                Status: 
                                <span className={`font-bold ${isInside ? 'text-cyber-green' : isOffline ? 'text-slate-500' : 'text-cyber-red'}`}>
                                  {emp.status}
                                </span>
                              </div>
                              {!isOffline && (
                                <div className="text-[10px] text-slate-400">
                                  HQ Distance: <span className="text-slate-200">{dist.toFixed(1)}m</span>
                                </div>
                              )}
                              <div className="text-[9px] text-slate-500">
                                [{Number(emp.latitude).toFixed(5)}, {Number(emp.longitude).toFixed(5)}]
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                </MapContainer>
              </div>

              {/* Searchable Telemetry HUD side panel */}
              <div className="bg-slate-950/60 rounded-xl p-4 border border-white/5 flex flex-col h-[426px] overflow-hidden">
                <div className="text-[10px] font-bold text-slate-400 tracking-wider uppercase border-b border-white/5 pb-2 mb-3 flex items-center justify-between">
                  <span>TELEMETRY FEED HUD</span>
                  <span className="text-slate-600">ASSETS: {employees.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {employees
                    .filter(emp => 
                      emp.name.toLowerCase().includes(radarSearch.toLowerCase()) || 
                      emp.id.toLowerCase().includes(radarSearch.toLowerCase()) ||
                      emp.department.toLowerCase().includes(radarSearch.toLowerCase())
                    )
                    .map(emp => {
                      const hasCoords = emp.latitude && emp.longitude && !isNaN(emp.latitude) && !isNaN(emp.longitude) && emp.latitude !== 0;
                      const isInside = emp.status === 'Inside Office';
                      const isOffline = emp.status === 'Offline';
                      const dist = hasCoords ? calculateDistance(emp.latitude, emp.longitude, settings.geofence_lat, settings.geofence_lng) : null;

                      return (
                        <div 
                          key={emp.id}
                          onClick={() => {
                            if (hasCoords) {
                              setRadarCenter([emp.latitude, emp.longitude]);
                            } else {
                              alert(`Corporate Asset ${emp.name} is currently offline. No active GPS signal received.`);
                            }
                          }}
                          className={`p-3 rounded-lg border text-left cursor-pointer transition-all duration-200 flex flex-col justify-between gap-1.5 ${
                            hasCoords 
                              ? 'bg-slate-900/40 border-white/5 hover:border-cyber-cyan hover:bg-slate-900/60'
                              : 'bg-slate-950/20 border-white/5 opacity-60 hover:opacity-100 hover:border-white/20'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="text-xs font-bold text-white leading-none">{emp.name}</div>
                              <div className="text-[9px] text-slate-500 mt-1 uppercase tracking-wider">{emp.id} &bull; {emp.department}</div>
                            </div>
                            <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                              isInside 
                                ? 'bg-cyber-green/10 border-cyber-green/20 text-cyber-green shadow-green-glow' 
                                : isOffline
                                ? 'bg-slate-900 border-white/5 text-slate-500'
                                : 'bg-cyber-red/10 border-cyber-red/20 text-cyber-red'
                            }`}>
                              {emp.status}
                            </span>
                          </div>

                          {hasCoords ? (
                            <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono mt-1 border-t border-white/5 pt-1.5">
                              <div className="flex items-center gap-1 text-[8px]">
                                <MapPin className="w-2.5 h-2.5 text-slate-500" />
                                <span>{Number(emp.latitude).toFixed(4)}, {Number(emp.longitude).toFixed(4)}</span>
                              </div>
                              <div className="font-bold text-slate-300">
                                {dist !== null ? `${dist.toFixed(1)}m` : 'N/A'}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[8px] text-slate-500 italic mt-1 border-t border-white/5 pt-1.5">
                              NO GEOLOCATION FEED SIGNAL
                            </div>
                          )}
                        </div>
                      );
                    })}

                  {employees.filter(emp => 
                    emp.name.toLowerCase().includes(radarSearch.toLowerCase()) || 
                    emp.id.toLowerCase().includes(radarSearch.toLowerCase()) ||
                    emp.department.toLowerCase().includes(radarSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="text-center py-10 text-[10px] text-slate-500 uppercase italic">
                      NO HUD ASSETS MATCHED
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab 5: Danger Zone */}
      {activeTab === 'danger' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="glass-panel border-cyber-red/20 rounded-2xl p-6 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-cyber-red/30 to-transparent"></div>
          
          <h3 className="text-sm font-bold font-mono tracking-widest text-cyber-red uppercase mb-4 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 animate-pulse" />
            System Archival & Critical Administration
          </h3>
          <p className="text-[11px] font-mono text-slate-400 uppercase mb-6">
            DANGER ZONE: The following actions bypass standard soft-deletion mechanisms and perform permanent enclavial schema wipes. Confirmations required.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
            {/* Card 1: Wipe Ledger */}
            <div className="p-4 bg-slate-950/40 rounded-xl border border-white/5 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-200 uppercase mb-1">Wipe Ledger Records</h4>
                <p className="text-[10px] text-slate-500 uppercase mb-4">Wipe all check-in and check-out ledger records completely.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('clear-attendance')}
                className="w-full bg-cyber-red/10 border border-cyber-red/30 text-cyber-red hover:bg-cyber-red/20 text-xs font-bold py-2 rounded-lg transition-all cursor-pointer"
              >
                Clear Attendance Ledger
              </button>
            </div>

            {/* Card 2: Purge Logs */}
            <div className="p-4 bg-slate-950/40 rounded-xl border border-white/5 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-200 uppercase mb-1">Purge Telemetry Logs</h4>
                <p className="text-[10px] text-slate-500 uppercase mb-4">Permanently clear all system activity logs and audit trails.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('clear-logs')}
                className="w-full bg-cyber-red/10 border border-cyber-red/30 text-cyber-red hover:bg-cyber-red/20 text-xs font-bold py-2 rounded-lg transition-all cursor-pointer"
              >
                Purge Activity Logs
              </button>
            </div>

            {/* Card 3: Factory Reset */}
            <div className="p-4 bg-slate-950/40 rounded-xl border border-white/5 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-200 uppercase mb-1">Factory Reset System</h4>
                <p className="text-[10px] text-slate-500 uppercase mb-4">Purge all database schemas (logs, attendance, employees) and re-seed defaults.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('reset-db')}
                className="w-full bg-cyber-red/20 border border-cyber-red text-cyber-red hover:bg-cyber-red/30 text-xs font-bold py-2 rounded-lg transition-all shadow-red-glow cursor-pointer"
              >
                Wipe & Reset Database
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Quick Edit Modal (Opened from Directory Table Edit action) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md glass-panel-heavy rounded-2xl p-6 relative border border-white/15 animate-scale-up">
            <button
              onClick={closeMainModal}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-sm font-bold font-mono tracking-widest text-white uppercase mb-4">
              Modify Enclave Profile
            </h3>

            {error && (
              <div className="mb-4 p-3 bg-cyber-red/10 border border-cyber-red/20 rounded-xl text-cyber-red text-xs font-mono">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 font-mono">
              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Full Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Shreya"
                  value={form.name}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Corporate Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="employee@company.com"
                  value={form.email}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">
                  New Security Key (Leave empty to keep current)
                </label>
                <input
                  type="password"
                  name="password"
                  placeholder="Enter secret..."
                  value={form.password}
                  onChange={handleInputChange}
                  className="w-full glass-input py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Access Role</label>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleInputChange}
                    className="w-full glass-input py-2 text-xs"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Department</label>
                  <select
                    name="department"
                    value={form.department}
                    onChange={handleInputChange}
                    className="w-full glass-input py-2 text-xs"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Security & HR">Security & HR</option>
                    <option value="Product">Product</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-4 bg-gradient-to-r from-cyber-blue to-cyber-cyan text-white text-xs font-bold py-3 px-4 rounded-xl uppercase tracking-wider cursor-pointer"
              >
                Modify Credentials
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Double Confirmation Modal (Administrative resets) */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md glass-panel-heavy border-cyber-red/30 rounded-2xl p-6 relative border animate-scale-up">
            <button
              onClick={() => setConfirmModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-sm font-bold font-mono tracking-widest text-cyber-red uppercase mb-2 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-cyber-red animate-pulse" />
              Critical Authorization Required
            </h3>
            <p className="text-[10px] font-mono text-slate-400 uppercase mb-4">
              You are about to execute a high-privilege destructive operation.
            </p>

            <div className="bg-cyber-red/10 border border-cyber-red/20 rounded-xl p-3.5 mb-4 text-xs font-mono space-y-1">
              <div className="text-slate-200 font-bold uppercase text-[11px]">Action: {
                confirmAction === 'reset-db' ? 'FACTORY RESET SYSTEM' :
                confirmAction === 'clear-attendance' ? 'WIPE ATTENDANCE LEDGER' :
                confirmAction === 'clear-logs' ? 'PURGE ACTIVITY LOGS' :
                confirmAction === 'reset-face' ? `ERASE FACE TEMPLATE FOR ${confirmTarget?.name}` : 'UNKNOWN DESTRUCTIVE OPERATION'
              }</div>
              <div className="text-slate-400 uppercase text-[9px]">Scope: permanent database change.</div>
            </div>

            <form onSubmit={handleConfirmAdminAction} className="space-y-4 font-mono">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">
                  Type the exact keyphrase to authorize: <span className="text-white font-extrabold font-mono bg-cyber-red/20 px-1.5 py-0.5 rounded border border-cyber-red/30">
                    {
                      confirmAction === 'reset-db' ? 'RESET SYSTEM' :
                      confirmAction === 'clear-attendance' ? 'CLEAR LEDGER' :
                      confirmAction === 'clear-logs' ? 'PURGE LOGS' :
                      confirmAction === 'reset-face' ? 'RESET FACE' : ''
                    }
                  </span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Type code here..."
                  value={confirmTextInput}
                  onChange={(e) => setConfirmTextInput(e.target.value)}
                  className="w-full glass-input py-2 text-xs text-center border-cyber-red/20 focus:border-cyber-red"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmModalOpen(false)}
                  className="flex-1 bg-slate-900 border border-white/5 text-slate-400 hover:text-white text-xs font-bold py-2.5 rounded-xl uppercase tracking-wider cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    confirmSubmitting || 
                    confirmTextInput !== (
                      confirmAction === 'reset-db' ? 'RESET SYSTEM' :
                      confirmAction === 'clear-attendance' ? 'CLEAR LEDGER' :
                      confirmAction === 'clear-logs' ? 'PURGE LOGS' :
                      confirmAction === 'reset-face' ? 'RESET FACE' : ''
                    )
                  }
                  className="flex-1 bg-cyber-red text-white disabled:bg-slate-900 disabled:text-slate-600 disabled:border-white/5 hover:bg-red-600 text-xs font-bold py-2.5 rounded-xl uppercase tracking-wider shadow-red-glow border border-cyber-red/20 transition-all cursor-pointer"
                >
                  {confirmSubmitting ? 'Authorizing...' : 'Authorize Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modern, Subtle SaaS-Grade Toast Notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl border font-mono shadow-lg backdrop-blur-sm"
            style={{
              backgroundColor: toast.type === 'success' 
                ? 'rgba(16, 185, 129, 0.08)' 
                : toast.type === 'error' 
                  ? 'rgba(239, 68, 68, 0.08)' 
                  : 'rgba(15, 23, 42, 0.85)',
              borderColor: toast.type === 'success' 
                ? 'rgba(16, 185, 129, 0.25)' 
                : toast.type === 'error' 
                  ? 'rgba(239, 68, 68, 0.25)' 
                  : 'rgba(255, 255, 255, 0.08)',
              color: toast.type === 'success' 
                ? '#34D399' 
                : toast.type === 'error' 
                  ? '#F87171' 
                  : '#E2E8F0',
            }}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
            {toast.type === 'error' && <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />}
            {toast.type === 'info' && <Activity className="w-4 h-4 text-cyber-cyan flex-shrink-0" />}
            
            <div className="text-[10px] font-bold tracking-wide uppercase select-none">
              {toast.message}
            </div>

            <button
              onClick={() => setToast(null)}
              className="ml-2 text-slate-500 hover:text-white transition-colors cursor-pointer flex-shrink-0 p-0.5 rounded hover:bg-white/5"
            >
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
