-- ============================================================
-- OES Attendance App — Supabase Schema + RLS Policies
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'employee',
  department VARCHAR(100) NOT NULL DEFAULT 'General',
  avatar TEXT,
  profile_image TEXT,
  face_data TEXT,
  status VARCHAR(50) DEFAULT 'Offline',
  latitude DOUBLE PRECISION DEFAULT 0.0,
  longitude DOUBLE PRECISION DEFAULT 0.0,
  last_latitude DOUBLE PRECISION DEFAULT 0.0,
  last_longitude DOUBLE PRECISION DEFAULT 0.0,
  last_location_time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IMPORTANT: id column is named 'id' (NOT 'SERIAL_ID') — api.js uses .eq('id', ...)
CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
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
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  employee_id VARCHAR(50) REFERENCES employees(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  location VARCHAR(255),
  details TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  employee_id VARCHAR(50),
  event_type VARCHAR(100) NOT NULL,
  details TEXT,
  ip_address VARCHAR(50),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_geofence (
  id BIGSERIAL PRIMARY KEY,
  office_name VARCHAR(100) NOT NULL,
  polygon_coordinates JSONB NOT NULL,
  created_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS face_descriptors (
  id BIGSERIAL PRIMARY KEY,
  employee_id VARCHAR(50) UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  descriptor_json TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id BIGSERIAL PRIMARY KEY,
  attendance_id BIGINT NOT NULL,
  employee_id VARCHAR(50) NOT NULL,
  corrected_by VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  corrected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_nonces (
  session_id VARCHAR(100) PRIMARY KEY,
  challenge_type VARCHAR(50) NOT NULL,
  created_at BIGINT NOT NULL
);

-- ============================================================
-- INDEXES (for faster queries)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date DESC);
CREATE INDEX IF NOT EXISTS idx_logs_employee ON logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_emp ON audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);

-- ============================================================
-- DEFAULT SETTINGS (Office geofence defaults)
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('geofence_lat', '23.2168'),
  ('geofence_lng', '77.4250'),
  ('geofence_radius', '5000'),
  ('office_name', 'OES Head Office'),
  ('office_address', 'Orbit Engineering Solutions')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
-- Strategy:
--   authenticated role = logged-in users (admin + employee) → FULL access
--   anon role = public kiosk scanner (no login) → LIMITED access
--     anon needs: read employees (for face match), insert attendance,
--                 insert logs, update employee status, read settings/geofence
-- ============================================================

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_geofence ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_descriptors ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts on re-run
DROP POLICY IF EXISTS "auth_full_employees" ON employees;
DROP POLICY IF EXISTS "anon_select_employees" ON employees;
DROP POLICY IF EXISTS "anon_update_employee_status" ON employees;
DROP POLICY IF EXISTS "auth_full_attendance" ON attendance;
DROP POLICY IF EXISTS "anon_insert_attendance" ON attendance;
DROP POLICY IF EXISTS "anon_select_attendance" ON attendance;
DROP POLICY IF EXISTS "anon_update_attendance" ON attendance;
DROP POLICY IF EXISTS "auth_full_logs" ON logs;
DROP POLICY IF EXISTS "anon_insert_logs" ON logs;
DROP POLICY IF EXISTS "auth_full_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "auth_full_settings" ON settings;
DROP POLICY IF EXISTS "anon_select_settings" ON settings;
DROP POLICY IF EXISTS "auth_full_office_geofence" ON office_geofence;
DROP POLICY IF EXISTS "anon_select_office_geofence" ON office_geofence;
DROP POLICY IF EXISTS "auth_full_face_descriptors" ON face_descriptors;
DROP POLICY IF EXISTS "auth_full_challenge_nonces" ON challenge_nonces;
DROP POLICY IF EXISTS "auth_full_attendance_corrections" ON attendance_corrections;

-- ---- EMPLOYEES ----
-- Authenticated users: full access
CREATE POLICY "auth_full_employees" ON employees
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (kiosk scanner): can read employee names, face data, avatar for matching
CREATE POLICY "anon_select_employees" ON employees
  FOR SELECT TO anon USING (true);

-- Anon (kiosk scanner): can update status/lat/lng after successful scan
CREATE POLICY "anon_update_employee_status" ON employees
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Anon (self-registration fallback): allows new employee insertion when
-- the tempClient signUp session is unavailable (e.g., email already in Auth).
-- INSERT only — SELECT/UPDATE/DELETE remain restricted.
DROP POLICY IF EXISTS "anon_insert_employee_registration" ON employees;
CREATE POLICY "anon_insert_employee_registration" ON employees
  FOR INSERT TO anon WITH CHECK (true);

-- ---- ATTENDANCE ----
-- Authenticated users: full access
CREATE POLICY "auth_full_attendance" ON attendance
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (kiosk scanner): can read today's record to check if already checked in
CREATE POLICY "anon_select_attendance" ON attendance
  FOR SELECT TO anon USING (true);

-- Anon (kiosk scanner): can insert new check-in record
CREATE POLICY "anon_insert_attendance" ON attendance
  FOR INSERT TO anon WITH CHECK (true);

-- Anon (kiosk scanner): can update record for check-out
CREATE POLICY "anon_update_attendance" ON attendance
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ---- LOGS ----
-- Authenticated users: full access
CREATE POLICY "auth_full_logs" ON logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (kiosk scanner): can insert log entries
CREATE POLICY "anon_insert_logs" ON logs
  FOR INSERT TO anon WITH CHECK (true);

-- ---- AUDIT LOGS ----
-- Authenticated users only (no anon access)
CREATE POLICY "auth_full_audit_logs" ON audit_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- SETTINGS ----
-- Authenticated users: full access
CREATE POLICY "auth_full_settings" ON settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (kiosk scanner): needs geofence settings to validate location
CREATE POLICY "anon_select_settings" ON settings
  FOR SELECT TO anon USING (true);

-- ---- OFFICE GEOFENCE ----
-- Authenticated users: full access
CREATE POLICY "auth_full_office_geofence" ON office_geofence
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (kiosk scanner): needs polygon geofence for location validation
CREATE POLICY "anon_select_office_geofence" ON office_geofence
  FOR SELECT TO anon USING (true);

-- ---- FACE DESCRIPTORS ----
-- Authenticated users only (sensitive biometric data)
CREATE POLICY "auth_full_face_descriptors" ON face_descriptors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- CHALLENGE NONCES ----
-- Authenticated users only
CREATE POLICY "auth_full_challenge_nonces" ON challenge_nonces
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---- ATTENDANCE CORRECTIONS ----
-- Authenticated users only
CREATE POLICY "auth_full_attendance_corrections" ON attendance_corrections
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- STORAGE BUCKETS (Run separately or create via Dashboard)
-- ============================================================
-- After running this SQL, create these 2 buckets in:
-- Supabase Dashboard → Storage → New Bucket
--
-- 1. Bucket name: avatars       → Public: YES
-- 2. Bucket name: attendance-evidence → Public: YES
--
-- Or run these if using Supabase CLI:
-- supabase storage create-bucket avatars --public
-- supabase storage create-bucket attendance-evidence --public
