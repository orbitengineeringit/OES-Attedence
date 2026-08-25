import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { apiCall } from '../services/api.js';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, Compass, CheckCircle2, HelpCircle, Move, LocateFixed } from 'lucide-react';

function ChangeMapView({ center }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    try {
      const container = map.getContainer();
      if (!container) return;
      if (center && center[0] && center[1] && !isNaN(center[0]) && !isNaN(center[1])) map.setView(center, map.getZoom());
    } catch (e) {
      console.warn('[ChangeMapView Cleanup Guard]: Map is unmounted.', e);
    }
  }, [center, map]);
  return null;
}

const officeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const employeeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function GeofenceSandbox() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const mapTileUrl = theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [officeCoords, setOfficeCoords] = useState([28.6139, 77.2090]);
  const [geofenceRadius, setGeofenceRadius] = useState(50);
  const [empCoords, setEmpCoords] = useState([28.6142, 77.2093]);
  const [telemetry, setTelemetry] = useState({ distance: 0, status: 'Outside Office', transition: null });
  const [updating, setUpdating] = useState(false);
  const markerRef = useRef(null);
  const isComponentMounted = useRef(true);
  const mapRef = useRef(null);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
        } catch (e) {
          console.warn('[GeofenceSandbox Cleanup Warning]:', e);
        }
      }
    };
  }, []);

  const syncCoordinates = async (lat, lng) => {
    if (!user) return;
    if (isComponentMounted.current) setUpdating(true);
    try {
      const response = await apiCall(`/employees/${user?.id}/coordinates`, 'POST', { latitude: lat, longitude: lng });
      if (response.success && isComponentMounted.current) {
        setTelemetry({
          distance: response.data.distance,
          status: response.data.status,
          transition: response.data.transition
        });
      }
    } catch (err) {
      console.error('[GEOFENCE SYNC ERROR]: Failed updating GPS metrics:', err);
    } finally {
      if (isComponentMounted.current) setUpdating(false);
    }
  };

  useEffect(() => {
    isComponentMounted.current = true;
    if (!user) return;
    const controller = new AbortController();
    const initSandbox = async () => {
      try {
        const response = await apiCall('/settings', 'GET');
        if (controller.signal.aborted || !isComponentMounted.current) return;
        let lat = 28.6139;
        let lng = 77.2090;
        let radius = 50;
        if (response.success && response.settings) {
          lat = Number(response.settings.geofence_lat) || 28.6139;
          lng = Number(response.settings.geofence_lng) || 77.2090;
          radius = Number(response.settings.geofence_radius) || 50;
          setOfficeCoords([lat, lng]);
          setGeofenceRadius(radius);
        }
        const initialEmp = [Number(lat) + 0.0003, Number(lng) + 0.0003];
        setEmpCoords(initialEmp);
        await syncCoordinates(initialEmp[0], initialEmp[1]);
      } catch (err) {
        if (!controller.signal.aborted) console.error('[SETTINGS FETCH ERROR]:', err);
      } finally {
        if (isComponentMounted.current) setLoadingSettings(false);
      }
    };
    initSandbox();
    return () => {
      isComponentMounted.current = false;
      controller.abort();
    };
  }, [user]);

  const handleMarkerDragEnd = () => {
    const marker = markerRef.current;
    if (!marker) return;
    const { lat, lng } = marker.getLatLng();
    const newCoords = [parseFloat(lat.toFixed(6)), parseFloat(lng.toFixed(6))];
    setEmpCoords(newCoords);
    syncCoordinates(newCoords[0], newCoords[1]);
  };

  const teleportInside = () => {
    const insideCoords = [officeCoords[0] + 0.00002, officeCoords[1] + 0.00002];
    setEmpCoords(insideCoords);
    syncCoordinates(insideCoords[0], insideCoords[1]);
  };

  const teleportOutside = () => {
    const outsideCoords = [officeCoords[0] + 0.0016, officeCoords[1] + 0.002];
    setEmpCoords(outsideCoords);
    syncCoordinates(outsideCoords[0], outsideCoords[1]);
  };

  const inside = telemetry.status === 'Inside Office';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }} 
      animate={{ opacity: 1, y: 0 }} 
      transition={{ duration: 0.35 }} 
      className="grid grid-cols-1 gap-6 lg:grid-cols-3"
    >
      {/* Map Sandbox Container */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm lg:col-span-2">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-indigo-600">
              <Compass className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Geofence sandbox</h2>
              <p className="text-xs text-slate-500">Drag the employee pin to test real-time boundary updates.</p>
            </div>
          </div>
          <span className="ui-badge badge-neutral">
            <Move className="h-3 w-3" />
            Interactive simulation
          </span>
        </div>

        <div className="p-4">
          <div className="h-[400px] w-full overflow-hidden rounded-xl border border-slate-200">
            {loadingSettings ? (
              <div className="flex h-full w-full items-center justify-center bg-slate-50 text-xs text-slate-500">
                Loading office location...
              </div>
            ) : (
              <MapContainer key="sandbox-geofence-map-static" ref={mapRef} center={officeCoords} zoom={17} scrollWheelZoom className="h-full w-full">
                <ChangeMapView center={officeCoords} />
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url={mapTileUrl} />
                <Circle center={officeCoords} radius={geofenceRadius} pathOptions={{ color: inside ? '#10B981' : '#4F46E5', fillColor: inside ? '#10B981' : '#4F46E5', fillOpacity: 0.1, weight: 1.5, dashArray: '5, 10' }} />
                <Marker position={officeCoords} icon={officeIcon}>
                  <Popup>
                    <div className="text-xs leading-normal text-slate-900">
                      <p className="font-semibold">Headquarters</p>
                      <p>Radius: {geofenceRadius}m</p>
                    </div>
                  </Popup>
                </Marker>
                <Marker position={empCoords} draggable eventHandlers={{ dragend: handleMarkerDragEnd }} ref={markerRef} icon={employeeIcon}>
                  <Popup>
                    <div className="text-xs leading-normal text-slate-900">
                      <p className="font-semibold">Simulated employee location</p>
                      <p>Drag pin to move</p>
                    </div>
                  </Popup>
                </Marker>
              </MapContainer>
            )}
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <HelpCircle className="h-3.5 w-3.5" />
            Drag the employee pin or click the quick simulation pills to calculate boundary transitions.
          </div>
        </div>
      </div>

      {/* Telemetry & Quick Simulation Panel */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className={`flex items-center gap-3 rounded-xl border p-3.5 ${inside ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
            <div className="rounded-lg bg-white p-2 shadow-xs">
              <MapPin className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-medium">Current status</p>
              <h3 className="mt-0.5 text-sm font-semibold">{telemetry.status}</h3>
            </div>
          </div>

          <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Distance</span>
              <span className="font-semibold text-slate-900">{telemetry.distance.toFixed(1)}m / {geofenceRadius.toFixed(1)}m</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Latitude</span>
              <span className="font-medium text-slate-700">{empCoords[0]}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Longitude</span>
              <span className="font-medium text-slate-700">{empCoords[1]}</span>
            </div>
          </div>

          {/* Clean Outlined / Filled Pill Buttons */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3">
            <button 
              onClick={teleportInside} 
              disabled={updating} 
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium border transition-colors cursor-pointer min-h-[40px] ${
                inside 
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold shadow-xs' 
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              Inside office
            </button>
            <button 
              onClick={teleportOutside} 
              disabled={updating} 
              className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium border transition-colors cursor-pointer min-h-[40px] ${
                !inside 
                  ? 'border-slate-400 bg-slate-100 text-slate-800 font-semibold shadow-xs' 
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              Outside office
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Latitude</label>
              <input type="number" step="0.0001" value={empCoords[0]} onChange={(e) => { const lat = parseFloat(e.target.value) || 0; const next = [lat, empCoords[1]]; setEmpCoords(next); syncCoordinates(next[0], next[1]); }} className="w-full text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Longitude</label>
              <input type="number" step="0.0001" value={empCoords[1]} onChange={(e) => { const lng = parseFloat(e.target.value) || 0; const next = [empCoords[0], lng]; setEmpCoords(next); syncCoordinates(next[0], next[1]); }} className="w-full text-xs" />
            </div>
          </div>
        </div>

        {telemetry.transition && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <h5 className="text-xs font-semibold text-emerald-800">Boundary event logged</h5>
                <p className="mt-0.5 text-xs text-slate-600">Transition: <span className="font-semibold text-slate-900">{telemetry.transition}</span></p>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
