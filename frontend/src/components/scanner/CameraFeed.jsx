import React from 'react';
import { RefreshCw, CameraOff, Camera } from 'lucide-react';

/**
 * CameraFeed Component
 * Displays the live camera feed video stream or appropriate system status screens (loading models / hardware offline).
 */
export default function CameraFeed({ videoRef, cameraActive, modelsStatus, onStartCamera, isStarting }) {
  if (cameraActive) {
    return (
      <video
        ref={videoRef}
        className="w-full h-full object-cover scale-x-[-1]"
        muted
        playsInline
        id="biometric-video-element"
      />
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600 select-none">
      {modelsStatus === 'loading' || isStarting ? (
        <RefreshCw className="h-10 w-10 animate-spin text-indigo-600" />
      ) : (
        <CameraOff className="h-10 w-10 text-slate-400 animate-pulse" />
      )}
      <p className="text-sm font-semibold text-slate-700">
        {isStarting ? 'Starting Scanner...' : modelsStatus === 'loading' ? 'Loading biometric models...' : 'Scanner is Ready'}
      </p>
      <p className="max-w-xs px-6 text-center text-xs leading-relaxed text-slate-500 mb-2">
        {isStarting
          ? 'Connecting to camera hardware and resolving permissions...'
          : modelsStatus === 'loading'
          ? 'Preparing face detection and landmark models.'
          : 'To check in or out, activate the biometric scanner lens below.'}
      </p>
      {modelsStatus === 'ready' && onStartCamera && (
        <button
          onClick={() => onStartCamera()}
          disabled={isStarting}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-sky-500 hover:from-indigo-500 hover:to-sky-400 text-white font-semibold py-2.5 px-5 rounded-xl border border-indigo-100 text-xs cursor-pointer transition-all duration-200 shadow-[0_4px_12px_rgba(79,70,229,0.18)] hover:shadow-[0_8px_20px_rgba(79,70,229,0.22)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStarting ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
              Starting Scanner...
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5 text-white" />
              Activate Scanner
            </>
          )}
        </button>
      )}
    </div>
  );
}






