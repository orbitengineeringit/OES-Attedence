import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
import { encryptDescriptor } from '../services/encryption.js';

let dbInstance = null;

export const initializeDatabase = async () => {
  const dbPath = process.env.DB_FILE || './database.sqlite';
  const sqlite = sqlite3.verbose();
  
  const db = new sqlite.Database(dbPath);

  // Promisify database operations for modern async/await codebase
  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));

  console.log(`[DATABASE INITIALIZING]: Connecting to SQLite DB at ${dbPath}`);

  // Enforce foreign key constraints in SQLite
  await run('PRAGMA foreign_keys = ON;');

  // 1. Employees Table
  await run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      avatar TEXT,
      face_data TEXT,
      status TEXT DEFAULT 'Offline',
      latitude REAL DEFAULT 0.0,
      longitude REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Attendance Table
  await run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      working_hours REAL DEFAULT 0,
      break_duration REAL DEFAULT 0,
      overtime REAL DEFAULT 0,
      status TEXT,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  // 3. Logs Table
  await run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT,
      event_type TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      location TEXT,
      details TEXT,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
    )
  `);

  // 4. Settings Table
  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 5. Office Geofence Table
  await run(`
    CREATE TABLE IF NOT EXISTS office_geofence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office_name TEXT NOT NULL,
      polygon_coordinates TEXT NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6. Indexes for Performance (Production Ready)
  console.log(`[DATABASE OPTIMIZATION]: Creating indexes for high-query tables...`);
  await run(`CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_logs_employee ON logs(employee_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role)`);

  // Seed or update geofence settings to exact coordinates requested
  await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_lat', '23.217023795541753')`);
  await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_lng', '77.424506780737')`);
  
  const radiusSetting = await get(`SELECT value FROM settings WHERE key = 'geofence_radius'`);
  if (!radiusSetting) {
    await run(`INSERT INTO settings (key, value) VALUES ('geofence_radius', '100')`);
  }
  console.log(`[DATABASE SEEDED]: Confirmed precise Bhopal geofence coordinates.`);

  // Alter schema to add position tracking columns for velocity detection
  try {
    await run(`ALTER TABLE employees ADD COLUMN last_latitude REAL DEFAULT 0.0`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE employees ADD COLUMN last_longitude REAL DEFAULT 0.0`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE employees ADD COLUMN last_location_time TEXT`);
  } catch (e) {}

  console.log(`[DATABASE TABLES CONFIRMED]: SQLite database schemas verified successfully.`);

  // 4. Seeding Default Accounts if Admin or Employees are missing
  const adminExists = await get(`SELECT id FROM employees WHERE role = 'admin'`);
  if (!adminExists) {
    console.log(`[DATABASE SEEDING]: No Admin detected. Seeding default Admin...`);
    const salt = await bcrypt.genSalt(10);
    const adminHash = await bcrypt.hash('admin@2026', salt);
    
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
    
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data) 
      VALUES ('OES/001', 'Administrator', 'hr.orbitengineering.group@gmail.com', ?, 'admin', 'Security & HR', ?)
    `, [adminHash, adminFace]);
    
    console.log(`[DATABASE SEEDED]: Created Admin ('hr.orbitengineering.group@gmail.com' / 'admin@2026') with active face biometrics.`);
  }

  // Also seed default employee if database does not contain employee@company.com
  const empExists = await get(`SELECT id FROM employees WHERE email = 'employee@company.com'`);
  if (!empExists) {
    console.log(`[DATABASE SEEDING]: Default Employee missing. Seeding...`);
    const salt = await bcrypt.genSalt(10);
    const employeeHash = await bcrypt.hash('employeepassword', salt);
    
    const generateDescriptor = (name) => {
      const desc = [];
      const lower = name.toLowerCase();
      for (let i = 0; i < 128; i++) {
        let charVal = lower.charCodeAt(i % lower.length) / 128.0;
        desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
      }
      return desc;
    };
    
    const employeeFace = encryptDescriptor(generateDescriptor('shreya'));
    
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data) 
      VALUES ('OES/038', 'Shreya', 'employee@company.com', ?, 'employee', 'Engineering', NULL)
    `, [employeeHash]);
    
    console.log(`[DATABASE SEEDED]: Created default Employee ('employee@company.com' / 'employeepassword') with NO active face biometrics.`);
  }

  dbInstance = {
    db,
    run,
    get,
    all
  };

  return dbInstance;
};

export const getDb = () => {
  if (!dbInstance) {
    throw new Error('[DATABASE ERROR]: Database instance has not been initialized yet!');
  }
  return dbInstance;
};
