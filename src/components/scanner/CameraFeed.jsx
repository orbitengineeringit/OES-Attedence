import React from 'react';
import { RefreshCw, CameraOff, Camera } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';

/**
 * CameraFeed Component
 * Displays the live camera feed video stream or clean status screen matching current theme.
 */
export default function CameraFeed({ videoRef, cameraActive, modelsStatus, onStartCamera, isStarting }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

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
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-4 select-none p-6 text-center transition-colors ${
      isDark ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-800'
    }`}>
      {modelsStatus === 'loading' || isStarting ? (
        <div className={`p-3.5 rounded-2xl border shadow-sm ${
          isDark ? 'bg-indigo-500/10 border-indigo-400/20 text-indigo-400' : 'bg-indigo-50 border-indigo-200 text-indigo-600'
        }`}>
          <RefreshCw className="h-10 w-10 animate-spin" />
        </div>
      ) : (
        <div className={`p-3.5 rounded-2xl border shadow-sm ${
          isDark ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-white border-slate-200 text-slate-500'
        }`}>
          <CameraOff className="h-10 w-10" />
        </div>
      )}

      <div className="space-y-1">
        <p className={`text-base sm:text-lg font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {isStarting 
            ? 'Starting camera...' 
            : modelsStatus === 'loading' 
            ? 'Loading neural models...' 
            : 'Camera is ready'}
        </p>
        <p className={`max-w-sm mx-auto text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          {isStarting
            ? 'Connecting to camera hardware and checking permissions...'
            : modelsStatus === 'loading'
            ? 'Initializing face detection models in memory.'
            : 'Click the button below to start the camera and verify attendance.'}
        </p>
      </div>

      {modelsStatus === 'error' && onStartCamera && (
        <button
          onClick={() => window.location.reload()}
          className="mt-1 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 px-6 rounded-xl text-xs sm:text-sm cursor-pointer transition-colors shadow-xs"
        >
          <RefreshCw className="w-4 h-4 text-white" />
          Retry loading scanner
        </button>
      )}

      {modelsStatus === 'ready' && onStartCamera && (
        <button
          onClick={() => onStartCamera()}
          disabled={isStarting}
          className="mt-1 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-6 rounded-xl border border-indigo-600 text-xs sm:text-sm cursor-pointer transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px]"
        >
          {isStarting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              Starting camera...
            </>
          ) : (
            <>
              <Camera className="w-4 h-4 text-white" />
              Start face scanner
            </>
          )}
        </button>
      )}
    </div>
  );
}

