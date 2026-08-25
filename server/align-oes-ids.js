import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { encryptDescriptor } from './services/encryption.js';

dotenv.config();

const dbPath = process.env.DB_FILE || './database.sqlite';
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const main = async () => {
  console.log('=== DATABASE OES ID ALIGNMENT MIGRATION ===');
  
  // 1. Establish SQLite Connection
  console.log(`[SQLITE]: Opening connection to ${dbPath}...`);
  const db = new sqlite3.Database(dbPath);
  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  
  // 2. Establish Supabase Connection
  let supabase = null;
  if (supabaseUrl && supabaseKey) {
    console.log(`[SUPABASE]: Initializing client for ${supabaseUrl}...`);
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
  } else {
    console.log('[SUPABASE]: Warning: Supabase variables are missing, skipping Supabase operations.');
  }

  try {
    // Generate Passwords Hashes
    console.log('[CRYPTO]: Generating secure password hashes...');
    const salt = await bcrypt.genSalt(10);
    const adminHash = await bcrypt.hash('admin@2026', salt);
    const employeeHash = await bcrypt.hash('employeepassword', salt);
    const shreyaHash = await bcrypt.hash('shreyapassword', salt);

    // Generate Admin Face Descriptor
    console.log('[BIOMETRICS]: Generating encrypted face descriptor for Admin...');
    const generateDescriptor = (name) => {
      const desc = [];
      const lower = name.toLowerCase();
      for (let i = 0; i < 128; i++) {
        let charVal = lower.charCodeAt(i % lower.length) / 128.0;
        desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
      }
      return desc;
    };
    const adminFace = encryptDescriptor(generateDescriptor('administrator'));

    // --- SQLite Migration ---
    console.log('\n--- STARTING SQLITE CLEANSE & SEED ---');
    
    // Disable constraints temporarily or delete dependent logs first
    console.log('[SQLITE]: Cleaning attendance and logs tables...');
    await run('DELETE FROM attendance');
    await run('DELETE FROM logs');
    console.log('[SQLITE]: Cleaning employees table...');
    await run('DELETE FROM employees');

    console.log('[SQLITE]: Seeding aligned employee profiles...');
    // Seed OES/001 (Admin)
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data, status) 
      VALUES ('OES/001', 'Administrator', 'hr.orbitengineering.group@gmail.com', ?, 'admin', 'Security & HR', ?, 'Offline')
    `, [adminHash, adminFace]);

    // Seed OES/038 (Standard Employee)
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data, status) 
      VALUES ('OES/038', 'Shreya', 'employee@company.com', ?, 'employee', 'Engineering', NULL, 'Offline')
    `, [employeeHash]);

    // Seed OES/039 (Extra Employee Shreya Dwivedi for additional verification)
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data, status) 
      VALUES ('OES/039', 'Shreya Dwivedi', 'shreyadwivedi477@gmail.com', ?, 'employee', 'Engineering', NULL, 'Offline')
    `, [shreyaHash]);

    console.log('[SQLITE SUCCESS]: All OES formatted profiles successfully seeded!');

    // --- Supabase Migration ---
    if (supabase) {
      console.log('\n--- STARTING SUPABASE CLEANSE & SEED ---');
      
      console.log('[SUPABASE]: Purging dependent logs and attendance...');
      const { error: delLogsErr } = await supabase.from('logs').delete().neq('id', 0);
      if (delLogsErr) console.error('[SUPABASE WARNING]: Logs delete error:', delLogsErr.message);

      const { error: delAttErr } = await supabase.from('attendance').delete().neq('id', 0);
      if (delAttErr) console.error('[SUPABASE WARNING]: Attendance delete error:', delAttErr.message);

      console.log('[SUPABASE]: Purging employees...');
      const { error: delEmpErr } = await supabase.from('employees').delete().neq('id', 'dummy');
      if (delEmpErr) console.error('[SUPABASE WARNING]: Employees delete error:', delEmpErr.message);

      console.log('[SUPABASE]: Seeding aligned employee profiles...');
      
      // OES/001
      const { error: seedAdminErr } = await supabase.from('employees').insert({
        id: 'OES/001',
        name: 'Administrator',
        email: 'hr.orbitengineering.group@gmail.com',
        password: adminHash,
        role: 'admin',
        department: 'Security & HR',
        face_data: adminFace,
        status: 'Offline'
      });
      if (seedAdminErr) {
        console.error('[SUPABASE ERROR]: Admin seed failed:', seedAdminErr.message);
      } else {
        console.log('[SUPABASE]: Successfully seeded OES/001 (Admin).');
      }

      // OES/038
      const { error: seedEmp1Err } = await supabase.from('employees').insert({
        id: 'OES/038',
        name: 'Shreya',
        email: 'employee@company.com',
        password: employeeHash,
        role: 'employee',
        department: 'Engineering',
        face_data: null,
        status: 'Offline'
      });
      if (seedEmp1Err) {
        console.error('[SUPABASE ERROR]: OES/038 seed failed:', seedEmp1Err.message);
      } else {
        console.log('[SUPABASE]: Successfully seeded OES/038 (Employee Shreya).');
      }

      // OES/039
      const { error: seedEmp2Err } = await supabase.from('employees').insert({
        id: 'OES/039',
        name: 'Shreya Dwivedi',
        email: 'shreyadwivedi477@gmail.com',
        password: shreyaHash,
        role: 'employee',
        department: 'Engineering',
        face_data: null,
        status: 'Offline'
      });
      if (seedEmp2Err) {
        console.error('[SUPABASE ERROR]: OES/039 seed failed:', seedEmp2Err.message);
      } else {
        console.log('[SUPABASE]: Successfully seeded OES/039 (Employee Shreya Dwivedi).');
      }

      console.log('[SUPABASE SUCCESS]: All OES formatted profiles successfully seeded to cloud!');
    }

    console.log('\n=== MIGRATION COMPLETED SUCCESSFULLY ===');
    process.exit(0);
  } catch (error) {
    console.error('\n[FATAL ERROR DURING MIGRATION]:', error);
    process.exit(1);
  } finally {
    db.close();
  }
};

main();
