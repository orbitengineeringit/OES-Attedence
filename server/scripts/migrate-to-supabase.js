import { getDb, initializeDatabase } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';

const migrateData = async () => {
  console.log('[MIGRATION]: Starting Data Migration from SQLite to Supabase...');
  
  // Ensure DB is initialized to get instance
  await initializeDatabase();
  const db = getDb();
  
  const isSupabaseLive = await checkSupabaseConnection();
  if (!isSupabaseLive) {
    console.error('[MIGRATION FAILED]: Supabase is not connected. Please check your .env variables.');
    process.exit(1);
  }

  try {
    // 1. Migrate Employees
    console.log('[MIGRATION]: Migrating Employees...');
    const employees = await db.all('SELECT * FROM employees');
    for (const emp of employees) {
      // Upsert to handle if they already exist
      const { error } = await supabase.from('employees').upsert({
        id: emp.id,
        name: emp.name,
        email: emp.email,
        password: emp.password,
        role: emp.role,
        department: emp.department,
        avatar: emp.avatar,
        face_data: emp.face_data,
        status: emp.status,
        latitude: emp.latitude,
        longitude: emp.longitude,
        created_at: emp.created_at
      }, { onConflict: 'id' });
      if (error) console.error(`Error migrating employee ${emp.id}:`, error.message);
    }

    // 2. Migrate Settings
    console.log('[MIGRATION]: Migrating Settings...');
    const settings = await db.all('SELECT * FROM settings');
    for (const setting of settings) {
      const { error } = await supabase.from('settings').upsert({
        key: setting.key,
        value: String(setting.value)
      }, { onConflict: 'key' });
      if (error) console.error(`Error migrating setting ${setting.key}:`, error.message);
    }

    // 3. Migrate Geofences
    console.log('[MIGRATION]: Migrating Geofences...');
    const geofences = await db.all('SELECT * FROM office_geofence');
    for (const geo of geofences) {
      const { error } = await supabase.from('office_geofence').upsert({
        id: geo.id,
        office_name: geo.office_name || 'Main Office',
        polygon_coordinates: JSON.parse(geo.polygon_coordinates),
        created_by: geo.created_by,
        created_at: geo.created_at
      }, { onConflict: 'id' });

      if (error) console.error(`Error migrating geofence ${geo.id}:`, error.message);
    }

    // 4. Migrate Attendance
    console.log('[MIGRATION]: Migrating Attendance Logs...');
    const attendance = await db.all('SELECT * FROM attendance');
    for (const att of attendance) {
      const { error } = await supabase.from('attendance').upsert({
        id: att.id,
        employee_id: att.employee_id,
        date: att.date,
        check_in: att.check_in,
        check_out: att.check_out,
        working_hours: att.working_hours,
        break_duration: att.break_duration,
        overtime: att.overtime,
        status: att.status
      }, { onConflict: 'id' });
      if (error) console.error(`Error migrating attendance ${att.id}:`, error.message);
    }

    // 5. Migrate Logs
    console.log('[MIGRATION]: Migrating Activity Logs...');
    const logs = await db.all('SELECT * FROM logs');
    for (const log of logs) {
      const { error } = await supabase.from('logs').upsert({
        id: log.id,
        employee_id: log.employee_id,
        event_type: log.event_type,
        timestamp: log.timestamp,
        location: log.location,
        details: log.details
      }, { onConflict: 'id' });
      if (error) console.error(`Error migrating log ${log.id}:`, error.message);
    }

    console.log('[MIGRATION SUCCESS]: All data successfully migrated from SQLite to Supabase PostgreSQL!');
    process.exit(0);

  } catch (error) {
    console.error('[MIGRATION FATAL ERROR]:', error);
    process.exit(1);
  }
};

migrateData();
