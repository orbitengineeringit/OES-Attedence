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
  AlertTriangle,
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
  validateFullFaceEnrollment,
  faceapi
} from '../services/faceApiService.js';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap, useMapEvents, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { playBiometricSound } from '../services/soundService.js';
import { UserAvatar, LiveIndicator, StatusBadge, EmptyState, SkeletonTable } from '../components/common/CommonUI.jsx';

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
  const mapTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

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

  // Diagnostic Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [auditStartDate, setAuditStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7); // Default to last 7 days
    return d.toISOString().split('T')[0];
  });
  const [auditEndDate, setAuditEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [auditSearchQuery, setAuditSearchQuery] = useState('');

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
  const [enrollError, setEnrollError] = useState('');
  const [enrollSuccess, setEnrollSuccess] = useState('');
  const [wizardTargetId, setWizardTargetId] = useState('');

  // Modal Camera Capture State (used in edit flow)
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

  // Multi-Site & Enterprise Office Geofence State
  const [allSites, setAllSites] = useState([]);
  const [newSiteModalOpen, setNewSiteModalOpen] = useState(false);
  const [newSiteData, setNewSiteData] = useState({
    name: '',
    type: 'Project Site',
    lat: 28.6139,
    lng: 77.2090,
    radius: 150,
    address: ''
  });
  const [savingSite, setSavingSite] = useState(false);

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

  const closeMainModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setFaceCaptured(false);
  };
  const startAutoCaptureLoop = () => {
    wizardLoopActive.current = true;
    const canvas = biometricCanvasRef.current;
    const video = biometricVideoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    let localStability = 0;
    let accumulatedDescriptors = [];
    let frameCount = 0;
    let fps = 60;
    let lastTime = performance.now();

    // Use TinyFaceDetector with inputSize 224 and scoreThreshold 0.35 for smooth landmark alignment without frame dropping
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 });

    // Blink-Liveness tracking state variables in closure
    let blinkStateVal = 'waitingForOpen'; // 'waitingForOpen' | 'waitingForClose' | 'waitingForReopen' | 'blinkDetected'
    let livenessVerifiedVal = false;

    // Cache last state values to prevent unnecessary React re-renders (this fixes lag entirely!)
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

    const drawHolographicOverlay = (ctx, detection, videoWidth, videoHeight, isFullFace, mode, statusText) => {
      const box = detection.detection.box;
      const positions = detection.landmarks.positions;

      // Isolated context configuration
      ctx.save();

      // Determine glow colors based on full-face validation and lock status
      let glowColor = '#06B6D4'; // default accent color (cyan)
      let glowBg = 'rgba(6, 182, 212, 0.4)';
      let meshColor = 'rgba(6, 182, 212, 0.18)';
      
      if (!isFullFace) {
        glowColor = '#F59E0B'; // amber / adjustment required
        glowBg = 'rgba(245, 158, 11, 0.45)';
        meshColor = 'rgba(245, 158, 11, 0.25)';
      } else if (mode === 'locked') {
        glowColor = '#22C55E'; // green / secured
        glowBg = 'rgba(34, 197, 94, 0.45)';
        meshColor = 'rgba(34, 197, 94, 0.3)';
      } else if (mode === 'locking') {
        glowColor = '#38BDF8'; // vibrant sky blue
        glowBg = 'rgba(56, 189, 248, 0.45)';
        meshColor = 'rgba(56, 189, 248, 0.25)';
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

      ctx.strokeStyle = mode === 'locked' ? 'rgba(34, 197, 94, 0.35)' : !isFullFace ? 'rgba(245, 158, 11, 0.35)' : 'rgba(6, 182, 212, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 15]);
      ctx.beginPath();
      ctx.arc(boxCenterX, boxCenterY, radius, angle, angle + Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = mode === 'locked' ? 'rgba(34, 197, 94, 0.45)' : !isFullFace ? 'rgba(245, 158, 11, 0.45)' : 'rgba(6, 182, 212, 0.4)';
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
        if (!indices || indices.length === 0) return;
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
          // Detect face features and extract face descriptor
          const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true).withFaceDescriptors();

          if (detections.length === 0) {
            updateStatus('SCANNING');
            updateMsg('Align your full face inside the scanner frame');
            localStability = 0;
            accumulatedDescriptors = [];
            updateStability(0);

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
            ctx.moveTo(cx - 100, cy); ctx.lineTo(cx - 30, cy);
            ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 100, cy);
            ctx.moveTo(cx, cy - 100); ctx.lineTo(cx - 30);
            ctx.moveTo(cx, cy + 30); ctx.lineTo(cx, cy + 100);
            ctx.stroke();

            // Central Reticle Bracket
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy - 10); ctx.lineTo(cx - 20, cy - 20); ctx.lineTo(cx - 10, cy - 20);
            ctx.moveTo(cx + 20, cy - 10); ctx.lineTo(cx + 20, cy - 20); ctx.lineTo(cx + 10, cy - 20);
            ctx.moveTo(cx - 20, cy + 10); ctx.lineTo(cx - 20, cy + 20); ctx.lineTo(cx - 10, cy + 20);
            ctx.moveTo(cx + 20, cy + 10); ctx.lineTo(cx + 20, cy + 20); ctx.lineTo(cx + 10, cy + 20);
            ctx.stroke();

            // 4. Scrolling Telemetry Text & Status
            drawUnmirroredText('STATUS: SEARCHING...', 20, 30, 'rgba(6, 182, 212, 0.95)', 'bold 11px \"Courier New\", monospace');
            drawUnmirroredText('SEARCHING FOR FULL FRONTAL FACE TARGET...', 20, 48, 'rgba(6, 182, 212, 0.6)', '9px \"Courier New\", monospace');
            
            drawUnmirroredText('SYS.LOC: SEC-NODE-A8', 20, 30, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');
            drawUnmirroredText('FEED: 1080P/RAW_RAW', 20, 42, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');
            drawUnmirroredText('LIVENESS: STANDBY', 20, 54, 'rgba(6, 182, 212, 0.5)', '9px \"Courier New\", monospace', 'right');

            drawUnmirroredText('SYS-LOG // FULL FACE VALIDATION ENGINE ACTIVE', 20, canvas.height - 42, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace');
            drawUnmirroredText('NO TARGET DETECTED IN SCANNER RANGE', 20, canvas.height - 30, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace');

            drawUnmirroredText('RESOLUTION: 640X480', 20, canvas.height - 42, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace', 'right');
            drawUnmirroredText(`INFERENCE: TINY_V1 // ${fps} FPS`, 20, canvas.height - 30, 'rgba(6, 182, 212, 0.4)', '8px \"Courier New\", monospace', 'right');

          } else if (detections.length > 1) {
            updateStatus('FAILED');
            updateMsg('Multiple faces detected. Ensure only one person is in frame');
            localStability = 0;
            accumulatedDescriptors = [];
            updateStability(0);

            blinkStateVal = 'waitingForOpen';
            livenessVerifiedVal = false;
            updateLiveness(blinkStateVal, livenessVerifiedVal);

            // Draw red flashing overlay
            const pulseRed = 0.3 + Math.sin(Date.now() * 0.01) * 0.15;
            ctx.fillStyle = `rgba(239, 68, 68, ${pulseRed})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            ctx.lineWidth = 3;
            ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

            drawUnmirroredText('ALERT: MULTIPLE SUBJECTS DETECTED', 20, 30, 'rgba(239, 68, 68, 0.95)', 'bold 11px \"Courier New\", monospace');
            drawUnmirroredText('RESTRICT SCANNER PERIMETER TO SINGLE USER', 20, 48, 'rgba(239, 68, 68, 0.8)', '9px \"Courier New\", monospace');

          } else {
            // Exactly one face!
            const detection = detections[0];
            const videoWidth = video.videoWidth || 640;
            const videoHeight = video.videoHeight || 480;

            // 1. Run strict Full-Face Biometric Validation
            const fullFaceCheck = validateFullFaceEnrollment(detection, videoWidth, videoHeight);

            if (!fullFaceCheck.isFullFace) {
              // Half face, side profile, or slight tilt: softly decay instead of abrupt zero-reset
              localStability = Math.max(0, localStability - 1);
              if (accumulatedDescriptors.length > 0) accumulatedDescriptors.pop();
              updateStability(localStability);

              updateStatus('FACE DETECTED');
              updateMsg(fullFaceCheck.reason);

              blinkStateVal = 'waitingForOpen';
              livenessVerifiedVal = false;
              updateLiveness(blinkStateVal, livenessVerifiedVal);

              // Draw Amber/Orange warning reticle and guides
              drawHolographicOverlay(ctx, detection, videoWidth, videoHeight, false, 'adjusting', fullFaceCheck.reason);

              // Diagnostic telemetry readouts
              drawUnmirroredText('STATUS: ALIGNMENT REQUIRED // FULL FACE ONLY', 20, 30, 'rgba(245, 158, 11, 0.95)', 'bold 11px \"Courier New\", monospace');
              drawUnmirroredText(`PROMPT: ${fullFaceCheck.reason.toUpperCase()}`, 20, 48, 'rgba(245, 158, 11, 0.85)', '9px \"Courier New\", monospace');
              drawUnmirroredText(`YAW SYMMETRY  : ${fullFaceCheck.telemetry?.yawRatio ? fullFaceCheck.telemetry.yawRatio.toFixed(2) : 'N/A'} (OPTIMAL: 0.5 - 2.0)`, 20, 70, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
              drawUnmirroredText(`HEAD TILT     : ${fullFaceCheck.telemetry?.tiltDegrees ? fullFaceCheck.telemetry.tiltDegrees.toFixed(1) + '°' : 'N/A'} (MAX: 24°)`, 20, 82, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
              drawUnmirroredText(`SYS.RESONANCE : ${(detection.detection.score * 100).toFixed(1)}% CONFIDENCE`, 20, 94, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
              drawUnmirroredText(`FRAME ENGINE  : ${fps} FPS // CUDA_ACCEL`, 20, 106, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');

            } else {
              // 2. Verified Full Frontal Face!
              accumulatedDescriptors.push(detection.descriptor);
              localStability += 1;
              const stabilityValue = Math.min(3, localStability);
              updateStability(stabilityValue);

              const lockPercent = Math.round((stabilityValue / 3) * 100);

              if (localStability < 3) {
                // Stabilizing frontal face signature
                updateStatus('ANALYZING');
                updateMsg(`Full face verified. Hold still (${lockPercent}% locked)...`);
                blinkStateVal = 'waitingForClose';
                livenessVerifiedVal = false;
                updateLiveness(blinkStateVal, livenessVerifiedVal);

                drawHolographicOverlay(ctx, detection, videoWidth, videoHeight, true, 'locking', `LOCKING ${lockPercent}%`);

                drawUnmirroredText('STATUS: FULL FACE DETECTED // BIOMETRIC LOCKING', 20, 30, 'rgba(6, 182, 212, 0.95)', 'bold 11px \"Courier New\", monospace');
                drawUnmirroredText(`LOCK PROGRESS : ${lockPercent}% (${stabilityValue}/3 STABLE FRAMES)`, 20, 48, 'rgba(6, 182, 212, 0.85)', '9px \"Courier New\", monospace');
                drawUnmirroredText(`YAW SYMMETRY  : ${fullFaceCheck.telemetry.yawRatio.toFixed(2)} (OPTIMAL)`, 20, 70, 'rgba(34, 197, 94, 0.85)', '8px \"Courier New\", monospace');
                drawUnmirroredText(`EYE APERTURE  : ${fullFaceCheck.telemetry.avgEAR.toFixed(3)} EAR (OPEN)`, 20, 82, 'rgba(34, 197, 94, 0.85)', '8px \"Courier New\", monospace');
                drawUnmirroredText(`HEAD TILT     : ${fullFaceCheck.telemetry.tiltDegrees.toFixed(1)}° (UPRIGHT)`, 20, 94, 'rgba(34, 197, 94, 0.85)', '8px \"Courier New\", monospace');
                drawUnmirroredText(`SYS.RESONANCE : ${(detection.detection.score * 100).toFixed(1)}% QUALITY`, 20, 106, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');
                drawUnmirroredText(`FRAME ENGINE  : ${fps} FPS // CUDA_ACCEL`, 20, 118, 'rgba(156, 163, 175, 0.8)', '8px \"Courier New\", monospace');

              } else {
                // 3. Complete 3-frame full face lock!
                livenessVerifiedVal = true;
                blinkStateVal = 'blinkDetected';
                updateStability(3);
                updateLiveness(blinkStateVal, livenessVerifiedVal);
                updateStatus('ENROLLING');
                updateMsg('Full face biometric lock acquired. Saving template...');

                drawHolographicOverlay(ctx, detection, videoWidth, videoHeight, true, 'locked', '100% SECURE LOCKED');

                playBiometricSound('capture');
                wizardLoopActive.current = false; // Halt loop immediately

                // Calculate high-fidelity mathematical average descriptor vector across all full-face frames
                const finalDescriptor = calculateAverageDescriptor(accumulatedDescriptors) || Array.from(detection.descriptor);

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

                  dataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.92);
                } catch (snapErr) {
                  console.error('[SNAPSHOT CAPTURE ERROR]:', snapErr);
                }

                const confidence = Math.round(detection.detection.score * 1000) / 10;
                setFacePreviewUrl(dataUrl);
                setAutoCapturedDescriptor(finalDescriptor);
                setConfidenceScore(confidence);
                
                // Stop the biometric camera stream
                stopBiometricCamera();
                
                updateStatus('ENROLLING');
                updateMsg('Auto-enrolling biometric signature...');
                handleEnrollBiometrics(finalDescriptor, confidence, dataUrl);
              }
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

  const handleEnrollBiometrics = async (descriptor, confidence, capturedAvatarUrl = null) => {
    if (!biometricTargetEmp) return;
    setEnrollStatus('ENROLLING');
    setRealtimeMsg('Saving encrypted template...');

    const id = biometricTargetEmp.id;
    const name = biometricTargetEmp.name;

    const avatarDataUrl = capturedAvatarUrl || facePreviewUrl || null;

    try {
      const res = await apiCall(`/employees/${id}/face`, 'POST', {
        faceDescriptor: Array.from(descriptor),
        avatar: avatarDataUrl
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
      } catch (e) {}

      // Fetch all registered enterprise multi-site perimeters
      await fetchSites();
    } catch (err) {
      console.error('[ADMIN SETTINGS FETCH ERROR]:', err);
    } finally {
      if (isComponentMounted.current) setLoadingSettings(false);
    }
  };

  // Fetch all configured sites & project branches
  const fetchSites = async () => {
    try {
      const res = await apiCall('/settings/geofences', 'GET');
      if (res.success && isComponentMounted.current) {
        setAllSites(res.geofences || []);
      }
    } catch (err) {
      console.error('[FETCH SITES ERROR]:', err);
    }
  };

  const handleSaveNewSite = async (e) => {
    if (e) e.preventDefault();
    if (!newSiteData.name.trim()) {
      showToast('Please enter an office or site name', 'warning');
      return;
    }
    setSavingSite(true);
    try {
      const res = await apiCall('/settings/geofences', 'POST', {
        office_name: newSiteData.name.trim(),
        type: newSiteData.type,
        latitude: parseFloat(newSiteData.lat),
        longitude: parseFloat(newSiteData.lng),
        radius: parseInt(newSiteData.radius, 10) || 100
      });
      if (res.success) {
        showToast(`Site "${newSiteData.name}" added & activated successfully!`, 'success');
        setNewSiteModalOpen(false);
        setNewSiteData({
          name: '',
          type: 'Project Site',
          lat: settings.geofence_lat || 28.6139,
          lng: settings.geofence_lng || 77.2090,
          radius: 150,
          address: ''
        });
        fetchSites();
      }
    } catch (err) {
      showToast(err.message || 'Failed to add site location', 'error');
    } finally {
      setSavingSite(false);
    }
  };

  const handleDeleteSite = async (siteId, siteName) => {
    if (!window.confirm(`Are you sure you want to delete the site location "${siteName}"?`)) return;
    try {
      const res = await apiCall(`/settings/geofences/${siteId}`, 'DELETE');
      if (res.success) {
        showToast(`Site "${siteName}" removed.`, 'success');
        fetchSites();
      }
    } catch (err) {
      showToast(err.message || 'Failed to delete site', 'error');
    }
  };

  // Fetch Diagnostic Audit Logs
  const fetchAuditLogs = useCallback(async () => {
    if (isComponentMounted.current) setLoadingAuditLogs(true);
    try {
      const data = await apiCall(`/logs/audit?startDate=${auditStartDate}&endDate=${auditEndDate}`, 'GET');
      if (data.success && isComponentMounted.current) {
        setAuditLogs(data.logs || []);
      }
    } catch (e) {
      console.error('[FETCH AUDIT LOGS ERROR]:', e);
    } finally {
      if (isComponentMounted.current) setLoadingAuditLogs(false);
    }
  }, [auditStartDate, auditEndDate]);

  const handleExportAuditCsv = () => {
    if (!auditLogs || auditLogs.length === 0) {
      showToast('No audit logs available to export.', 'warning');
      return;
    }
    const headers = ['ID', 'Timestamp', 'Employee ID', 'Employee Name', 'Department', 'Event Type', 'IP Address', 'Details'];
    const rows = auditLogs.map(log => {
      let detailsText = '';
      try {
        const parsed = JSON.parse(log.details);
        detailsText = parsed.reason || parsed.details || parsed.status_text || log.details;
      } catch {
        detailsText = log.details || '';
      }
      return [
        `"${log.id || ''}"`,
        `"${new Date(log.timestamp).toLocaleString()}"`,
        `"${log.employee_id || 'SYSTEM'}"`,
        `"${log.employee_name || '—'}"`,
        `"${log.department || 'Security & HR'}"`,
        `"${log.event_type || ''}"`,
        `"${log.ip_address || '127.0.0.1'}"`,
        `"${String(detailsText).replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `audit_logs_${auditStartDate}_to_${auditEndDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${auditLogs.length} audit logs to CSV!`, 'success');
  };

  useEffect(() => {
    if (activeTab === 'audit-logs') {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAuditLogs]);

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
      } else {
        // Add Profile
        response = await apiCall('/employees', 'POST', form);
      }

      if (response.success) {
        setSuccess(editingId 
          ? 'Employee profile updated successfully!'
          : 'Employee profile created! Redirecting to biometric face enrollment...'
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
        await fetchEmployees();

        if (!editingId) {
          playBiometricSound('success');
          speakText(`Profile saved for ${registeredName}. Please scan face in camera to enroll.`);
          
          // Seed the new employee directly into the manual face wizard:
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
          localStorage.setItem('quantum_admin_active_tab', 'face-enroll');
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
  const handleDelete = async (emp) => {
    if (!emp) return;
    handleTriggerAdminAction('delete-employee', { id: emp.id, name: emp.name });
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
    if (e && e.preventDefault) e.preventDefault();
    setConfirmSubmitting(true);
    try {
      if (confirmAction === 'reset-db') {
        const res = await apiCall('/employees/reset-db', 'POST');
        if (res.success) {
          showToast('System Purged: Database has been reset to default profiles.', 'success');
        }
      } else if (confirmAction === 'clear-attendance') {
        const res = await apiCall('/attendance/clear', 'POST');
        if (res.success) {
          showToast('Ledger Wiped: All check-in and check-out ledger records have been purged.', 'success');
        }
      } else if (confirmAction === 'clear-logs') {
        const res = await apiCall('/logs/clear', 'POST');
        if (res.success) {
          showToast('Telemetry Purged: All system activity logs have been wiped.', 'success');
        }
      } else if (confirmAction === 'reset-face') {
        if (!confirmTarget) return;
        const res = await apiCall(`/employees/${encodeURIComponent(confirmTarget.id)}/reset-face`, 'POST');
        if (res.success) {
          showToast(`Biometric Erased: Face template removed for ${confirmTarget.name}.`, 'success');
        }
      } else if (confirmAction === 'delete-employee') {
        if (!confirmTarget) return;
        const res = await apiCall(`/employees/${encodeURIComponent(confirmTarget.id)}`, 'DELETE');
        if (res.success) {
          showToast(`Employee Deleted: ${confirmTarget.name} has been permanently removed.`, 'success');
        }
      }
      
      setConfirmModalOpen(false);
      setConfirmAction(null);
      setConfirmTarget(null);
      await fetchEmployees();
    } catch (err) {
      showToast(`Administrative operation failed: ${err.message}`, 'error');
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
    csvContent += '"ID","Name","Email","Role","Department","Status"\n';
    const esc = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
    employees.forEach(e => {
      csvContent += `${esc(e.id)},${esc(e.name)},${esc(e.email)},${esc(e.role)},${esc(e.department)},${esc(e.status)}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "oes_attendance_employees.csv");
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
      {/* Clean Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {[
          { id: 'directory', label: 'Employee directory', icon: Users },
          { id: 'register', label: 'Register employee', icon: UserPlus },
          { id: 'face-enroll', label: 'Biometric enrollment', icon: Fingerprint },
          { id: 'location', label: 'Location & geofence', icon: MapPin },
          { id: 'audit-logs', label: 'Audit logs', icon: FileText },
          { id: 'danger', label: 'Danger zone', icon: ShieldAlert, danger: true },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer min-h-[40px] ${
                isActive
                  ? tab.danger
                    ? 'bg-red-50 text-red-700 font-semibold border border-red-200 shadow-xs'
                    : 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? (tab.danger ? 'text-red-600' : 'text-indigo-600') : 'text-slate-400'}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Employee Directory */}
      {activeTab === 'directory' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
            {/* Search Input */}
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search employee, ID or department..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full !pl-10 !pr-3 !py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2.5 w-full sm:w-auto">
              <button
                onClick={() => handleTabChange('register')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium py-2.5 px-4 rounded-xl shadow-xs transition-colors cursor-pointer min-h-[40px]"
              >
                <UserPlus className="w-4 h-4" /> Register employee
              </button>
              <button
                onClick={handleExportCSV}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer min-h-[40px]"
              >
                <FileText className="w-4 h-4 text-slate-500" /> Export ledger (.csv)
              </button>
            </div>
          </div>

          {/* Main Database Grid list */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {loading ? (
              <SkeletonTable rows={5} cols={8} />
            ) : filteredEmployees.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No employees found"
                description="No employee records matched your search query."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-medium">
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3">Employee ID</th>
                      <th className="px-4 py-3">Email address</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3 text-center">Face biometrics</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={emp.name} avatar={emp.avatar} size="sm" />
                            <span className="font-medium text-slate-900">{emp.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-600">{emp.id}</td>
                        <td className="px-4 py-3.5 text-slate-500">{emp.email}</td>
                        <td className="px-4 py-3.5">
                          <span className={`ui-badge ${emp.role === 'admin' ? 'badge-accent' : 'badge-neutral'}`}>
                            {emp.role}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">{emp.department}</td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className={`ui-badge ${emp.is_face_registered ? 'badge-success' : 'badge-warning'}`}>
                              {emp.is_face_registered ? 'Registered' : 'Not registered'}
                            </span>
                            <button
                              onClick={() => handleTriggerFaceScanTab(emp)}
                              className={`px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer ${
                                emp.is_face_registered
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                                  : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                              }`}
                              title={emp.is_face_registered ? "Update face biometrics" : "Register face biometrics"}
                            >
                              <Fingerprint className="w-3.5 h-3.5" />
                              {emp.is_face_registered ? 'Update' : 'Enroll'}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`ui-badge ${
                            emp.status === 'Inside Office' 
                              ? 'badge-success' 
                              : emp.status === 'Online'
                              ? 'badge-success'
                              : emp.status === 'Outside Office'
                              ? 'badge-info'
                              : 'badge-neutral'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              emp.status === 'Inside Office' 
                                ? 'bg-emerald-500 animate-pulse' 
                                : emp.status === 'Online'
                                ? 'bg-emerald-500'
                                : emp.status === 'Outside Office'
                                ? 'bg-blue-500'
                                : 'bg-slate-400'
                            }`} />
                            {emp.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            onClick={() => openEditModal(emp)}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                            title="Edit profile"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(emp)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 font-medium text-xs transition-colors cursor-pointer"
                            title={`Completely delete ${emp.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
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
          transition={{ duration: 0.25 }}
          className="max-w-xl mx-auto"
        >
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-600" />
              Register employee profile
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              Enter employee credentials to create their enterprise profile.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Corporate ID</label>
                <input
                  type="text"
                  name="id"
                  required
                  placeholder="OES/038"
                  value={form.id}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Employee name"
                  value={form.name}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Corporate email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="employee@company.com"
                  value={form.email}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="Enter initial password..."
                  value={form.password}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Access role</label>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleInputChange}
                    className="w-full"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    name="department"
                    value={form.department}
                    onChange={handleInputChange}
                    className="w-full"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Security & HR">Security & HR</option>
                    <option value="Product">Product</option>
                  </select>
                </div>
              </div>

              <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3 text-xs text-indigo-800 flex items-center gap-2.5">
                <Fingerprint className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>After creating the profile, you will be taken to the <strong>Biometric Enrollment</strong> tab to scan the employee's face using the live camera.</span>
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer min-h-[44px]"
              >
                Create employee profile
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
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative"
        >
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-indigo-600" />
              Biometric face enrollment
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Capture and register facial signature descriptors using liveness-verified neural scanning.
            </p>
          </div>

          {enrollError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
              {enrollError}
            </div>
          )}
          {enrollSuccess && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs">
              {enrollSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono text-slate-300">
            {/* Left/Middle: Webcam viewport and controls */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-0.5">
                      Target employee profile
                    </label>
                    <span className="text-[11px] text-slate-500">
                      Choose an employee to attach biometric template
                    </span>
                  </div>
                  <select
                    value={wizardTargetId}
                    onChange={(e) => handleSelectWizardEmployee(e.target.value)}
                    className="w-full sm:w-64 text-xs cursor-pointer"
                  >
                    <option value="">-- Select employee profile --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.is_face_registered ? 'Enrolled' : 'Not enrolled'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={`relative w-full aspect-video ${theme === 'dark' ? 'bg-slate-900' : 'bg-slate-50'} rounded-xl overflow-hidden border flex items-center justify-center mx-auto max-w-xl transition-all duration-200 ${
                  enrollStatus === 'idle' ? 'border-slate-200' :
                  enrollStatus === 'SCANNING' ? 'border-indigo-400' :
                  enrollStatus === 'FACE DETECTED' ? 'border-amber-400' :
                  enrollStatus === 'CAPTURED' ? 'border-indigo-500' :
                  (enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') ? 'border-indigo-600' :
                  enrollStatus === 'SUCCESS' ? 'border-emerald-500' :
                  (enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED') ? 'border-red-500' :
                  'border-slate-200'
                }`}>
                  {enrollStatus === 'SUCCESS' ? (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20">
                      <div className="relative flex items-center justify-center mb-3">
                        <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-emerald-500 shadow-md z-10 flex items-center justify-center bg-slate-900">
                          {facePreviewUrl ? (
                            <img src={facePreviewUrl} className="w-full h-full object-cover scale-x-[-1]" alt="Enrolled face" />
                          ) : (
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center text-emerald-500">
                              <CheckCircle2 className="w-8 h-8" />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <h4 className="text-sm font-semibold text-emerald-400 mb-1">
                        Face enrolled successfully
                      </h4>
                      <div className="text-xs text-white mb-1 font-medium">
                        {biometricTargetEmp?.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mb-3">
                        Biometric identity created and saved
                      </div>
                      
                      <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-3.5 py-1.5 mt-1">
                        <div className="text-[10px] text-slate-400 font-medium">Calibration score</div>
                        <div className="text-xs font-semibold text-emerald-400 mt-0.5">
                          {confidenceScore}% confidence
                        </div>
                      </div>
                    </div>
                  ) : enrollStatus === 'DUPLICATE DETECTED' ? (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in border border-red-500/30 rounded-xl z-20">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-3">
                        <ShieldAlert className="w-6 h-6 text-red-500" />
                      </div>
                      <h3 className="text-sm font-semibold text-red-400 mb-1">
                        Duplicate face detected
                      </h3>
                      <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-3.5 py-2 mt-1 max-w-sm">
                        <div className="text-xs font-medium text-red-400 leading-relaxed">
                          {duplicateMessage || 'This biometric identity matches an existing profile.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={resetWizard}
                        className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-medium cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : (enrollStatus === 'FAILED' || enrollStatus === 'ERROR') ? (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in border border-red-500/30 rounded-xl z-20">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-3">
                        <AlertTriangle className="w-6 h-6 text-red-500" />
                      </div>
                      <h3 className="text-sm font-semibold text-red-400 mb-1">
                        Enrollment Failed
                      </h3>
                      <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-3.5 py-2 mt-1 max-w-sm">
                        <div className="text-xs font-medium text-red-400 leading-relaxed">
                          {enrollError || realtimeMsg || 'Failed to save biometric template.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={resetWizard}
                        className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-medium cursor-pointer"
                      >
                        Try Again
                      </button>
                    </div>
                  ) : facePreviewUrl && (enrollStatus === 'ENROLLING' || enrollStatus === 'MATCHING' || !biometricCameraActive) ? (
                    <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20">
                      <div className="relative mb-3">
                        <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-indigo-400 shadow-md z-10 flex items-center justify-center bg-slate-900">
                          {facePreviewUrl ? (
                            <img src={facePreviewUrl} className="w-full h-full object-cover scale-x-[-1]" alt="Captured signature" />
                          ) : (
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center text-indigo-400">
                              <Camera className="w-8 h-8 animate-pulse" />
                            </div>
                          )}
                        </div>
                      </div>
                      <h4 className="text-xs font-semibold text-white mb-1">
                        Biometric profile captured
                      </h4>
                      <div className="text-xs text-slate-300 font-medium leading-normal">
                        Ready for registry: {biometricTargetEmp?.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 justify-center">
                        <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span>Saving template to database...</span>
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
                          e.target.play()
                            .then(() => {
                              startAutoCaptureLoop();
                            })
                            .catch(err => console.error('[BIOMETRIC SCANNER LENS] Play failed:', err));
                        }}
                      />
                      <canvas
                        ref={biometricCanvasRef}
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none scale-x-[-1]"
                      />
                      
                      {enrollStatus === 'SCANNING' && (
                        <div className="absolute inset-0 border border-indigo-400/40 pointer-events-none flex items-center justify-center">
                          <div className="w-[120px] h-[120px] border border-dashed border-indigo-400/50 rounded-full animate-spin" style={{ animationDuration: '8s' }} />
                        </div>
                      )}

                      {(enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') && (
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                          <div className="w-[130px] h-[130px] border-2 border-indigo-500 rounded-full animate-pulse" />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center p-6 text-slate-400 flex flex-col items-center gap-2">
                      {wizardModelsLoading ? (
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Camera className="w-6 h-6 text-slate-600" />
                      )}
                      <span className="text-xs font-medium text-slate-400">
                        {wizardModelsLoading ? 'Loading AI models...' : 'Camera hardware idle'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2.5 justify-center max-w-xl mx-auto w-full">
                  {!biometricCameraActive ? (
                    <button
                      type="button"
                      onClick={startBiometricCamera}
                      disabled={!wizardTargetId}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white font-medium py-2.5 rounded-xl transition-colors cursor-pointer text-xs min-h-[40px]"
                    >
                      Start camera enrollment
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopBiometricCamera}
                      className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium py-2.5 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                    >
                      Stop camera
                    </button>
                  )}
                  {enrollStatus !== 'idle' && enrollStatus !== 'SUCCESS' && enrollStatus !== 'DUPLICATE DETECTED' && (
                    <button
                      type="button"
                      onClick={resetWizard}
                      className="bg-white border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                      title="Reset progress"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Panel: Clean Telemetry Console */}
            <div className="flex flex-col justify-between space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2 flex items-center justify-between">
                    <span>Telemetry console</span>
                    <span className={biometricCameraActive ? "text-emerald-600 flex items-center gap-1 font-medium text-[11px]" : "text-slate-400 text-[11px]"}>
                      <span className={`h-1.5 w-1.5 rounded-full ${biometricCameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                      {biometricCameraActive ? "Online" : "Offline"}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                      <span className="text-slate-500">Subject profile</span>
                      <span className="font-medium text-slate-900">{biometricTargetEmp ? biometricTargetEmp.name : 'None selected'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                      <span className="text-slate-500">Employee ID</span>
                      <span className="font-medium text-slate-700">{biometricTargetEmp ? biometricTargetEmp.id : '—'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/60 pb-1.5">
                      <span className="text-slate-500">Hardware feed</span>
                      <span className={biometricCameraActive ? "text-emerald-700 font-medium" : "text-slate-500"}>
                        {biometricCameraActive ? "Connected" : "Idle"}
                      </span>
                    </div>
                  </div>

                  {/* Scan Status Pill */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-slate-500">Engine state</div>
                    <div className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all ${
                      enrollStatus === 'SUCCESS' 
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                        : enrollStatus === 'idle'
                        ? 'bg-white border-slate-200 text-slate-600'
                        : (enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED')
                        ? 'bg-red-50 border-red-200 text-red-700'
                        : enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING'
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    }`}>
                      <div className="flex items-center gap-2">
                        {(enrollStatus === 'SCANNING' || enrollStatus === 'ANALYZING' || enrollStatus === 'ENROLLING') && (
                          <div className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        )}
                        <span>{enrollStatus}</span>
                      </div>
                      {enrollStatus === 'ANALYZING' && (
                        <span className="text-[11px] font-semibold text-indigo-700">{Math.round((stabilityCounter / 5) * 100)}% locked</span>
                      )}
                    </div>
                  </div>

                  {/* Live Diagnostic Message Box */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="text-[11px] font-medium text-slate-500 flex items-center justify-between">
                      <span>Diagnostics</span>
                      <span className="text-[10px] text-slate-400">Stability: {stabilityCounter}/5</span>
                    </div>
                    <div className="min-h-[32px] flex items-center">
                      <p className={`text-xs font-medium leading-normal ${
                        enrollStatus === 'FAILED' || enrollStatus === 'DUPLICATE DETECTED' || realtimeMsg.includes('hidden') || realtimeMsg.includes('Multiple') || realtimeMsg.includes('lighting')
                          ? 'text-red-600'
                          : enrollStatus === 'FACE DETECTED'
                          ? 'text-amber-700 font-semibold'
                          : enrollStatus === 'ANALYZING'
                          ? 'text-indigo-700'
                          : enrollStatus === 'SUCCESS'
                          ? 'text-emerald-700'
                          : 'text-slate-700'
                      }`}>
                        {realtimeMsg}
                      </p>
                    </div>
                    
                    {/* Diagnostics Checklist */}
                    <div className="border-t border-slate-100 pt-2 mt-1 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">1. Single subject</span>
                        <span className={`font-medium ${
                          enrollStatus === 'idle' ? 'text-slate-400' :
                          realtimeMsg.includes('Multiple') ? 'text-red-600' : 'text-emerald-600'
                        }`}>
                          {enrollStatus === 'idle' ? 'Waiting' : realtimeMsg.includes('Multiple') ? 'Fail' : 'Pass'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">2. Full frontal face</span>
                        <span className={`font-medium ${
                          enrollStatus === 'idle' ? 'text-slate-400' :
                          (realtimeMsg.includes('turned') || realtimeMsg.includes('tilted') || realtimeMsg.includes('profile') || realtimeMsg.includes('angle')) ? 'text-red-600' :
                          (enrollStatus === 'ANALYZING' || enrollStatus === 'SUCCESS' || enrollStatus === 'ENROLLING') ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          {enrollStatus === 'idle' ? 'Waiting' : (realtimeMsg.includes('turned') || realtimeMsg.includes('tilted') || realtimeMsg.includes('profile') || realtimeMsg.includes('angle')) ? 'Look straight' : (enrollStatus === 'ANALYZING' || enrollStatus === 'SUCCESS' || enrollStatus === 'ENROLLING') ? 'Pass' : 'Aligning'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">3. Centered bounds</span>
                        <span className={`font-medium ${
                          enrollStatus === 'idle' ? 'text-slate-400' :
                          (realtimeMsg.includes('cut off') || realtimeMsg.includes('far') || realtimeMsg.includes('close')) ? 'text-red-600' : 'text-emerald-600'
                        }`}>
                          {enrollStatus === 'idle' ? 'Waiting' : (realtimeMsg.includes('cut off') || realtimeMsg.includes('far') || realtimeMsg.includes('close')) ? 'Adjust' : 'Pass'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">4. Eyes & jaw visible</span>
                        <span className={`font-medium ${
                          enrollStatus === 'idle' ? 'text-slate-400' :
                          (realtimeMsg.includes('eyes') || realtimeMsg.includes('jawline') || realtimeMsg.includes('obstruction') || realtimeMsg.includes('lighting')) ? 'text-red-600' : 'text-emerald-600'
                        }`}>
                          {enrollStatus === 'idle' ? 'Waiting' : (realtimeMsg.includes('eyes') || realtimeMsg.includes('jawline') || realtimeMsg.includes('obstruction') || realtimeMsg.includes('lighting')) ? 'Uncover' : 'Pass'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">5. Biometric lock</span>
                        <span className={`font-medium ${
                          enrollStatus === 'idle' ? 'text-slate-400' :
                          stabilityCounter >= 5 ? 'text-emerald-600' : 'text-indigo-600'
                        }`}>
                          {enrollStatus === 'idle' ? 'Waiting' : stabilityCounter >= 5 ? '100% Locked' : `${Math.round((stabilityCounter / 5) * 100)}% (${stabilityCounter}/5)`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}


      {/* Tab 4: Location & Geofence Settings (Enterprise Multi-Site Hub) */}
      {activeTab === 'location' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* ===== GEOFENCE CONFIGURATION SECTION ===== */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm relative space-y-6">
            {/* Header with Multi-Site Management & Add Site Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  Enterprise Multi-Site Geofence Network
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure office headquarters, branch offices, client plants, and project sites. Employees can verify attendance from ANY active site.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNewSiteModalOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-xs transition-colors cursor-pointer whitespace-nowrap min-h-[40px]"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  + Add Office / Project Site
                </button>

                <button
                  type="button"
                  onClick={handleDetectLocation}
                  disabled={gpsDetecting}
                  className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-medium text-xs rounded-xl shadow-xs transition-colors cursor-pointer whitespace-nowrap min-h-[40px]"
                >
                  {gpsDetecting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Navigation className="w-3.5 h-3.5" />
                  )}
                  {gpsDetecting ? 'Acquiring GPS...' : 'Use current location'}
                </button>
              </div>
            </div>

            {/* Multi-Site Network Overview KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <p className="text-[11px] text-slate-500 font-medium">Total Authorized Locations</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{allSites.length + 1} Sites</p>
                <p className="text-[10px] text-slate-400 mt-0.5">All active & attendance-ready</p>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5">
                <p className="text-[11px] text-indigo-600 font-medium">Corporate Headquarters</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 truncate">{officeName || 'Head Office'}</p>
                <p className="text-[10px] text-indigo-500 mt-0.5">Radius: {settings.geofence_radius}m</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5">
                <p className="text-[11px] text-emerald-700 font-medium">Field / Project Sites</p>
                <p className="mt-1 text-lg font-bold text-emerald-800">{allSites.length} Locations</p>
                <p className="text-[10px] text-emerald-600 mt-0.5">Branches, Plants & Sites</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <p className="text-[11px] text-slate-500 font-medium">Universal Validation Policy</p>
                <p className="mt-1 text-xs font-semibold text-emerald-700">✓ Multi-Location Enabled</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Travelling staff auto-recognized</p>
              </div>
            </div>

            {/* GPS Status Banner */}
            {gpsDetecting && (
              <div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700">
                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Acquiring GPS signal</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Connecting to location services... please wait</div>
                </div>
              </div>
            )}
            {gpsError && (
              <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
                <WifiOff className="w-4 h-4 text-red-600 flex-shrink-0" />
                <div>
                  <div className="text-xs font-semibold">GPS signal unavailable</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{gpsError}</div>
                </div>
              </div>
            )}
            {!gpsDetecting && !gpsError && gpsAccuracy && (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                <Wifi className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div>
                  <div className="text-xs font-semibold">GPS lock acquired</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">Accuracy: ±{gpsAccuracy}m · Map centered on your position</div>
                </div>
              </div>
            )}
            {locationSaved && (
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div className="text-xs font-semibold">Office geofence saved successfully. All attendance scans now validate against this boundary.</div>
              </div>
            )}

            {loadingSettings ? (
              <div className="py-20 flex flex-col items-center justify-center">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs text-slate-500 mt-3">Loading geofence workspace...</p>
              </div>
            ) : (
              <div className="space-y-6">

                {/* Location Search Bar */}
                <div ref={searchContainerRef} className="relative">
                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5">
                        {searchLoading ? (
                          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Search className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <input
                        type="text"
                        value={locationSearch}
                        onChange={(e) => handleLocationSearchChange(e.target.value)}
                        onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                        placeholder="Search landmark, address, building or city to set or find office location..."
                        className="w-full rounded-xl border border-slate-200 bg-white !pl-10 !pr-10 !py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                      />
                      {locationSearch && (
                        <button
                          type="button"
                          onClick={() => { setLocationSearch(''); setLocationSuggestions([]); setShowSuggestions(false); }}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Suggestions Dropdown */}
                  {showSuggestions && locationSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1000] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg">
                      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-medium">
                        <span>{locationSuggestions.length} locations found</span>
                        <span className="text-[10px] text-slate-400">OpenStreetMap</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                        {locationSuggestions.map((place, idx) => {
                          const nameLabel = place.name || place.address?.amenity || place.address?.building || place.address?.road || place.display_name.split(',')[0];
                          const subLabel = place.display_name;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSelectSuggestion(place)}
                              className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                            >
                              <div className="flex items-start gap-2.5">
                                <MapPin className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-slate-900 truncate">{nameLabel}</div>
                                  <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{subLabel}</div>
                                </div>
                                <div className="text-[10px] text-slate-400 shrink-0">
                                  {parseFloat(place.lat).toFixed(3)}, {parseFloat(place.lon).toFixed(3)}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Primary HQ Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1">
                      <Building2 className="w-3.5 h-3.5 text-indigo-600" /> Primary HQ / Main Office Name
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
                      placeholder="e.g. Orbit Engineering Headquarters"
                      className={`w-full text-xs rounded-xl border border-slate-200 p-2.5 ${officeNameError ? 'border-red-300' : ''}`}
                    />
                    {officeNameError && (
                      <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{officeNameError}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1">
                      <MapPin className="w-3.5 h-3.5 text-indigo-600" /> Primary HQ Address
                    </label>
                    <input
                      type="text"
                      value={officeAddress}
                      onChange={(e) => setOfficeAddress(e.target.value)}
                      placeholder="Address or landmark..."
                      className="w-full text-xs rounded-xl border border-slate-200 p-2.5"
                    />
                  </div>
                </div>

                {/* Interactive Multi-Site Map */}
                <div className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-white/90 backdrop-blur-md border border-slate-200 rounded-full px-3.5 py-1 text-xs text-slate-600 flex items-center gap-1.5 shadow-sm pointer-events-none whitespace-nowrap">
                    <Globe className="w-3.5 h-3.5 text-indigo-600" /> All {allSites.length + 1} Authorized Sites Plotted · Click any site to view
                  </div>

                  {settings.geofence_lat !== 0 && settings.geofence_lng !== 0 ? (
                    <MapContainer
                      key="admin-geofence-map-multisite"
                      ref={geofenceMapRef}
                      center={[settings.geofence_lat, settings.geofence_lng]}
                      zoom={15}
                      scrollWheelZoom={true}
                      className="w-full z-0"
                      style={{ height: '400px' }}
                    >
                      <ChangeMapView center={geofenceMapCenter} zoom={geofenceMapZoom} />
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url={mapTileUrl}
                      />
                      <MapClickHandler onMapClick={handleGeofenceMapClick} />

                      {/* Primary HQ Radius Circle */}
                      <Circle
                        center={[settings.geofence_lat, settings.geofence_lng]}
                        radius={settings.geofence_radius}
                        pathOptions={{ color: '#4F46E5', fillColor: '#4F46E5', fillOpacity: 0.12, weight: 2, dashArray: '6 4' }}
                      />

                      {/* Primary HQ Marker */}
                      <Marker
                        position={[settings.geofence_lat, settings.geofence_lng]}
                        icon={officeIcon}
                        draggable={true}
                        eventHandlers={{ dragend: handleOfficeMarkerDragEnd }}
                      >
                        <Popup className="text-xs">
                          <div className="space-y-1 text-xs min-w-[170px]">
                            <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">{officeName || 'Head Office'}</div>
                            <div className="text-[11px] font-semibold text-indigo-700">🏢 Corporate HQ</div>
                            <div>Lat: <span className="font-medium">{settings.geofence_lat.toFixed(5)}</span></div>
                            <div>Lng: <span className="font-medium">{settings.geofence_lng.toFixed(5)}</span></div>
                            <div>Radius: <span className="font-medium">{settings.geofence_radius}m</span></div>
                          </div>
                        </Popup>
                      </Marker>

                      {/* Render All Additional Authorized Project Sites & Branch Offices */}
                      {allSites.map((site) => {
                        const sLat = site.latitude !== undefined && site.latitude !== null ? parseFloat(site.latitude) : (site.parsedCoordinates?.lat ? parseFloat(site.parsedCoordinates.lat) : null);
                        const sLng = site.longitude !== undefined && site.longitude !== null ? parseFloat(site.longitude) : (site.parsedCoordinates?.lng ? parseFloat(site.parsedCoordinates.lng) : null);
                        const sRadius = site.radius || site.parsedCoordinates?.radius || 150;
                        const sType = site.type || site.parsedCoordinates?.type || 'Project Site';
                        const sColor = sType === 'Branch Office' ? '#06B6D4' : sType === 'Client Site' ? '#F59E0B' : '#10B981';
                        const sIcon = sType === 'Branch Office' ? employeeOfflineIcon : sType === 'Client Site' ? employeeOutsideIcon : employeeIcon;

                        if (sLat === null || sLng === null || isNaN(sLat) || isNaN(sLng)) return null;

                        return (
                          <React.Fragment key={site.id}>
                            <Circle
                              center={[sLat, sLng]}
                              radius={sRadius}
                              pathOptions={{ color: sColor, fillColor: sColor, fillOpacity: 0.12, weight: 2, dashArray: '4 4' }}
                            />
                            <Marker position={[sLat, sLng]} icon={sIcon}>
                              <Popup className="text-xs">
                                <div className="space-y-1 text-xs min-w-[170px]">
                                  <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">{site.office_name}</div>
                                  <div className="text-[11px] font-semibold" style={{ color: sColor }}>📍 {sType}</div>
                                  <div>Lat: <span className="font-medium">{sLat.toFixed(5)}</span></div>
                                  <div>Lng: <span className="font-medium">{sLng.toFixed(5)}</span></div>
                                  <div>Radius: <span className="font-medium">{sRadius}m</span></div>
                                  <div className="pt-2 border-t border-slate-100 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSite(site.id, site.office_name)}
                                      className="text-[10px] text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                                    >
                                      Delete this site
                                    </button>
                                  </div>
                                </div>
                              </Popup>
                            </Marker>
                          </React.Fragment>
                        );
                      })}

                      {/* Active Polygon Boundary */}
                      {activePolygon && activePolygon.length >= 3 && !captureMode && (
                        <Polygon 
                          positions={activePolygon.map(p => [p.lat, p.lng])} 
                          pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.15, weight: 2 }} 
                        />
                      )}
                    </MapContainer>
                  ) : (
                    <div className="h-[400px] flex flex-col items-center justify-center text-center p-6">
                      <Crosshair className="w-8 h-8 text-slate-400 mb-2" />
                      <p className="text-xs font-semibold text-slate-700">No office location configured</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-xs">Click "Use current location" or search above to set the office boundary</p>
                    </div>
                  )}
                </div>

                {/* Authorized Sites & Project Locations Directory */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Building className="w-4 h-4 text-indigo-600" />
                      All Authorized Office & Site Perimeters ({allSites.length + 1})
                    </h4>
                    <button
                      type="button"
                      onClick={() => setNewSiteModalOpen(true)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer"
                    >
                      + Add another site
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {/* Primary HQ Card */}
                    <div className="rounded-xl border-2 border-indigo-500/30 bg-indigo-50/20 p-4 relative space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 text-indigo-700 mb-1">
                            🏢 Main Headquarters
                          </div>
                          <h5 className="text-xs font-bold text-slate-900 truncate">{officeName || 'Main Office'}</h5>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setGeofenceMapCenter([settings.geofence_lat, settings.geofence_lng]);
                            setGeofenceMapZoom(17);
                          }}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] cursor-pointer"
                          title="Center Map"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-600 space-y-0.5">
                        <div className="truncate">Lat: {settings.geofence_lat.toFixed(5)}, Lng: {settings.geofence_lng.toFixed(5)}</div>
                        <div>Boundary Radius: <span className="font-semibold text-indigo-700">{settings.geofence_radius}m</span></div>
                      </div>
                    </div>

                    {/* Additional Registered Sites */}
                    {allSites.map((site) => {
                      const sLat = site.latitude !== undefined && site.latitude !== null ? parseFloat(site.latitude) : (site.parsedCoordinates?.lat ? parseFloat(site.parsedCoordinates.lat) : null);
                      const sLng = site.longitude !== undefined && site.longitude !== null ? parseFloat(site.longitude) : (site.parsedCoordinates?.lng ? parseFloat(site.parsedCoordinates.lng) : null);
                      const sRadius = site.radius || site.parsedCoordinates?.radius || 150;
                      const sType = site.type || site.parsedCoordinates?.type || 'Project Site';

                      return (
                        <div key={site.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 relative shadow-2xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">
                                📍 {sType}
                              </div>
                              <h5 className="text-xs font-bold text-slate-900 truncate">{site.office_name}</h5>
                            </div>
                            
                            <div className="flex items-center gap-1 shrink-0">
                              {sLat && sLng && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGeofenceMapCenter([sLat, sLng]);
                                    setGeofenceMapZoom(17);
                                  }}
                                  className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
                                  title="Center Map"
                                >
                                  <Crosshair className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteSite(site.id, site.office_name)}
                                className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 cursor-pointer"
                                title="Delete Site"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-600 space-y-0.5">
                            {sLat && sLng ? (
                              <div className="truncate">Lat: {sLat.toFixed(5)}, Lng: {sLng.toFixed(5)}</div>
                            ) : (
                              <div className="text-slate-400 italic">Custom Polygon Boundary</div>
                            )}
                            <div>Boundary Radius: <span className="font-semibold text-emerald-700">{sRadius}m</span></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Primary HQ Radius Slider & Save Settings */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Primary HQ Geofence Radius</span>
                    <span className="ui-badge badge-accent">{settings.geofence_radius}m</span>
                  </div>

                  <input
                    type="range"
                    min="25"
                    max="2000"
                    step="25"
                    value={settings.geofence_radius}
                    onChange={(e) => setSettings(prev => ({ ...prev, geofence_radius: parseInt(e.target.value) }))}
                    className="w-full h-2 rounded-full cursor-pointer accent-indigo-600"
                  />

                  {/* Preset Buttons */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {[50, 100, 200, 300, 500, 1000].map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSettings(prev => ({ ...prev, geofence_radius: r }))}
                        className={`text-xs font-medium py-1 px-3 rounded-lg border transition-colors cursor-pointer ${
                          settings.geofence_radius === r
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {r}m
                      </button>
                    ))}
                  </div>
                </div>

                {/* Save HQ Settings & Reset */}
                <div className="flex flex-col sm:flex-row gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleResetGeofence}
                    className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reset to defaults
                  </button>
                  <button
                    type="button"
                    onClick={() => saveSettings(settings)}
                    className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs py-2.5 px-6 rounded-xl shadow-xs transition-colors cursor-pointer min-h-[40px]"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save & Activate HQ Boundary
                  </button>
                </div>

              </div>
            )}
          </div>

          {/* ===== ADD NEW SITE LOCATION MODAL ===== */}
          <AnimatePresence>
            {newSiteModalOpen && (
              <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-600" />
                      Add New Authorized Office or Project Site
                    </h3>
                    <button
                      type="button"
                      onClick={() => setNewSiteModalOpen(false)}
                      className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveNewSite} className="space-y-3.5">
                    <div>
                      <label className="text-xs font-medium text-slate-700 block mb-1">
                        Site / Office Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={newSiteData.name}
                        onChange={(e) => setNewSiteData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Highway Project Site 4, Surat Branch, Client Factory"
                        className="w-full text-xs rounded-xl border border-slate-200 p-2.5 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 block mb-1">
                        Location Type / Category
                      </label>
                      <select
                        value={newSiteData.type}
                        onChange={(e) => setNewSiteData(prev => ({ ...prev, type: e.target.value }))}
                        className="w-full text-xs rounded-xl border border-slate-200 p-2.5 bg-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="Project Site">Project Site / Field Location</option>
                        <option value="Branch Office">Branch Office</option>
                        <option value="Client Site">Client Plant / Site</option>
                        <option value="Warehouse">Warehouse / Depot</option>
                        <option value="Head Office">Regional Head Office</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">
                          Latitude *
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={newSiteData.lat}
                          onChange={(e) => setNewSiteData(prev => ({ ...prev, lat: e.target.value }))}
                          className="w-full text-xs rounded-xl border border-slate-200 p-2.5"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 block mb-1">
                          Longitude *
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={newSiteData.lng}
                          onChange={(e) => setNewSiteData(prev => ({ ...prev, lng: e.target.value }))}
                          className="w-full text-xs rounded-xl border border-slate-200 p-2.5"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-medium text-slate-700">
                          Geofence Perimeter Radius: <span className="text-emerald-700 font-bold">{newSiteData.radius}m</span>
                        </label>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="2000"
                        step="25"
                        value={newSiteData.radius}
                        onChange={(e) => setNewSiteData(prev => ({ ...prev, radius: parseInt(e.target.value) }))}
                        className="w-full h-2 rounded-full cursor-pointer accent-emerald-600"
                      />
                    </div>

                    <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setNewSiteModalOpen(false)}
                        className="px-4 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingSite}
                        className="px-5 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {savingSite ? 'Saving Site...' : 'Save & Activate Site'}
                      </button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Tab 5: Audit Logs */}
      {activeTab === 'audit-logs' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          {/* Header Panel */}
          <div className="bg-white border border-slate-200 p-5 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Audit logs & diagnostic trails
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ground-truth system verification record of attendance scans and security alerts.
              </p>
            </div>
            
            <button
              type="button"
              onClick={handleExportAuditCsv}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-xs transition-colors cursor-pointer min-h-[40px]"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              Export ledger (.csv)
            </button>
          </div>

          {/* Filters Bar */}
          <div className="bg-white border border-slate-200 p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end shadow-sm">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start date</label>
              <input
                type="date"
                value={auditStartDate}
                onChange={(e) => setAuditStartDate(e.target.value)}
                className="w-full text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">End date</label>
              <input
                type="date"
                value={auditEndDate}
                onChange={(e) => setAuditEndDate(e.target.value)}
                className="w-full text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by ID, event..."
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                  className="w-full !pl-10 !pr-3 !py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
              </div>
            </div>
            <button
              onClick={fetchAuditLogs}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition-colors cursor-pointer min-h-[40px]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh logs
            </button>
          </div>

          {/* Logs Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-500 font-medium">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Employee ID</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Event type</th>
                    <th className="px-4 py-3">IP address</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {loadingAuditLogs ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        Loading diagnostic logs...
                      </td>
                    </tr>
                  ) : auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No diagnostic logs found.
                      </td>
                    </tr>
                  ) : (
                    auditLogs
                      .filter(log => {
                        const search = auditSearchQuery.toLowerCase();
                        return (
                          String(log.employee_id || '').toLowerCase().includes(search) ||
                          String(log.employee_name || '').toLowerCase().includes(search) ||
                          String(log.event_type || '').toLowerCase().includes(search) ||
                          String(log.details || '').toLowerCase().includes(search)
                        );
                      })
                      .map((log) => {
                        let parsedDetails = {};
                        try {
                          parsedDetails = JSON.parse(log.details);
                        } catch (e) {
                          parsedDetails = { raw: log.details };
                        }
                        
                        const isSuccess = log.event_type === 'CHECK_IN' || log.event_type === 'CHECK_OUT';
                        const isThreat = ['REPLAY_ATTEMPT', 'VELOCITY_BREACH', 'STATIC_GPS_DETECTED', 'OFFICE_IP_MISMATCH'].includes(log.event_type);
                        
                        let badgeClass = 'badge-neutral';
                        if (isSuccess) badgeClass = 'badge-success';
                        else if (isThreat) badgeClass = 'badge-error';
                        else if (log.event_type === 'LIVENESS_FAILED') badgeClass = 'badge-warning';

                        return (
                          <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                              {new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">
                              {log.employee_id || 'SYSTEM'}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                              {log.employee_name || '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`ui-badge ${badgeClass}`}>
                                {log.event_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                              {log.ip_address}
                            </td>
                            <td className="px-4 py-3 max-w-xs md:max-w-md truncate text-slate-600" title={log.details}>
                              {parsedDetails.reason || parsedDetails.details || parsedDetails.raw || JSON.stringify(parsedDetails)}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* Tab 6: Danger Zone */}
      {activeTab === 'danger' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-xl border border-red-200 bg-white p-6 shadow-sm"
        >
          <h3 className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600" />
            Critical system actions
          </h3>
          <p className="text-xs text-slate-600 mb-6">
            The following actions permanently delete stored data. Confirmations are required before proceeding.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-900 mb-1">Clear attendance ledger</h4>
                <p className="text-xs text-slate-500 mb-4">Erase all check-in and check-out ledger records completely.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('clear-attendance')}
                className="w-full bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-xs font-medium py-2 rounded-lg transition-colors cursor-pointer min-h-[38px]"
              >
                Clear attendance records
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-900 mb-1">Purge activity logs</h4>
                <p className="text-xs text-slate-500 mb-4">Permanently clear all system activity logs and audit trails.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('clear-logs')}
                className="w-full bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-xs font-medium py-2 rounded-lg transition-colors cursor-pointer min-h-[38px]"
              >
                Purge activity logs
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-semibold text-slate-900 mb-1">Reset database</h4>
                <p className="text-xs text-slate-500 mb-4">Purge all database tables and re-seed default profiles.</p>
              </div>
              <button
                onClick={() => handleTriggerAdminAction('reset-db')}
                className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-2 rounded-lg transition-colors cursor-pointer min-h-[38px]"
              >
                Reset database
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Edit Profile Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs px-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 relative border border-slate-200 shadow-xl">
            <button
              onClick={closeMainModal}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              Edit employee profile
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Update credentials and corporate assignments.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Employee name"
                  value={form.name}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Corporate email</label>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="employee@company.com"
                  value={form.email}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  New password (leave blank to keep current)
                </label>
                <input
                  type="password"
                  name="password"
                  placeholder="Enter new password..."
                  value={form.password}
                  onChange={handleInputChange}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Access role</label>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleInputChange}
                    className="w-full"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    name="department"
                    value={form.department}
                    onChange={handleInputChange}
                    className="w-full"
                  >
                    <option value="Engineering">Engineering</option>
                    <option value="Security & HR">Security & HR</option>
                    <option value="Product">Product</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium py-2.5 px-4 rounded-xl transition-colors cursor-pointer min-h-[44px]"
              >
                Save changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Double Confirmation Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs px-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 relative shadow-xl">
            <button
              onClick={() => setConfirmModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-sm font-semibold text-red-700 mb-1 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-600" />
              Critical authorization required
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              You are about to execute a destructive administrative operation.
            </p>

            {confirmAction === 'delete-employee' ? (
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 space-y-1.5">
                  <div className="text-red-900 font-semibold text-sm">
                    Are you sure you want to completely delete {confirmTarget?.name}?
                  </div>
                  <div className="text-slate-600 text-xs">
                    Employee ID: <span className="font-mono font-semibold bg-white/80 px-1.5 py-0.5 rounded border border-red-200 text-slate-800">{confirmTarget?.id}</span>
                  </div>
                  <div className="text-red-700 text-xs leading-relaxed pt-1">
                    This will permanently purge this employee's account, face biometric descriptors, encrypted photo assets, and all attendance logs.
                  </div>
                </div>

                <div className="flex gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmModalOpen(false)}
                    className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium py-2.5 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={confirmSubmitting}
                    onClick={handleConfirmAdminAction}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium py-2.5 rounded-xl transition-colors cursor-pointer min-h-[40px] shadow-xs flex items-center justify-center gap-2"
                  >
                    {confirmSubmitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Deleting employee...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Yes, Delete Employee</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-xs space-y-1">
                  <div className="text-red-900 font-semibold">Action: {
                    confirmAction === 'reset-db' ? 'Factory reset system' :
                    confirmAction === 'clear-attendance' ? 'Clear attendance ledger' :
                    confirmAction === 'clear-logs' ? 'Purge activity logs' :
                    confirmAction === 'reset-face' ? `Erase face template for ${confirmTarget?.name}` : 'Unknown destructive operation'
                  }</div>
                  <div className="text-slate-600 text-[11px]">Scope: permanent database change.</div>
                </div>

                <form onSubmit={handleConfirmAdminAction} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Type the exact keyphrase to authorize: <span className="font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
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
                      placeholder="Type keyphrase here..."
                      value={confirmTextInput}
                      onChange={(e) => setConfirmTextInput(e.target.value)}
                      className="w-full text-center"
                    />
                  </div>

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmModalOpen(false)}
                      className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium py-2.5 rounded-xl transition-colors cursor-pointer min-h-[40px]"
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
                      className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white text-xs font-medium py-2.5 rounded-xl transition-colors cursor-pointer min-h-[40px]"
                    >
                      {confirmSubmitting ? 'Authorizing...' : 'Authorize action'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl border bg-white shadow-lg text-xs font-medium text-slate-800"
          >
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
            {toast.type === 'error' && <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />}
            {toast.type === 'info' && <Activity className="w-4 h-4 text-indigo-600 shrink-0" />}
            
            <div className="select-none">
              {toast.message}
            </div>

            <button
              onClick={() => setToast(null)}
              className="ml-2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
