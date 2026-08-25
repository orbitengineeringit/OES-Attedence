process.env.DB_FILE = './api_test_database.sqlite';
process.env.JWT_SECRET = 'super-secure-long-test-jwt-secret-key-32chars!';
process.env.ALLOW_MOCK_AUTH = 'true';

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import { initializeDatabase, getDb } from '../database/db.js';
import { descriptorCache } from '../services/descriptorCache.js';
import authRoutes from '../routes/auth.js';
import employeeRoutes from '../routes/employees.js';
import attendanceRoutes from '../routes/attendance.js';
import settingsRoutes from '../routes/settings.js';
import logsRoutes from '../routes/logs.js';

describe('HTTP API Endpoints Integration Tests', () => {
  let app;
  let server;
  let baseUrl;
  let adminToken;
  let employeeToken;

  // Helper to generate orthogonal 128-float descriptors to prevent duplicate checks failing
  function generateTestDescriptor(seed = 0.1) {
    const descriptor = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      descriptor[i] = Math.sin((i + 1) * seed * 123.456);
    }
    return Array.from(descriptor);
  }

  // Helper to fetch a valid challenge session from the server
  async function fetchChallengeSession() {
    const res = await fetch(`${baseUrl}/attendance/challenge`);
    const data = await res.json();
    return {
      challengeSessionId: data.challengeSessionId,
      challengeType: data.challengeType
    };
  }

  // Helper to build liveness metrics that satisfy verifyLiveness rules
  function buildFaceMetrics(challengeType, livenessPassed = true) {
    if (!livenessPassed) {
      return { blinkDetected: false, challengeType, challengePassed: false, headTurnRatio: 0.5, landmarks: [] };
    }
    if (challengeType === 'turn_left') {
      return { blinkDetected: true, challengeType, challengePassed: true, headTurnRatio: 0.1, landmarks: [] };
    } else if (challengeType === 'turn_right') {
      return { blinkDetected: true, challengeType, challengePassed: true, headTurnRatio: 0.9, landmarks: [] };
    } else {
      return { blinkDetected: true, challengeType, challengePassed: true, headTurnRatio: 0.5, landmarks: [] };
    }
  }

  beforeAll(async () => {
    // [C-03 TEST FIX]: Enable mock auth tokens for the test environment.
    process.env.ALLOW_MOCK_AUTH = 'true';

    if (fs.existsSync('./api_test_database.sqlite')) {
      try {
        fs.unlinkSync('./api_test_database.sqlite');
      } catch (e) {}
    }

    // 1. Initialize SQLite Database
    const db = await initializeDatabase();
    await db.run("DELETE FROM attendance");
    await db.run("DELETE FROM face_descriptors");
    await db.run("UPDATE employees SET face_data = NULL"); // Clear default biometrics to avoid duplicate checks failing
    await db.run("DELETE FROM settings WHERE key = 'office_ip_range'");
    
    descriptorCache.cache.clear();
    await descriptorCache.initialize(db);

    // 2. Set up lightweight Express App
    app = express();
    app.use(express.json({ limit: '5mb' }));

    // Mock IO and attach services to locals
    app.locals.db = db;
    app.locals.descriptorCache = descriptorCache;
    app.locals.io = { emit: () => {} };

    // Mount API Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/employees', employeeRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/settings', settingsRoutes);
    app.use('/api/logs', logsRoutes);

    // Start server on a dynamic port
    server = app.listen(0);
    const { port } = server.address();
    baseUrl = `http://localhost:${port}/api`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('POST /auth/login - Admin Bypass Login succeeds', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'hr.orbitengineering.group@gmail.com',
        password: 'admin@2026'
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.user.role).toBe('admin');
    
    adminToken = data.token;
  });

  test('POST /auth/login - Employee Login succeeds', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'employee@company.com',
        password: 'employeepassword'
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.user.role).toBe('employee');

    employeeToken = data.token;
  });

  test('POST /auth/login - Mismatched credentials returns 401', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'employee@company.com',
        password: 'wrong_password'
      })
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  test('GET /employees - Admin allowed, Employee returns 403', async () => {
    const resEmp = await fetch(`${baseUrl}/employees`, {
      headers: { 'Authorization': `Bearer mock-employee-token-9824` }
    });
    expect(resEmp.status).toBe(403);

    const resAdmin = await fetch(`${baseUrl}/employees`, {
      headers: { 'Authorization': `Bearer mock-admin-token-9824` }
    });
    expect(resAdmin.status).toBe(200);
    const data = await resAdmin.json();
    expect(data.success).toBe(true);
    expect(data.employees).toBeInstanceOf(Array);
  });

  test('GET /logs/audit - Admin allowed, Employee returns 403', async () => {
    const resEmp = await fetch(`${baseUrl}/logs/audit`, {
      headers: { 'Authorization': `Bearer mock-employee-token-9824` }
    });
    expect(resEmp.status).toBe(403);

    const resAdmin = await fetch(`${baseUrl}/logs/audit`, {
      headers: { 'Authorization': `Bearer mock-admin-token-9824` }
    });
    expect(resAdmin.status).toBe(200);
    const data = await resAdmin.json();
    expect(data.success).toBe(true);
    expect(data.logs).toBeInstanceOf(Array);
  });

  test('GET /logs/audit?format=csv - Neutralizes CSV Formula Injection', async () => {
    // 1. Submit a scan request with a formula injection User-Agent header
    const maliciousUserAgent = '=1+2';
    await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer mock-employee-token-9824`,
        'Content-Type': 'application/json',
        'User-Agent': maliciousUserAgent
      },
      body: JSON.stringify({
        challengeSessionId: 'invalid-session-for-injection-test',
        faceDescriptor: new Array(128).fill(0),
        userCoords: { latitude: 23.217024, longitude: 77.424507, accuracy: 10 }
      })
    });

    // 2. Fetch the audit logs as CSV
    const resCsv = await fetch(`${baseUrl}/logs/audit?format=csv`, {
      headers: { 'Authorization': `Bearer mock-admin-token-9824` }
    });
    expect(resCsv.status).toBe(200);
    const csvText = await resCsv.text();

    // 3. Verify that the malicious userAgent is neutralized with a leading single quote
    expect(csvText).toContain(`'=1+2`);
  });

  test('POST /attendance/public-scan - Spoof attempt is rejected', async () => {
    const desc = generateTestDescriptor(0.15);
    const { challengeSessionId, challengeType } = await fetchChallengeSession();
    const res = await fetch(`${baseUrl}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245 },
        faceMetrics: buildFaceMetrics(challengeType, false),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.reason).toBe('LIVENESS_FAILED');
  });

  test('POST /attendance/public-scan - Invalid Geofence coordinates rejected', async () => {
    process.env.BYPASS_GEOFENCE = 'false';
    const desc = generateTestDescriptor(0.15);
    const { challengeSessionId, challengeType } = await fetchChallengeSession();
    const res = await fetch(`${baseUrl}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 0, longitude: 0 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.reason).toBe('GEOFENCE_INVALID');
  });

  test('POST /attendance/public-scan - Velocity breach detects impossible travel speed', async () => {
    process.env.BYPASS_GEOFENCE = 'true';
    const desc = generateTestDescriptor(0.18);
    const db = getDb();
    
    const testEmpId = 'OES/TEMP_VEL';
    await db.run('DELETE FROM employees WHERE id = ?', [testEmpId]);
    await db.run(
      "INSERT INTO employees (id, name, email, password, role, department, last_latitude, last_longitude, last_location_time) VALUES (?, 'Velocity Test', 'vel@test.com', 'pass', 'employee', 'QA', ?, ?, ?)",
      [testEmpId, 23.2170, 77.4245, new Date(Date.now() - 2000).toISOString()]
    );

    descriptorCache.set(testEmpId, 'Velocity Test', 'vel@test.com', 'employee', desc);

    const { challengeSessionId, challengeType } = await fetchChallengeSession();
    const res = await fetch(`${baseUrl}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 28.6139, longitude: 77.2090 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });

    process.env.BYPASS_GEOFENCE = 'false';

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.reason).toBe('VELOCITY_BREACH');

    descriptorCache.remove(testEmpId);
  });

  test('POST /attendance/scan - Personal scan workflow', async () => {
    const desc = generateTestDescriptor(0.22);
    const db = getDb();
    
    await db.run("DELETE FROM attendance WHERE employee_id = 'OES/038'");
    await db.run("DELETE FROM face_descriptors WHERE employee_id = 'OES/038'");
    descriptorCache.remove('OES/038');
    
    const registerRes = await fetch(`${baseUrl}/employees/OES/038/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        avatar: 'test-face.jpg'
      })
    });
    expect(registerRes.status).toBe(200);

    const gpsSession = await fetchChallengeSession();
    const gpsRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        faceMetrics: buildFaceMetrics(gpsSession.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: gpsSession.challengeSessionId
      })
    });
    expect(gpsRes.status).toBe(400);
    const gpsData = await gpsRes.json();
    expect(gpsData.success).toBe(false);
    expect(gpsData.reason).toBe('GPS_UNAVAILABLE');

    const livenessSession = await fetchChallengeSession();
    const livenessRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245 },
        faceMetrics: buildFaceMetrics(livenessSession.challengeType, false),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: livenessSession.challengeSessionId
      })
    });
    expect(livenessRes.status).toBe(403);
    const livenessData = await livenessRes.json();
    expect(livenessData.success).toBe(false);
    expect(livenessData.reason).toBe('LIVENESS_FAILED');

    const wrongDesc = generateTestDescriptor(0.38);
    const faceSession = await fetchChallengeSession();
    const faceRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        faceDescriptor: wrongDesc,
        userCoords: { latitude: 23.2170, longitude: 77.4245 },
        faceMetrics: buildFaceMetrics(faceSession.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: faceSession.challengeSessionId
      })
    });
    expect(faceRes.status).toBe(401);
    const faceData = await faceRes.json();
    expect(faceData.success).toBe(false);
    expect(faceData.reason).toBe('FACE_NOT_RECOGNIZED');

    const validSession = await fetchChallengeSession();
    const validRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245 },
        faceMetrics: buildFaceMetrics(validSession.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: validSession.challengeSessionId
      })
    });
    expect(validRes.status).toBe(200);
    const validData = await validRes.json();
    expect(validData.success).toBe(true);
    expect(validData.eventType).toBe('CHECK_IN');
  }, 15000);

  test('POST /attendance/scan - Static fake-GPS accuracy is rejected', async () => {
    // Use a completely separate employee to prevent velocity check conflicts with OES/038
    const db = getDb();
    const gpsEmpId = 'OES/TEMP_GPS';
    await db.run('DELETE FROM employees WHERE id = ?', [gpsEmpId]);
    await db.run('DELETE FROM face_descriptors WHERE employee_id = ?', [gpsEmpId]);
    descriptorCache.remove(gpsEmpId);

    await db.run(
      "INSERT INTO employees (id, name, email, password, role, department) VALUES (?, 'GPS Test', 'gpstest@test.com', 'pass', 'employee', 'QA')",
      [gpsEmpId]
    );

    const jwt = await import('jsonwebtoken');
    const gpsEmpToken = jwt.default.sign(
      { id: gpsEmpId, email: 'gpstest@test.com', role: 'employee' },
      process.env.JWT_SECRET || 'fallback-secret-local-only',
      { expiresIn: '1h' }
    );

    const desc = generateTestDescriptor(0.44);
    
    // Register face biometrics
    const regRes = await fetch(`${baseUrl}/employees/${gpsEmpId}/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        avatar: 'test-face.jpg'
      })
    });
    expect(regRes.status).toBe(200);

    const mockCoords = { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 };
    
    const d1 = await fetchChallengeSession();
    const res1 = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gpsEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: mockCoords,
        faceMetrics: buildFaceMetrics(d1.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: d1.challengeSessionId
      })
    });
    expect(res1.status).toBe(200);

    const d2 = await fetchChallengeSession();
    const res2 = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gpsEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: mockCoords,
        faceMetrics: buildFaceMetrics(d2.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: d2.challengeSessionId
      })
    });
    expect(res2.status).toBe(200);

    const d3 = await fetchChallengeSession();
    const res3 = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gpsEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: mockCoords,
        faceMetrics: buildFaceMetrics(d3.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: d3.challengeSessionId
      })
    });
    
    expect(res3.status).toBe(403);
    const data3 = await res3.json();
    expect(data3.success).toBe(false);
    expect(data3.reason).toBe('STATIC_GPS_DETECTED');

    await db.run('DELETE FROM employees WHERE id = ?', [gpsEmpId]);
    await db.run('DELETE FROM face_descriptors WHERE employee_id = ?', [gpsEmpId]);
    descriptorCache.remove(gpsEmpId);
  }, 15000);

  test('POST /attendance/scan - Office WiFi IP range check is enforced', async () => {
    const desc = generateTestDescriptor(0.22);
    const db = getDb();
    
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('office_ip_range', '192.168.12.0/24')");
    
    const d = await fetchChallengeSession();
    const res = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${employeeToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 8.2 },
        faceMetrics: buildFaceMetrics(d.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: d.challengeSessionId
      })
    });
    
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.reason).toBe('OFFICE_IP_MISMATCH');
    
    await db.run("DELETE FROM settings WHERE key = 'office_ip_range'");
  }, 15000);

  test('Timezone - date lands on Asia/Kolkata boundaries correctly', () => {
    const timeBeforeMidnightUTC = new Date('2026-08-11T18:35:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(timeBeforeMidnightUTC);
    const date1 = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    expect(date1).toBe('2026-08-12');
    
    const timeAfterMidnightUTC = new Date('2026-08-12T18:25:00Z');
    vi.setSystemTime(timeAfterMidnightUTC);
    const date2 = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    expect(date2).toBe('2026-08-12');
    
    vi.useRealTimers();
  });

  test('POST /employees/:id/face - Blurry or dark image enrollment is rejected', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const imagePath = path.resolve('server/tests/fixtures/low_light.jpg');
    const imageBuffer = fs.readFileSync(imagePath);
    const photoDataBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    
    const desc = generateTestDescriptor(0.22);
    const res = await fetch(`${baseUrl}/employees/OES/038/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        avatar: photoDataBase64
      })
    });
    
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.reason).toBe('ENROLLMENT_QUALITY_FAILED');
  }, 15000);

  test('Liveness Session Nonces - rejects expired, replayed, or invalid session IDs', async () => {
    // Use a completely separate employee to prevent velocity check conflicts with other tests
    const db = getDb();
    const nonceEmpId = 'OES/TEMP_NONCE';
    await db.run('DELETE FROM employees WHERE id = ?', [nonceEmpId]);
    await db.run('DELETE FROM face_descriptors WHERE employee_id = ?', [nonceEmpId]);
    descriptorCache.remove(nonceEmpId);

    await db.run(
      "INSERT INTO employees (id, name, email, password, role, department) VALUES (?, 'Nonce Test', 'noncetest@test.com', 'pass', 'employee', 'QA')",
      [nonceEmpId]
    );

    const jwt = await import('jsonwebtoken');
    const nonceEmpToken = jwt.default.sign(
      { id: nonceEmpId, email: 'noncetest@test.com', role: 'employee' },
      process.env.JWT_SECRET || 'fallback-secret-local-only',
      { expiresIn: '1h' }
    );

    const desc = generateTestDescriptor(0.48);
    
    // Register face biometrics
    const regRes = await fetch(`${baseUrl}/employees/${nonceEmpId}/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        avatar: 'test-face.jpg'
      })
    });
    expect(regRes.status).toBe(200);

    const { challengeSessionId, challengeType } = await fetchChallengeSession();
    
    const fakeRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nonceEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: 'invalid-session-uuid-123'
      })
    });
    expect(fakeRes.status).toBe(400);
    const fakeData = await fakeRes.json();
    expect(fakeData.reason).toBe('LIVENESS_FAILED');
    expect(fakeData.message).toContain('Invalid or expired challenge session');
    
    const validRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nonceEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });
    expect(validRes.status).toBe(200);
    
    const replayRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nonceEmpToken}` },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });
    expect(replayRes.status).toBe(400);
    const replayData = await replayRes.json();
    expect(replayData.reason).toBe('LIVENESS_FAILED');
    expect(replayData.message).toContain('Invalid or expired challenge session');

    await db.run('DELETE FROM employees WHERE id = ?', [nonceEmpId]);
    await db.run('DELETE FROM face_descriptors WHERE employee_id = ?', [nonceEmpId]);
    descriptorCache.remove(nonceEmpId);
  }, 15000);

  test('Biometric Cache - immediately syncs on employee face registration and profile deletion', async () => {
    const db = getDb();
    const testEmpId = 'OES/CACHE_INT_TEST';
    
    await db.run('DELETE FROM employees WHERE id = ?', [testEmpId]);
    await db.run('DELETE FROM face_descriptors WHERE employee_id = ?', [testEmpId]);
    descriptorCache.remove(testEmpId);
    
    await db.run(
      "INSERT INTO employees (id, name, email, password, role, department) VALUES (?, 'Cache Integration Test', 'cachetest@test.com', 'pass', 'employee', 'QA')",
      [testEmpId]
    );
    
    const jwt = await import('jsonwebtoken');
    const employeeJwtToken = jwt.default.sign(
      { id: testEmpId, email: 'cachetest@test.com', role: 'employee' },
      process.env.JWT_SECRET || 'fallback-secret-local-only',
      { expiresIn: '1h' }
    );
    
    const desc = generateTestDescriptor(0.99); // completely distinct seed to guarantee no duplication check failures
    
    const regRes = await fetch(`${baseUrl}/employees/${testEmpId}/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        avatar: 'test-face.jpg'
      })
    });
    expect(regRes.status).toBe(200);
    
    const { challengeSessionId, challengeType } = await fetchChallengeSession();
    const scanRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeJwtToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 },
        faceMetrics: buildFaceMetrics(challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId
      })
    });
    expect(scanRes.status).toBe(200);
    const scanData = await scanRes.json();
    expect(scanData.success).toBe(true);
    
    const delRes = await fetch(`${baseUrl}/employees/${testEmpId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    expect(delRes.status).toBe(200);
    
    const afterDelSession = await fetchChallengeSession();
    const postDelScanRes = await fetch(`${baseUrl}/attendance/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${employeeJwtToken}`
      },
      body: JSON.stringify({
        faceDescriptor: desc,
        userCoords: { latitude: 23.2170, longitude: 77.4245, accuracy: 5.0 },
        faceMetrics: buildFaceMetrics(afterDelSession.challengeType, true),
        clientTimestamp: new Date().toISOString(),
        challengeSessionId: afterDelSession.challengeSessionId
      })
    });
    expect(postDelScanRes.status).toBe(404);
    const postDelData = await postDelScanRes.json();
    expect(postDelData.success).toBe(false);
    expect(postDelData.message).toContain('profile not found');
  }, 15000);
});
