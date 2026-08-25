/**
 * Calculates the geodetic distance between two coordinates using the Haversine formula.
 * @param {number} lat1 Latitude of point 1
 * @param {number} lon1 Longitude of point 1
 * @param {number} lat2 Latitude of point 2
 * @param {number} lon2 Longitude of point 2
 * @returns {number} Distance in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (
    lat1 === undefined || lon1 === undefined ||
    lat2 === undefined || lon2 === undefined ||
    isNaN(lat1) || isNaN(lon1) ||
    isNaN(lat2) || isNaN(lon2)
  ) {
    return Infinity;
  }

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

  const distance = R * c; // in meters
  return distance;
};

/**
 * Calculates perpendicular/vertex distance from a point to a line segment in meters.
 */
const getDistanceToSegment = (py, px, y1, x1, y2, x2) => {
  const latToMeters = 111320;
  const lngToMeters = 111320 * Math.cos((y1 * Math.PI) / 180);
  
  const ax = 0;
  const ay = 0;
  const bx = (x2 - x1) * lngToMeters;
  const by = (y2 - y1) * latToMeters;
  const px_m = (px - x1) * lngToMeters;
  const py_m = (py - y1) * latToMeters;
  
  const r_x = bx - ax;
  const r_y = by - ay;
  const len2 = r_x * r_x + r_y * r_y;
  
  let t = 0;
  if (len2 > 0) {
    t = ((px_m - ax) * r_x + (py_m - ay) * r_y) / len2;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
  }
  
  const cx = ax + t * r_x;
  const cy = ay + t * r_y;
  
  const dx = px_m - cx;
  const dy = py_m - cy;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Calculates the minimum distance in meters from a point to a polygon boundary.
 */
export const getDistanceToPolygon = (pointLat, pointLng, polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length === 0) return Infinity;
  
  let minDistance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    
    const dist = getDistanceToSegment(pointLat, pointLng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  return minDistance;
};

/**
 * Validates if the coordinates are within the geofence radius (Legacy/Fallback).
 * @param {number} userLat Employee current latitude
 * @param {number} userLng Employee current longitude
 * @param {number} officeLat Office latitude
 * @param {number} officeLng Office longitude
 * @param {number} radius Allowed radius in meters
 * @returns {boolean}
 */
export const isInsideGeofence = (userLat, userLng, officeLat, officeLng, radius) => {
  const distance = calculateDistance(userLat, userLng, officeLat, officeLng);
  return distance <= radius;
};

/**
 * Validates if the coordinates are inside a polygon using Ray-Casting algorithm.
 * @param {number} pointLat User latitude
 * @param {number} pointLng User longitude
 * @param {Array<{lat: number, lng: number}>} polygon Boundary array
 * @returns {boolean}
 */
export const isPointInPolygon = (pointLat, pointLng, polygon) => {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return false;

  let isInside = false;
  const x = pointLng, y = pointLat;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  
  return isInside;
};

// Rolling cache for GPS accuracy readings to detect static mock location spoofing
const accuracyHistory = new Map();
const coordinateHistory = new Map();

/**
 * Parses an IP address string into a BigInt or number.
 */
function ipToNum(ip) {
  if (!ip) return null;
  if (ip.includes(':')) {
    // IPv6
    const parts = ip.split('::');
    let left = parts[0] ? parts[0].split(':') : [];
    let right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    const middle = Array(missing).fill('0');
    const full = [...left, ...middle, ...right];
    let bigInt = 0n;
    for (const h of full) {
      bigInt = (bigInt << 16n) + BigInt(parseInt(h || '0', 16));
    }
    return { type: 6, val: bigInt };
  } else {
    // IPv4
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let val = 0;
    for (const p of parts) {
      val = (val << 8) + parseInt(p, 10);
    }
    return { type: 4, val: val >>> 0 };
  }
}

/**
 * Checks if a client IP is within the configured allowed ranges.
 */
export function isIpInOfficeRange(ip, rangeStr) {
  if (!rangeStr || !ip) return true;
  let clientIp = ip.trim();
  if (clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7);
  }
  const clientParsed = ipToNum(clientIp);
  if (!clientParsed) return false;

  const blocks = rangeStr.split(',').map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const parts = block.split('/');
    const rangeIp = parts[0];
    const bitsStr = parts[1];
    const rangeParsed = ipToNum(rangeIp);
    if (!rangeParsed || rangeParsed.type !== clientParsed.type) continue;

    if (bitsStr === undefined) {
      if (clientParsed.val === rangeParsed.val) return true;
    } else {
      const bits = parseInt(bitsStr, 10);
      if (clientParsed.type === 4) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((clientParsed.val & mask) === (rangeParsed.val & mask)) return true;
      } else {
        const mask = bits === 0 ? 0n : ~((1n << BigInt(128 - bits)) - 1n);
        if ((clientParsed.val & mask) === (rangeParsed.val & mask)) return true;
      }
    }
  }
  return false;
}

/**
 * Updates coordinates for an employee, queries database geofence configurations, and returns status.
 * @param {string} employeeId Employee ID
 * @param {number} latitude Employee current latitude
 * @param {number} longitude Employee current longitude
 * @param {string} clientTimezone Client reported timezone
 * @param {number} accuracy GPS accuracy radius in meters
 * @param {string} clientIp Client IP address
 */
export const processGeofenceUpdate = async (employeeId, latitude, longitude, clientTimezone = null, accuracy = null, clientIp = null) => {
  const { getDb } = await import('../database/db.js');
  const { supabase, checkSupabaseConnection } = await import('../database/supabaseClient.js');
  
  const db = getDb();
  const isSupabaseLive = process.env.NODE_ENV === 'test' ? false : await checkSupabaseConnection();
  
  // Timezone check
  const allowedTimezones = ['Asia/Kolkata', 'Asia/Calcutta'];
  if (clientTimezone && !allowedTimezones.includes(clientTimezone)) {
    console.warn(`[GEOFENCE WARNING] Timezone mismatch: Client is ${clientTimezone}, expected Asia/Kolkata or Asia/Calcutta.`);
    return {
      latitude,
      longitude,
      distance: Infinity,
      radius: 0,
      isInside: false,
      message: 'Incorrect timezone configuration. Access denied.',
      reason: 'TIMEZONE_MISMATCH'
    };
  }

  // 1. Fetch Geofence Circular / Radius & IP Settings First
  let settings = {};
  try {
    if (isSupabaseLive) {
      const { data } = await supabase.from('settings').select('key, value').in('key', ['geofence_lat', 'geofence_lng', 'geofence_radius', 'office_ip_range']);
      if (data && data.length > 0) {
        data.forEach(row => {
          settings[row.key] = row.key === 'office_ip_range' ? row.value : parseFloat(row.value);
        });
      }
    }
  } catch (err) {
    console.warn('[GEOFENCE] Failed to fetch settings from Supabase:', err.message);
  }

  if (Object.keys(settings).length === 0) {
    try {
      const rows = await db.all("SELECT key, value FROM settings WHERE key IN ('geofence_lat', 'geofence_lng', 'geofence_radius', 'office_ip_range')");
      rows.forEach(row => {
        settings[row.key] = row.key === 'office_ip_range' ? row.value : parseFloat(row.value);
      });
    } catch (err) {
      console.warn('[GEOFENCE] Failed to fetch settings from SQLite:', err.message);
    }
  }

  // [IP RANGE CHECK]: Verify request IP belongs to office IP range if configured
  const officeIpRange = settings.office_ip_range;
  if (officeIpRange && clientIp) {
    const isIpValid = isIpInOfficeRange(clientIp, officeIpRange);
    if (!isIpValid) {
      console.warn(`[GEOFENCE WARNING] Office IP mismatch: Client IP is ${clientIp}, allowed ranges: ${officeIpRange}`);
      return {
        latitude,
        longitude,
        distance: Infinity,
        radius: 0,
        isInside: false,
        message: 'Security Verification: Access denied. Must be connected to office network.',
        reason: 'OFFICE_IP_MISMATCH'
      };
    }
  }

  // [GPS ACCURACY VARIANCE CHECK]: Reject if accuracy is unnaturally constant AND coordinates have absolutely zero variance (mock provider)
  if (accuracy !== null && accuracy < 15) {
    const key = employeeId || clientIp || 'global';
    
    // Track accuracy history
    let history = accuracyHistory.get(key) || [];
    history.push(accuracy);
    if (history.length > 3) {
      history.shift();
    }
    accuracyHistory.set(key, history);
    
    // Track coordinate history
    let coordsHist = coordinateHistory.get(key) || [];
    coordsHist.push({ lat: latitude, lng: longitude });
    if (coordsHist.length > 3) {
      coordsHist.shift();
    }
    coordinateHistory.set(key, coordsHist);
    
    if (history.length >= 3 && coordsHist.length >= 3) {
      const mean = history.reduce((sum, v) => sum + v, 0) / history.length;
      const variance = history.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / history.length;
      const stdDev = Math.sqrt(variance);
      
      const latMean = coordsHist.reduce((sum, c) => sum + c.lat, 0) / coordsHist.length;
      const latVar = coordsHist.reduce((sum, c) => sum + Math.pow(c.lat - latMean, 2), 0) / coordsHist.length;
      
      const lngMean = coordsHist.reduce((sum, c) => sum + c.lng, 0) / coordsHist.length;
      const lngVar = coordsHist.reduce((sum, c) => sum + Math.pow(c.lng - lngMean, 2), 0) / coordsHist.length;
      
      if (stdDev < 0.15 && latVar < 1e-12 && lngVar < 1e-12) {
        console.warn(`[GPS SPOOF DETECTED] Suspicously static GPS coordinates and accuracy detected (stdDev: ${stdDev.toFixed(4)}m, latVar: ${latVar.toExponential(4)}, lngVar: ${lngVar.toExponential(4)}): ${history.join(', ')}`);
        return {
          latitude,
          longitude,
          distance: Infinity,
          radius: 0,
          isInside: false,
          message: 'GPS signal static/simulated. Please move slightly to calibrate your location.',
          reason: 'STATIC_GPS_DETECTED'
        };
      }
    }
  }

  // Set default fallback office coordinates and radius settings
  const officeLat = settings.geofence_lat || 23.2168;
  const officeLng = settings.geofence_lng || 77.4250;
  const radius = settings.geofence_radius || 5000; // Default to 5000m geofence

  // 2. Retrieve Advanced Polygon Geofence
  let activeGeofence = null;
  try {
    if (isSupabaseLive) {
      const { data, error } = await supabase.from('office_geofence').select('polygon_coordinates').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!error && data) activeGeofence = data;
    }
  } catch (err) {
    console.warn('[GEOFENCE] Failed to load polygon from Supabase:', err.message);
  }

  if (!activeGeofence) {
    try {
      activeGeofence = await db.get(`SELECT polygon_coordinates FROM office_geofence ORDER BY created_at DESC LIMIT 1`);
    } catch (err) {
      console.warn('[GEOFENCE] Failed to load polygon from SQLite:', err.message);
    }
  }

  // Legacy distance comparison (+50m buffer)
  const circularDistance = calculateDistance(latitude, longitude, officeLat, officeLng);
  const isInsideCircular = circularDistance <= (radius + 50);
  console.log('[GEOFENCE VALIDATION] Legacy circular validation distance (meters):', circularDistance, 'isInsideCircular (with 50m buffer):', isInsideCircular);

  let isInside = false;
  let polygonBased = false;
  let isInsidePolygon = false;

  if (activeGeofence && activeGeofence.polygon_coordinates) {
    try {
      const polygon = typeof activeGeofence.polygon_coordinates === 'string' 
        ? JSON.parse(activeGeofence.polygon_coordinates) 
        : activeGeofence.polygon_coordinates;

      const normalizedPolygon = (Array.isArray(polygon) ? polygon : []).map(p => {
        if (!p || typeof p !== 'object') return null;
        const lat = p.lat !== undefined ? p.lat : p.latitude;
        const lng = p.lng !== undefined ? p.lng : p.longitude;
        return { lat: parseFloat(lat), lng: parseFloat(lng) };
      }).filter(p => p !== null && !isNaN(p.lat) && !isNaN(p.lng));

      isInsidePolygon = isPointInPolygon(latitude, longitude, normalizedPolygon);
      polygonBased = true;

      // Add 50-meter tolerance check if outside the polygon
      if (!isInsidePolygon) {
        const polyDist = getDistanceToPolygon(latitude, longitude, normalizedPolygon);
        console.log('[GEOFENCE VALIDATION] Distance to polygon boundary:', polyDist, 'meters');
        if (polyDist <= 50) {
          isInsidePolygon = true; // Approved within buffer
          console.log('[GEOFENCE VALIDATION] User within 50m polygon buffer.');
        }
      }

      isInside = isInsidePolygon || isInsideCircular;
    } catch (e) {
      console.error('[GEOFENCE PARSE ERROR]', e);
      isInside = isInsideCircular;
    }
  } else {
    isInside = isInsideCircular;
  }

  // 3. Velocity / Impossible Travel Speed validation (Only check if user is INSIDE geofence)
  if (isInside) {
    try {
      const prevEmp = await db.get(
        'SELECT last_latitude, last_longitude, last_location_time FROM employees WHERE id = ?',
        [employeeId]
      );
      if (prevEmp && prevEmp.last_latitude && prevEmp.last_longitude && prevEmp.last_location_time) {
        const lastTime = new Date(prevEmp.last_location_time).getTime();
        const nowTime = Date.now();
        const timeDelta = (nowTime - lastTime) / 1000; // in seconds
        
        if (timeDelta > 0 && timeDelta < 7200) { // 2-hour window
          const dist = calculateDistance(latitude, longitude, prevEmp.last_latitude, prevEmp.last_longitude);
          const speedKmh = (dist / timeDelta) * 3.6;
          console.log(`[VELOCITY CHECK] Distance: ${dist}m, Time Delta: ${timeDelta}s, Speed: ${speedKmh} km/h`);
          
          if (speedKmh > 150) {
            console.warn(`[VELOCITY BREACH] Employee ${employeeId} travelled at impossible speed: ${speedKmh.toFixed(2)} km/h`);
            return {
              latitude,
              longitude,
              distance: circularDistance,
              radius,
              isInside: false,
              message: 'Biometric Scanner Blocked: Impossible location travel velocity detected.',
              reason: 'velocity_breach'
            };
          }
        }
      }
    } catch (e) {
      console.error('[VELOCITY CHECK ERROR]', e);
    }
  }

  // 4. Save coordinates to employee record in SQLite & Supabase
  await db.run(
    'UPDATE employees SET latitude = ?, longitude = ?, last_latitude = ?, last_longitude = ?, last_location_time = ? WHERE id = ?',
    [latitude, longitude, latitude, longitude, new Date().toISOString(), employeeId]
  );

  if (isSupabaseLive) {
    await supabase.from('employees').update({ latitude, longitude }).eq('id', employeeId);
  }

  // 5. [C-07 FIX]: BYPASS_GEOFENCE env flag hardened.
  // - Blocked entirely in production environments.
  // - Emits a CRITICAL_SECURITY_OVERRIDE audit log when active in any other env.
  const BYPASS_GEOFENCE = process.env.BYPASS_GEOFENCE === 'true';
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  let finalInside = isInside;

  if (BYPASS_GEOFENCE) {
    if (isProduction) {
      console.error('[GEOFENCE BYPASS BLOCKED]: BYPASS_GEOFENCE=true is not permitted in production. Enforcing normal geofence check.');
    } else {
      console.warn('[GEOFENCE OVERRIDE ACTIVE] BYPASS_GEOFENCE=true is overriding geofence result. AUDIT LOG EMITTED.');
      // Emit audit log for the security override — always visible in audit trail
      try {
        const { getDb } = await import('../database/db.js');
        const overrideDb = getDb();
        await overrideDb.run(
          `INSERT INTO audit_logs (employee_id, event_type, details, ip_address) VALUES (?, ?, ?, ?)`,
          [employeeId || null, 'CRITICAL_SECURITY_OVERRIDE', JSON.stringify({ override: 'BYPASS_GEOFENCE', env: process.env.NODE_ENV }), 'system']
        );
      } catch (auditErr) {
        console.error('[BYPASS AUDIT LOG ERROR]:', auditErr);
      }
      finalInside = true;
    }
  }

  return {
    latitude,
    longitude,
    distance: circularDistance,
    radius,
    isInside: finalInside,
    polygonBased,
    polygonVerificationPassed: isInsidePolygon,
    circularFallbackPassed: isInsideCircular
  };
};
