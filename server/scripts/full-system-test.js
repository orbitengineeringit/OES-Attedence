const API_BASE = 'http://localhost:5000/api';

// Sample 128D Face Descriptor vectors for synthetic testing
function generateSyntheticDescriptor(seed = 0.1) {
  const descriptor = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    descriptor[i] = Math.sin(i + seed) * 0.5;
  }
  return Array.from(descriptor);
}

// Sample 1x1 base64 pixel avatar image
const SAMPLE_AVATAR_BASE64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function runFullSystemTestSuite() {
  console.log('\n=============================================================');
  console.log('  ORBIT ENGINEERING SOLUTIONS - FULL SYSTEM TEST SUITE');
  console.log('=============================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS]: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ [FAIL]: ${testName} ${details ? `(${details})` : ''}`);
      failedCount++;
    }
  }

  try {
    // ----------------------------------------------------------------------
    // TEST SECTION 1: AUTHENTICATION & ROLE ACCESS
    // ----------------------------------------------------------------------
    console.log('--- TEST SECTION 1: AUTHENTICATION & ACCESS CONTROL ---');

    // 1.1 Admin Login
    const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'hr.orbitengineering.group@gmail.com',
        password: 'admin@2026'
      })
    });
    const adminData = await adminLoginRes.json();
    assert(
      adminLoginRes.status === 200 && adminData.token && adminData.user?.role === 'admin',
      '1.1 Admin Login with valid credentials',
      `Status: ${adminLoginRes.status}`
    );
    const adminToken = adminData.token;

    // 1.2 Employee Login
    const empLoginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'employee@company.com',
        password: 'employeepassword'
      })
    });
    const empData = await empLoginRes.json();
    assert(
      empLoginRes.status === 200 && empData.token && empData.user?.role === 'employee',
      '1.2 Employee Login with valid credentials',
      `Status: ${empLoginRes.status}`
    );
    const empToken = empData.token;

    // 1.3 Invalid Password Rejection
    const invalidLoginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'hr.orbitengineering.group@gmail.com',
        password: 'wrongpassword'
      })
    });
    assert(
      invalidLoginRes.status === 401,
      '1.3 Invalid Password Rejection (401 Unauthorized)',
      `Status: ${invalidLoginRes.status}`
    );


    // ----------------------------------------------------------------------
    // TEST SECTION 2: EMPLOYEE MANAGEMENT (CRUD)
    // ----------------------------------------------------------------------
    console.log('\n--- TEST SECTION 2: EMPLOYEE DIRECTORY CRUD ---');

    // 2.1 Fetch Employee List
    const getEmpsRes = await fetch(`${API_BASE}/employees`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const getEmpsData = await getEmpsRes.json();
    assert(
      getEmpsRes.status === 200 && Array.isArray(getEmpsData.employees),
      '2.1 Fetch All Employees (GET /api/employees)'
    );

    // 2.2 Create New Test Employee
    const newEmpId = `TEST_${Date.now()}`;
    const createEmpRes = await fetch(`${API_BASE}/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id: newEmpId,
        name: 'Automated Test Employee',
        email: `${newEmpId}@orbitengineering.com`,
        password: 'testpassword123',
        role: 'employee',
        department: 'Quality Assurance',
        latitude: 23.2168,
        longitude: 77.4250
      })
    });
    const createEmpData = await createEmpRes.json();
    assert(
      createEmpRes.status === 200 || createEmpRes.status === 201,
      '2.2 Create New Employee (POST /api/employees)',
      `Status: ${createEmpRes.status}`
    );

    // 2.3 Edit Employee Details
    const editEmpRes = await fetch(`${API_BASE}/employees/${newEmpId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Automated Test Employee Updated',
        email: `${newEmpId}@orbitengineering.com`,
        role: 'employee',
        department: 'Systems Engineering'
      })
    });
    assert(
      editEmpRes.status === 200,
      '2.3 Update Employee Details (PUT /api/employees/:id)'
    );


    // ----------------------------------------------------------------------
    // TEST SECTION 3: BIOMETRIC FACE REGISTRATION (ADMIN ONLY)
    // ----------------------------------------------------------------------
    console.log('\n--- TEST SECTION 3: BIOMETRIC FACE REGISTRATION (ADMIN ONLY) ---');

    const knownDescriptor = generateSyntheticDescriptor(0.42);

    // 3.1 Non-Admin Face Registration Attempt (Must Fail with 403)
    const empFaceAttempt = await fetch(`${API_BASE}/employees/${newEmpId}/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${empToken}`
      },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        avatar: SAMPLE_AVATAR_BASE64
      })
    });
    assert(
      empFaceAttempt.status === 403,
      '3.1 Enforce Admin-Only Face Registration (Employee attempt returns 403 Forbidden)',
      `Status: ${empFaceAttempt.status}`
    );

    // 3.2 Admin Registers Employee Face & Avatar
    const adminFaceEnroll = await fetch(`${API_BASE}/employees/${newEmpId}/face`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        avatar: SAMPLE_AVATAR_BASE64
      })
    });
    const enrollData = await adminFaceEnroll.json();
    assert(
      adminFaceEnroll.status === 200 && enrollData.success,
      '3.2 Admin Registers Employee Face & Avatar Snapshot',
      `Message: ${enrollData.message}`
    );

    // 3.3 Verify Registration Status Flag
    const verifyEmpRes = await fetch(`${API_BASE}/employees`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const verifyEmpData = await verifyEmpRes.json();
    const enrolledEmp = verifyEmpData.employees?.find(e => e.id === newEmpId);
    assert(
      enrolledEmp && Boolean(enrolledEmp.is_face_registered) && enrolledEmp.avatar,
      '3.3 Verify Database contains is_face_registered=1 & avatar photo URL'
    );


    // ----------------------------------------------------------------------
    // TEST SECTION 4: PUBLIC ATTENDANCE SCANNER (/attendance)
    // ----------------------------------------------------------------------
    console.log('\n--- TEST SECTION 4: PUBLIC ATTENDANCE SCANNER ENDPOINTS ---');

    // 4.1 Valid Attendance Scan (Known Face, Inside GPS, Blink Verified)
    const validScanRes = await fetch(`${API_BASE}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        userCoords: { latitude: 23.2168, longitude: 77.4250 }, // Inside Bhopal Office geofence
        faceMetrics: { blinkDetected: true, spoofIndex: 0.1 }
      })
    });
    const validScanData = await validScanRes.json();
    assert(
      validScanRes.status === 200 && validScanData.success && validScanData.employee?.name,
      '4.1 Known Face Attendance Scan Success (CHECK_IN)',
      `Matched: ${validScanData.employee?.name}`
    );

    // 4.2 Second Scan (CHECK_OUT) & Third Scan (Already Marked Today)
    const checkOutScanRes = await fetch(`${API_BASE}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        userCoords: { latitude: 23.2168, longitude: 77.4250 },
        faceMetrics: { blinkDetected: true, spoofIndex: 0.1 }
      })
    });
    const checkOutData = await checkOutScanRes.json();
    assert(
      checkOutScanRes.status === 200 && checkOutData.eventType === 'CHECK_OUT',
      '4.2 Second Face Scan Success (CHECK_OUT)'
    );

    const duplicateScanRes = await fetch(`${API_BASE}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        userCoords: { latitude: 23.2168, longitude: 77.4250 },
        faceMetrics: { blinkDetected: true, spoofIndex: 0.1 }
      })
    });
    const dupData = await duplicateScanRes.json();
    assert(
      duplicateScanRes.status === 200 && dupData.alreadyCompleted,
      '4.2b Third Scan Duplicate Detection ("Already Marked Today")'
    );

    // 4.3 Unknown Face Scan Rejection
    const unknownDescriptor = generateSyntheticDescriptor(9.99);
    const unknownScanRes = await fetch(`${API_BASE}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: unknownDescriptor,
        userCoords: { latitude: 23.2168, longitude: 77.4250 },
        faceMetrics: { blinkDetected: true, spoofIndex: 0.1 }
      })
    });
    const unknownData = await unknownScanRes.json();
    assert(
      unknownScanRes.status === 401 && unknownData.reason === 'FACE_NOT_RECOGNIZED',
      '4.3 Unknown Face Rejection ("Face Not Recognized")'
    );

    // 4.4 Geofence Violation (Outside Office Location)
    const outsideScanRes = await fetch(`${API_BASE}/attendance/public-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        faceDescriptor: knownDescriptor,
        userCoords: { latitude: 0.0000, longitude: 0.0000 }, // Guaranteed outside office geofence
        faceMetrics: { blinkDetected: true, spoofIndex: 0.1 }
      })
    });
    const outsideData = await outsideScanRes.json();
    assert(
      outsideScanRes.status === 403 && outsideData.reason === 'GEOFENCE_INVALID',
      '4.4 Outside Geofence Violation Rejection'
    );


    // ----------------------------------------------------------------------
    // TEST SECTION 5: FACE REMOVAL & CLEANUP
    // ----------------------------------------------------------------------
    console.log('\n--- TEST SECTION 5: FACE DELETION & CLEANUP ---');

    // 5.1 Remove Face Biometrics
    const removeFaceRes = await fetch(`${API_BASE}/employees/${newEmpId}/face`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      removeFaceRes.status === 200,
      '5.1 Admin Deletes Biometric Face Signature (DELETE /api/employees/:id/face)'
    );

    // 5.2 Delete Test Employee
    const delEmpRes = await fetch(`${API_BASE}/employees/${newEmpId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      delEmpRes.status === 200,
      '5.2 Admin Deletes Test Employee (DELETE /api/employees/:id)'
    );


    // ----------------------------------------------------------------------
    // FINAL TEST RESULTS SUMMARY
    // ----------------------------------------------------------------------
    console.log('\n=============================================================');
    console.log(`  TEST RESULTS: ${passedCount} PASSED | ${failedCount} FAILED`);
    console.log('=============================================================\n');

    if (failedCount === 0) {
      console.log('🎉 ALL SYSTEM WORKFLOW TESTS PASSED 100% CLEANLY!');
    } else {
      console.error(`⚠️ ${failedCount} tests failed. Inspect details above.`);
      process.exit(1);
    }

  } catch (err) {
    console.error('Fatal test exception:', err);
    process.exit(1);
  }
}

runFullSystemTestSuite();
