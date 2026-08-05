import React from 'react';
import { motion } from 'framer-motion';
import { 
  Camera, 
  CameraOff, 
  RefreshCw, 
  ShieldCheck, 
  ShieldX,
  Target,
  UserCheck,
  Zap
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
  telemetryLockProgress
}) {
  if (!cameraActive || cooldownState) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-md border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500 leading-relaxed select-none shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
        <span className="text-slate-900 font-semibold">Scanner active</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Status:</span>
        <span className="text-indigo-600 font-medium">{scannerStatusMsg}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Pose:</span>
        <span className={`font-medium ${telemetryPose === 'front' ? 'text-emerald-600' : 'text-amber-600'}`}>
          {telemetryPose === 'none' ? 'CALIBRATING...' : telemetryPose}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">Align:</span>
        <span className="text-slate-700 font-medium">{telemetryLockProgress}%</span>
        {telemetryLockProgress >= 100 && (
          <motion.span 
            animate={{ opacity: [1, 0, 1] }} 
            transition={{ repeat: Infinity, duration: 1 }}
            className="text-emerald-600 font-semibold ml-1"
          >
            LOCKED
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}

/**
 * ScannerCooldownOverlay
 * Renders the full-viewport attendance result card.
 */
export function ScannerCooldownOverlay({
  cooldownState,
  lastScanDetails,
  cooldownTimeLeft
}) {
  if (!cooldownState || !lastScanDetails) return null;

  const isSuccess = lastScanDetails.success;

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/92 backdrop-blur-md p-6 text-center">
      {/* Laser scan line overlay */}
      <div className={`absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent ${
        isSuccess ? 'via-indigo-500' : 'via-rose-500'
      } to-transparent animate-laser-sweep`}></div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', damping: 25 }}
        className="w-full max-w-sm bg-white rounded-2xl p-6 relative overflow-hidden border border-slate-200 flex flex-col items-center shadow-[0_12px_32px_rgba(15,23,42,0.08)]"
      >
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-indigo-50 rounded-full blur-2xl pointer-events-none"></div>
        <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-sky-50 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="relative mb-4">
          <div className="absolute -inset-1 rounded-full border border-indigo-100 animate-pulse"></div>
          <div className={`relative p-3.5 rounded-full border bg-white ${isSuccess ? 'border-emerald-100 text-emerald-600' : 'border-rose-100 text-rose-600'}`}>
            {isSuccess ? <ShieldCheck className="w-7 h-7" /> : <ShieldX className="w-7 h-7" />}
          </div>
        </div>

        <span className={`text-[11px] font-semibold tracking-wider uppercase mb-1 ${isSuccess ? 'text-emerald-600' : 'text-rose-600'}`}>
          {isSuccess ? 'BIOMETRIC PUNCH SUCCESSFUL' : 'BIOMETRIC PUNCH REJECTED'}
        </span>
        
        <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-0.5">
          {lastScanDetails.name}
        </h3>
        <span className="text-[11px] text-slate-500 uppercase tracking-wide mb-4">
          {isSuccess ? 'SUBJECT IDENTITY SECURELY ENROLLED' : 'AUTH ATTEMPT BLOCKED'}
        </span>

        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[11px] space-y-2.5 text-left relative z-10">
          <div className="flex justify-between border-b border-slate-200 pb-1.5">
            <span className="text-slate-400">Subject ID:</span>
            <span className="text-slate-900 font-medium">{lastScanDetails.id}</span>
          </div>
          <div className="flex justify-between border-b border-slate-200 pb-1.5">
            <span className="text-slate-400">Department:</span>
            <span className="text-slate-700 uppercase truncate max-w-[140px]">{lastScanDetails.department}</span>
          </div>
          {isSuccess && (
            <div className="flex justify-between border-b border-slate-200 pb-1.5">
              <span className="text-slate-400">Accuracy:</span>
              <span className="text-emerald-600 font-medium">
                {Math.round(lastScanDetails.confidence * 100)}% Match
              </span>
            </div>
          )}
          <div className="flex justify-between border-b border-slate-200 pb-1.5">
            <span className="text-slate-400">Event:</span>
            <span className={`font-medium px-1.5 py-0.5 rounded text-[10px] tracking-wide ${
              lastScanDetails.eventType === 'CHECK_IN'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                : lastScanDetails.eventType === 'CHECK_OUT'
                ? 'bg-sky-50 text-sky-700 border border-sky-100'
                : 'bg-rose-50 text-rose-700 border border-rose-100'
            }`}>
              {lastScanDetails.eventType}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-200 pb-1.5">
            <span className="text-slate-400">Timestamp:</span>
            <span className="text-slate-700">{lastScanDetails.scanTime}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Punctuality:</span>
            {lastScanDetails.eventType === 'CHECK_OUT' ? (
              <span className="text-sky-700 font-medium uppercase tracking-wide">Shift end</span>
            ) : lastScanDetails.isLate ? (
              <span className="text-rose-600 font-medium uppercase">
                LATE (+{lastScanDetails.lateDuration})
              </span>
            ) : isSuccess ? (
              <span className="text-emerald-600 font-medium uppercase tracking-wide">On time</span>
            ) : (
              <span className="text-rose-600 font-medium uppercase">{lastScanDetails.message}</span>
            )}
          </div>
        </div>

        <div className="mt-4 w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-[11px] text-slate-500 flex items-center justify-between select-none">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin text-indigo-500" />
            <span>Reset timer</span>
          </div>
          <span className="text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded font-medium">
            {cooldownTimeLeft}S
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
      <div className="flex justify-between items-center text-[11px] font-medium">
        <span className="text-slate-500 tracking-wide">Biometric match quality</span>
        <span className={`${realtimeScore >= 82 ? 'text-emerald-600' : 'text-indigo-600'} tracking-wide`}>
          {realtimeScore > 0 ? `${realtimeScore}% lock` : 'Searching target...'}
        </span>
      </div>
      <div className="w-full h-2 bg-slate-100 border border-slate-200 rounded-full overflow-hidden p-[1px]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            realtimeScore >= 82
              ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
              : realtimeScore > 0
              ? 'bg-gradient-to-r from-indigo-400 to-sky-500'
              : 'bg-slate-300'
          }`}
          style={{ width: `${realtimeScore}%` }}
        ></div>
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
  modelsStatus,
  onStartCamera,
  onStopCamera,
  isStarting
}) {
  return (
    <div className="mt-6 flex gap-4 justify-center">
      {cameraActive ? (
        <button
          onClick={onStopCamera}
          className="flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 text-sm font-semibold py-2.5 px-4 rounded-xl cursor-pointer transition-all select-none active:scale-[0.98]"
        >
          <CameraOff className="w-3.5 h-3.5" /> Stop Scanner
        </button>
      ) : (
        <button
          onClick={() => onStartCamera()}
          disabled={modelsStatus !== 'ready' || isStarting}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-sky-500 hover:from-indigo-500 hover:to-sky-400 text-white font-semibold py-2.5 px-5 rounded-xl border border-indigo-100 text-sm cursor-pointer transition-all duration-200 select-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {modelsStatus === 'loading' || isStarting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
              {isStarting ? 'Starting Scanner...' : 'Booting engines...'}
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5 text-white" />
              Start Scanner
            </>
          )}
        </button>
      )}
    </div>
  );
}
