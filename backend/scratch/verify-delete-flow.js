import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const dbPath = './database.sqlite';

const runVerification = async () => {
  console.log('=== VERIFYING DELETE FLOW CASCADE IN SQLITE ===');
  
  const db = new sqlite3.Database(dbPath);
  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));

  // Enable foreign keys
  await run('PRAGMA foreign_keys = ON;');

  try {
    const tempEmpId = 'OES/999';
    
    // 1. Insert temporary employee
    console.log(`[TEST]: Inserting temporary employee ${tempEmpId}...`);
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data)
      VALUES (?, 'Temp Tester', 'temp@tester.com', 'testpass', 'employee', 'QA', 'MOCK_FACE_DATA')
    `, [tempEmpId]);

    // 2. Insert mock attendance record
    console.log('[TEST]: Inserting mock attendance record...');
    await run(`
      INSERT INTO attendance (employee_id, date, check_in, status)
      VALUES (?, '2026-06-01', '09:00', 'On Time')
    `, [tempEmpId]);

    // 3. Insert mock log
    console.log('[TEST]: Inserting mock activity log...');
    await run(`
      INSERT INTO logs (employee_id, event_type, location, details)
      VALUES (?, 'CHECK_IN', 'Front Door', 'Checked in for test')
    `, [tempEmpId]);

    // Verify they exist in DB
    const empCount = await get('SELECT COUNT(*) as count FROM employees WHERE id = ?', [tempEmpId]);
    const attCount = await get('SELECT COUNT(*) as count FROM attendance WHERE employee_id = ?', [tempEmpId]);
    const logCount = await get('SELECT COUNT(*) as count FROM logs WHERE employee_id = ?', [tempEmpId]);

    console.log(`\n[PRE-DELETE CHECK]:`);
    console.log(`- Employees with ID ${tempEmpId}: ${empCount.count}`);
    console.log(`- Attendance for ID ${tempEmpId}: ${attCount.count}`);
    console.log(`- Logs for ID ${tempEmpId}: ${logCount.count}\n`);

    if (empCount.count !== 1 || attCount.count !== 1 || logCount.count !== 1) {
      throw new Error('Pre-delete setup failed: Records were not created successfully.');
    }

    // 4. Perform Deletion
    console.log(`[TEST]: Deleting employee ${tempEmpId}...`);
    await run('DELETE FROM employees WHERE id = ?', [tempEmpId]);

    // Verify cascade results
    const empCountAfter = await get('SELECT COUNT(*) as count FROM employees WHERE id = ?', [tempEmpId]);
    const attCountAfter = await get('SELECT COUNT(*) as count FROM attendance WHERE employee_id = ?', [tempEmpId]);
    const logCountAfter = await get('SELECT COUNT(*) as count FROM logs WHERE employee_id = ?', [tempEmpId]);
    const unassociatedLogs = await all('SELECT * FROM logs WHERE employee_id IS NULL AND details LIKE ?', ['%Checked in for test%']);

    console.log(`[POST-DELETE VERIFICATION]:`);
    console.log(`- Employees with ID ${tempEmpId} remaining: ${empCountAfter.count} (Expected: 0)`);
    console.log(`- Attendance for ID ${tempEmpId} remaining (Cascade Check): ${attCountAfter.count} (Expected: 0)`);
    console.log(`- Personal logs for ID ${tempEmpId} remaining (Dissociation Check): ${logCountAfter.count} (Expected: 0)`);
    console.log(`- Anonymous audit logs preserved (ON DELETE SET NULL): ${unassociatedLogs.length} (Expected: 1)\n`);

    if (empCountAfter.count === 0 && attCountAfter.count === 0 && logCountAfter.count === 0 && unassociatedLogs.length === 1) {
      console.log('=== VERIFICATION SUCCESS: CASCADE AND SET_NULL LOGIC ARE 100% CORRECT ===');
    } else {
      throw new Error('Cascade deletion verification failed.');
    }

  } catch (error) {
    console.error('[VERIFICATION FAILED]:', error);
  } finally {
    db.close();
  }
};

runVerification();
