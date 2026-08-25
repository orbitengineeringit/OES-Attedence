import { initializeDatabase, getDb } from '../database/db.js';
import { registerFaceData, identifyFace, verifyLiveness } from '../services/faceRecognitionService.js';
import { processGeofenceUpdate } from '../services/geofenceService.js';

async function runTests() {
  console.log('=== STARTING WORKFLOW REDESIGN AUTOMATED TESTS ===\n');

  // 1. Initialize Database
  console.log('[TEST 1] Initializing SQLite database...');
  await initializeDatabase();
  const db = getDb();
  console.log('✓ Database initialized successfully.\n');

  // 2. Check Employees in DB
  console.log('[TEST 2] Checking default seeded employees...');
  const employees = await db.all('SELECT id, name, email, role, (face_data IS NOT NULL) AS is_face_registered FROM employees');
  console.log('Employees found:', employees);
  console.log('✓ Employees retrieved.\n');

  // 3. Test Admin Face Registration for Default Employee (OES/038 - Shreya)
  console.log('[TEST 3] Admin Registering Face for Employee OES/038...');
  
  // Generate deterministic 128D test descriptor for Shreya
  const generateTestDescriptor = (seed) => {
    const desc = [];
    for (let i = 0; i < 128; i++) {
      desc.push(Math.sin(i * seed) * 0.8 + 0.1);
    }
    return desc;
  };

  const shreyaDescriptor = generateTestDescriptor(0.42);
  const regResult = await registerFaceData('OES/038', shreyaDescriptor);
  console.log('Registration Result:', regResult);

  const shreyaInDb = await db.get('SELECT id, name, (face_data IS NOT NULL) AS is_face_registered FROM employees WHERE id = ?', ['OES/038']);
  if (shreyaInDb.is_face_registered !== 1) {
    throw new Error('FAILED: Employee face registration failed to update face_data column in SQLite!');
  }
  console.log('✓ Admin Face Registration successful. is_face_registered = true.\n');

  // 4. Test Biometric Face Matching (Known Face)
  console.log('[TEST 4] Testing Face Recognition for Registered Employee (Known Face)...');
  const matchResult = await identifyFace(shreyaDescriptor, 0.60);
  console.log('Match Result:', matchResult);

  if (!matchResult.matched || matchResult.employeeId !== 'OES/038') {
    throw new Error(`FAILED: Expected match for OES/038, got: ${JSON.stringify(matchResult)}`);
  }
  console.log(`✓ Face Match successful! Recognized ${matchResult.name} (${matchResult.employeeId}).\n`);

  // 5. Test Biometric Face Matching (Unknown / Unregistered Face)
  console.log('[TEST 5] Testing Face Recognition for Unknown Face...');
  const unknownDescriptor = generateTestDescriptor(0.99); // completely different pattern
  const unknownMatchResult = await identifyFace(unknownDescriptor, 0.60);
  console.log('Unknown Match Result:', unknownMatchResult);

  if (unknownMatchResult.matched) {
    throw new Error(`FAILED: Unknown face matched employee ${unknownMatchResult.employeeId}! Expected false.`);
  }
  console.log('✓ Unknown Face test passed! Correctly returned matched = false ("Face Not Recognized").\n');

  // 6. Test Geofence Validation
  console.log('[TEST 6] Testing GPS & Geofence Validation...');
  // Office location in Bhopal settings: 23.217023795541753, 77.424506780737
  const insideCoords = { latitude: 23.21702, longitude: 77.42450 }; // Right inside office
  const outsideCoords = { latitude: 28.6139, longitude: 77.2090 };  // Delhi (far away!)

  // Reset last location in DB to prevent artificial velocity breach from 0,0
  await db.run('UPDATE employees SET last_latitude = ?, last_longitude = ?, last_location_time = ? WHERE id = ?',
    [insideCoords.latitude, insideCoords.longitude, new Date(Date.now() - 3600000).toISOString(), 'OES/038']
  );

  const insideResult = await processGeofenceUpdate('OES/038', insideCoords.latitude, insideCoords.longitude);
  console.log('Inside Geofence Check:', insideResult.isInside, insideResult.message);
  if (!insideResult.isInside) {
    throw new Error('FAILED: Expected inside office geofence to be true!');
  }

  const outsideResult = await processGeofenceUpdate('OES/038', outsideCoords.latitude, outsideCoords.longitude);
  console.log('Outside Geofence Check:', outsideResult.isInside, outsideResult.message);
  if (outsideResult.isInside) {
    throw new Error('FAILED: Expected outside office geofence to be false!');
  }
  console.log('✓ Geofence Validation passed! Correctly approved inside coords and rejected outside coords.\n');

  // 7. Test Attendance Record Creation & Database Save
  console.log('[TEST 7] Testing Attendance Ledger Save...');
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  // Clear existing test records for today if any
  await db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', ['OES/038', today]);

  // Insert Check-In
  await db.run(
    'INSERT INTO attendance (employee_id, date, check_in, status) VALUES (?, ?, ?, ?)',
    ['OES/038', today, now, 'On Time']
  );
  await db.run('INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)',
    ['OES/038', 'CHECK_IN', 'Public Attendance Link', 'Test attendance mark']
  );

  const savedAttendance = await db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', ['OES/038', today]);
  console.log('Saved Attendance Record:', savedAttendance);

  if (!savedAttendance || savedAttendance.employee_id !== 'OES/038') {
    throw new Error('FAILED: Attendance record was not saved correctly to database!');
  }
  console.log('✓ Attendance Save test passed!\n');

  // 8. Test Removing Face (Reset Face)
  console.log('[TEST 8] Admin Removing Face (Reset Face)...');
  await db.run('UPDATE employees SET face_data = NULL WHERE id = ?', ['OES/038']);
  const resetEmp = await db.get('SELECT id, name, (face_data IS NOT NULL) AS is_face_registered FROM employees WHERE id = ?', ['OES/038']);
  if (resetEmp.is_face_registered !== 0) {
    throw new Error('FAILED: Face data reset failed!');
  }
  console.log('✓ Admin Remove Face test passed! is_face_registered = 0.\n');

  console.log('====================================================');
  console.log('  ALL WORKFLOW REDESIGN TESTS PASSED SUCCESSFULLY!  ');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  process.exit(1);
});
