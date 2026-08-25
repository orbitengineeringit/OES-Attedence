import sqlite3 from 'sqlite3';
import pg from 'pg';
import { promisify } from 'util';
import bcrypt from 'bcryptjs';
// Note: encryptDescriptor import removed - fake face descriptors are no longer seeded (C-04 fix)

const { Pool } = pg;
let dbInstance = null;

export const initializeDatabase = async () => {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
  console.log(`[DATABASE INITIALIZING]: Target engine is '${dbType.toUpperCase()}'`);

  if (dbType === 'postgres' || dbType === 'postgresql') {
    return await initializePostgres();
  } else {
    return await initializeSqlite();
  }
};

/**
 * PostgreSQL Database Adapter (Production Engine)
 */
async function initializePostgres() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orbitguard';
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  console.log(`[POSTGRES DB]: Connecting to pool...`);

  // Unified async query helper
  const query = async (text, params = []) => {
    const start = Date.now();
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 200) console.log(`[SLOW QUERY]: ${duration}ms - ${text}`);
      return res;
    } catch (err) {
      console.error(`[POSTGRES QUERY ERROR]: ${err.message} | Query: ${text}`);
      throw err;
    }
  };

  const get = async (text, params = []) => {
    const res = await query(text, params);
    return res.rows[0] || null;
  };

  const all = async (text, params = []) => {
    const res = await query(text, params);
    return res.rows || [];
  };

  const run = async (text, params = []) => {
    const res = await query(text, params);
    return { changes: res.rowCount };
  };

  // Create Tables
  await query(`
    CREATE TABLE IF NOT EXISTS departments (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      code VARCHAR(50) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role VARCHAR(50) NOT NULL,
      department VARCHAR(100) NOT NULL,
      avatar TEXT,
      profile_image TEXT,
      face_data TEXT,
      status VARCHAR(50) DEFAULT 'Offline',
      latitude DOUBLE PRECISION DEFAULT 0.0,
      longitude DOUBLE PRECISION DEFAULT 0.0,
      last_latitude DOUBLE PRECISION DEFAULT 0.0,
      last_longitude DOUBLE PRECISION DEFAULT 0.0,
      last_location_time TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance (
      SERIAL_ID SERIAL PRIMARY KEY,
      employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      date VARCHAR(20) NOT NULL,
      check_in VARCHAR(20),
      check_out VARCHAR(20),
      working_hours DOUBLE PRECISION DEFAULT 0,
      break_duration DOUBLE PRECISION DEFAULT 0,
      overtime DOUBLE PRECISION DEFAULT 0,
      status VARCHAR(50),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      confidence_score DOUBLE PRECISION,
      captured_image TEXT,
      device_id VARCHAR(100),
      -- [C-05 FIX]: Unique constraint prevents duplicate attendance rows per employee per day.
      UNIQUE(employee_id, date)
    );

    -- [M-03 FIX]: Attendance corrections table for immutable admin edit audit trail.
    -- All check-in/check-out modifications must be recorded here with reason and approver.
    CREATE TABLE IF NOT EXISTS attendance_corrections (
      id SERIAL PRIMARY KEY,
      attendance_id INT NOT NULL,
      employee_id VARCHAR(50) NOT NULL,
      corrected_by VARCHAR(50) NOT NULL,
      reason TEXT NOT NULL,
      old_values JSONB,
      new_values JSONB,
      corrected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS face_descriptors (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(50) UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      descriptor_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      id VARCHAR(100) PRIMARY KEY,
      device_name VARCHAR(100) NOT NULL,
      device_ip VARCHAR(50),
      mac_address VARCHAR(50),
      status VARCHAR(50) DEFAULT 'Active',
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(50),
      event_type VARCHAR(100) NOT NULL,
      details TEXT,
      ip_address VARCHAR(50),
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE SET NULL,
      event_type VARCHAR(100) NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      location VARCHAR(255),
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      radius_meters INT DEFAULT 100,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS office_geofence (
      id SERIAL PRIMARY KEY,
      office_name VARCHAR(100) NOT NULL,
      polygon_coordinates TEXT NOT NULL,
      created_by VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS challenge_nonces (
      session_id VARCHAR(100) PRIMARY KEY,
      challenge_type VARCHAR(50) NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key VARCHAR(255) PRIMARY KEY,
      hits INT NOT NULL,
      reset_at BIGINT NOT NULL
    );

    ALTER TABLE challenge_nonces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
  `);

  // [M-08 FIX]: Add composite index on (date, check_in) for faster admin attendance queries.
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_attendance_emp_date ON attendance(employee_id, date);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_attendance_date_checkin ON attendance(date DESC, check_in DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_audit_logs_emp ON audit_logs(employee_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_audit_logs_timestamp_emp ON audit_logs(timestamp DESC, employee_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_face_descriptors_emp ON face_descriptors(employee_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_pg_logs_employee ON logs(employee_id);`);

  await seedDefaults({ run, get, all, query });

  dbInstance = {
    engine: 'postgres',
    pool,
    query,
    get,
    all,
    run
  };

  return dbInstance;
}

/**
 * SQLite Database Adapter (Development Fallback)
 */
async function initializeSqlite() {
  const dbPath = process.env.DB_FILE || './database.sqlite';
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath);

  const run = promisify(db.run.bind(db));
  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));

  await run('PRAGMA foreign_keys = ON;');

  await run(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      avatar TEXT,
      profile_image TEXT,
      face_data TEXT,
      status TEXT DEFAULT 'Offline',
      latitude REAL DEFAULT 0.0,
      longitude REAL DEFAULT 0.0,
      last_latitude REAL DEFAULT 0.0,
      last_longitude REAL DEFAULT 0.0,
      last_location_time TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      latitude REAL,
      longitude REAL,
      confidence_score REAL,
      captured_image TEXT,
      device_id TEXT,
      -- [C-05 FIX]: Unique constraint prevents duplicate attendance rows per employee per day.
      UNIQUE(employee_id, date),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  // [M-03 FIX]: Attendance corrections table for immutable admin edit audit trail.
  // All manual check-in/check-out modifications are permanently logged here.
  await run(`
    CREATE TABLE IF NOT EXISTS attendance_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_id INTEGER NOT NULL,
      employee_id TEXT NOT NULL,
      corrected_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      corrected_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS face_descriptors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      descriptor_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      device_ip TEXT,
      mac_address TEXT,
      status TEXT DEFAULT 'Active',
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT,
      event_type TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  await run(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER DEFAULT 100,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS office_geofence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office_name TEXT NOT NULL,
      polygon_coordinates TEXT NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS challenge_nonces (
      session_id TEXT PRIMARY KEY,
      challenge_type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT PRIMARY KEY,
      hits INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )
  `);

  // [M-08 FIX]: Composite index for admin attendance queries (date + check_in sort)
  await run(`CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_attendance_date_checkin ON attendance(date, check_in)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_logs_employee ON audit_logs(employee_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp_emp ON audit_logs(timestamp DESC, employee_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_face_descriptors_emp ON face_descriptors(employee_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_logs_emp ON logs(employee_id)`);

  // [C-05 FIX]: Schema alteration guards for existing databases without UNIQUE constraint.
  // SQLite does not support ALTER TABLE ADD CONSTRAINT, so this is handled at table creation.
  // For existing databases, existing UNIQUE violations must be resolved manually before this applies.
  try { await run(`ALTER TABLE employees ADD COLUMN profile_image TEXT`); } catch (e) {}
  try { await run(`ALTER TABLE attendance ADD COLUMN captured_image TEXT`); } catch (e) {}
  try { await run(`ALTER TABLE attendance ADD COLUMN confidence_score REAL`); } catch (e) {}
  try { await run(`ALTER TABLE attendance ADD COLUMN latitude REAL`); } catch (e) {}
  try { await run(`ALTER TABLE attendance ADD COLUMN longitude REAL`); } catch (e) {}
  // Attempt to add attendance_corrections table to existing databases
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS attendance_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER NOT NULL,
        employee_id TEXT NOT NULL,
        corrected_by TEXT NOT NULL,
        reason TEXT NOT NULL,
        old_values TEXT,
        new_values TEXT,
        corrected_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {}

  await seedDefaults({ run, get, all });

  dbInstance = {
    engine: 'sqlite',
    db,
    run,
    get,
    all
  };

  return dbInstance;
}

/**
 * Shared Database Defaults Seeder
 */
async function seedDefaults({ run, get, all }) {
  await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_lat', '23.217023795541753')`);
  await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('geofence_lng', '77.424506780737')`);

  const radiusSetting = await get(`SELECT value FROM settings WHERE key = 'geofence_radius'`);
  if (!radiusSetting) {
    await run(`INSERT INTO settings (key, value) VALUES ('geofence_radius', '100')`);
  }

  // Seed default admin
  const adminExists = await get(`SELECT id FROM employees WHERE role = 'admin'`);
  if (!adminExists) {
    console.log(`[DATABASE SEEDING]: Seeding default Admin...`);
    const salt = await bcrypt.genSalt(10);
    const adminHash = await bcrypt.hash('admin@2026', salt);

    // [C-04 FIX]: Do NOT seed a fake face descriptor for the admin account.
    // Admin must complete a real biometric enrollment before check-in is possible.
    // The old code generated a predictable sine-wave descriptor from the name 'administrator',
    // which allowed anyone who knew the name to compute and submit a spoofed matching descriptor.
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data, profile_image) 
      VALUES ('OES/001', 'Administrator', 'hr.orbitengineering.group@gmail.com', ?, 'admin', 'Security & HR', NULL, 'uploads/employees/OES001/profile.jpg')
    `, [adminHash]);
    // Note: No face_descriptor seeded for admin — must enroll via Admin Panel → Employees → Face Scan
  }

  // Seed default employee
  const empExists = await get(`SELECT id FROM employees WHERE email = 'employee@company.com'`);
  if (!empExists) {
    const salt = await bcrypt.genSalt(10);
    const employeeHash = await bcrypt.hash('employeepassword', salt);
    
    await run(`
      INSERT INTO employees (id, name, email, password, role, department, face_data, profile_image) 
      VALUES ('OES/038', 'Shreya', 'employee@company.com', ?, 'employee', 'Engineering', NULL, 'uploads/employees/OES038/profile.jpg')
    `, [employeeHash]);
  }
}


export const getDb = () => {
  if (!dbInstance) {
    throw new Error('[DATABASE ERROR]: Database instance has not been initialized yet!');
  }
  return dbInstance;
};
