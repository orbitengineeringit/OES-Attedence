import React from 'react';
import { motion } from 'framer-motion';
import { 
  Camera, 
  CameraOff, 
  RefreshCw, 
  ShieldCheck, 
  ShieldX,
  CheckCircle2
} from 'lucide-react';

/**
 * ScannerTelemetryHUD
 * Displays live tracking diagnostics (online status, current head pose, target lock progress).
 */
export function ScannerTelemetryHUD({
  cameraActive,
  cooldownState,
  scannerStatusMsg,
  telemetryPose,
  telemetryLockProgress,
  livenessChallenge = 'blink',
  challengePassed = false
}) {
  if (!cameraActive || cooldownState) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed select-none shadow-md z-30"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-slate-900 font-semibold">Scanner active</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Status:</span>
        <span className="text-indigo-600 font-medium">{scannerStatusMsg}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Pose:</span>
        <span className={`font-medium ${telemetryPose === 'front' ? 'text-emerald-600' : 'text-amber-600'}`}>
          {telemetryPose === 'none' ? 'Calibrating...' : telemetryPose}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Challenge:</span>
        <span className={`font-medium ${challengePassed ? 'text-emerald-600' : 'text-amber-600'}`}>
          {livenessChallenge === 'blink' ? 'Blink' : (livenessChallenge === 'turn_left' ? 'Turn left' : 'Turn right')}
          {challengePassed ? ' (Passed)' : ' (Required)'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Align:</span>
        <span className="text-slate-800 font-medium">{telemetryLockProgress}%</span>
        {telemetryLockProgress >= 100 && (
          <span className="text-emerald-600 font-semibold ml-1">
            Locked
          </span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * ScannerCooldownOverlay
 * Renders the full-viewport attendance result card with animated success checkmark.
 */
export function ScannerCooldownOverlay({
  cooldownState,
  lastScanDetails,
  cooldownTimeLeft
}) {
  if (!cooldownState || !lastScanDetails) return null;

  const isSuccess = lastScanDetails.success;

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 text-center">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-sm bg-white rounded-2xl p-6 relative overflow-hidden border border-slate-200 flex flex-col items-center shadow-lg"
      >
        {/* Animated Icon Indicator */}
        <div className="relative mb-3">
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1, stiffness: 200 }}
            className={`p-3 rounded-full border ${isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-red-200 bg-red-50 text-red-600'}`}
          >
            {isSuccess ? <CheckCircle2 className="w-8 h-8" /> : <ShieldX className="w-8 h-8" />}
          </motion.div>
        </div>

        <span className={`ui-badge mb-2 ${isSuccess ? 'badge-success' : 'badge-error'}`}>
          {isSuccess ? 'Attendance recorded' : 'Verification denied'}
        </span>
        
        <h3 className="text-base font-semibold text-slate-900 mb-0.5">
          {lastScanDetails.name}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {isSuccess ? 'Biometric identity verified' : 'Authentication rejected'}
        </p>

        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2 text-left">
          <div className="flex justify-between border-b border-slate-200/80 pb-1.5">
            <span className="text-slate-500">Employee ID:</span>
            <span className="text-slate-900 font-medium">{lastScanDetails.id}</span>
          </div>
          <div className="flex justify-between border-b border-slate-200/80 pb-1.5">
            <span className="text-slate-500">Department:</span>
            <span className="text-slate-800 capitalize truncate max-w-[140px]">{lastScanDetails.department}</span>
          </div>
          {isSuccess && (
            <div className="flex justify-between border-b border-slate-200/80 pb-1.5">
              <span className="text-slate-500">Match score:</span>
              <span className="text-emerald-700 font-medium">
                {Math.round(lastScanDetails.confidence * 100)}% match
              </span>
            </div>
          )}
          <div className="flex justify-between border-b border-slate-200/80 pb-1.5">
            <span className="text-slate-500">Event type:</span>
            <span className={`ui-badge text-[10px] ${
              lastScanDetails.eventType === 'CHECK_IN'
                ? 'badge-success'
                : lastScanDetails.eventType === 'CHECK_OUT'
                ? 'badge-info'
                : 'badge-error'
            }`}>
              {lastScanDetails.eventType}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-200/80 pb-1.5">
            <span className="text-slate-500">Time:</span>
            <span className="text-slate-800 font-medium">{lastScanDetails.scanTime}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Punctuality:</span>
            {lastScanDetails.eventType === 'CHECK_OUT' ? (
              <span className="text-blue-700 font-medium">Shift complete</span>
            ) : lastScanDetails.isLate ? (
              <span className="text-amber-700 font-medium">
                Late (+{lastScanDetails.lateDuration})
              </span>
            ) : isSuccess ? (
              <span className="text-emerald-700 font-medium">On time</span>
            ) : (
              <span className="text-red-700 font-medium">{lastScanDetails.message}</span>
            )}
          </div>
        </div>

        <div className="mt-4 w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-xs text-slate-500 flex items-center justify-between select-none">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
            <span>Ready for next scan in</span>
          </div>
          <span className="text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded text-xs font-semibold">
            {cooldownTimeLeft}s
          </span>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * ScannerConfidenceMeter
 * Renders the lock confidence bar under the camera video viewport.
 */
export function ScannerConfidenceMeter({
  cameraActive,
  cooldownState,
  realtimeScore
}) {
  if (!cameraActive || cooldownState) return null;

  return (
    <div className="w-full mt-4 space-y-1.5 px-1 select-none">
      <div className="flex justify-between items-center text-xs font-medium">
        <span className="text-slate-500">Biometric match confidence</span>
        <span className={realtimeScore >= 82 ? 'text-emerald-600 font-semibold' : 'text-indigo-600 font-medium'}>
          {realtimeScore > 0 ? `${realtimeScore}% aligned` : 'Searching for face...'}
        </span>
      </div>
      <div className="w-full h-2 bg-slate-100 border border-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-200 ${
            realtimeScore >= 82
              ? 'bg-emerald-500'
              : realtimeScore > 0
              ? 'bg-indigo-600'
              : 'bg-slate-300'
          }`}
          style={{ width: `${realtimeScore}%` }}
        />
      </div>
    </div>
  );
}

/**
 * ScannerControls
 * Action triggers to turn the biometric scanning hardware on/off.
 */
export function ScannerControls({
  cameraActive,
  onStopCamera
}) {
  if (!cameraActive) return null;

  return (
    <div className="mt-4 flex gap-3 justify-center">
      <button
        onClick={onStopCamera}
        className="inline-flex items-center gap-2 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-700 hover:text-red-700 text-xs sm:text-sm font-medium py-2.5 px-5 rounded-xl cursor-pointer transition-colors select-none min-h-[42px]"
      >
        <CameraOff className="w-4 h-4" /> Stop scanner
      </button>
    </div>
  );
}
