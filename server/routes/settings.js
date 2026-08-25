import express from 'express';
import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Apply global Auth check
router.use(requireAuth);

// @route   GET /api/settings
// @desc    Retrieve active settings
router.get('/', async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let rows = [];

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('settings').select('*');
      if (!error && data && data.length > 0) {
        rows = data;
      } else {
        rows = await db.all('SELECT key, value FROM settings');
      }
    } else {
      rows = await db.all('SELECT key, value FROM settings');
    }

    const settings = {};
    rows.forEach(row => {
      if (row.key === 'geofence_lat' || row.key === 'geofence_lng') {
        settings[row.key] = parseFloat(row.value);
      } else if (row.key === 'geofence_radius') {
        settings[row.key] = parseInt(row.value, 10);
      } else {
        settings[row.key] = row.value; // office_name, office_address returned as strings
      }
    });
    res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/settings
// @desc    Update settings (Admin only)
router.post('/', requireAdmin, async (req, res, next) => {
  const { geofence_lat, geofence_lng, geofence_radius, office_name, office_address } = req.body;
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();

    // 1. SQLite Fallback Writes
    if (geofence_lat !== undefined) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['geofence_lat', String(geofence_lat)]);
    if (geofence_lng !== undefined) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['geofence_lng', String(geofence_lng)]);
    if (geofence_radius !== undefined) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['geofence_radius', String(geofence_radius)]);
    if (office_name !== undefined) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['office_name', String(office_name)]);
    if (office_address !== undefined) await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['office_address', String(office_address)]);

    const nameLabel = office_name ? ` | name=${office_name}` : '';
    const details = `Admin updated geofence settings: lat=${geofence_lat}, lng=${geofence_lng}, radius=${geofence_radius}m${nameLabel}`;
    
    await db.run(
      'INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)',
      [req.user.id, 'System Update', 'Database Settings', details]
    );

    // 2. Supabase Primary Writes
    if (isSupabaseLive) {
      const updates = [];
      if (geofence_lat !== undefined) updates.push({ key: 'geofence_lat', value: String(geofence_lat) });
      if (geofence_lng !== undefined) updates.push({ key: 'geofence_lng', value: String(geofence_lng) });
      if (geofence_radius !== undefined) updates.push({ key: 'geofence_radius', value: String(geofence_radius) });
      if (office_name !== undefined) updates.push({ key: 'office_name', value: String(office_name) });
      if (office_address !== undefined) updates.push({ key: 'office_address', value: String(office_address) });

      for (const upd of updates) {
        await supabase.from('settings').upsert(upd, { onConflict: 'key' });
      }

      await supabase.from('logs').insert({
        employee_id: req.user.id,
        event_type: 'System Update',
        location: 'Database Settings',
        details: details
      });
    }

    res.json({ success: true, message: 'Settings updated successfully in cloud and local cache.' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/settings/geofence
// @desc    Save newly captured polygon geofence (Admin only)
router.post('/geofence', requireAdmin, async (req, res, next) => {
  const { office_name, polygon_coordinates } = req.body;
  const db = getDb();
  try {
    if (!polygon_coordinates || !Array.isArray(polygon_coordinates) || polygon_coordinates.length < 3) {
      return res.status(400).json({ success: false, message: 'Invalid polygon geometry. At least 3 points are required.' });
    }
    
    const isSupabaseLive = await checkSupabaseConnection();
    const details = `Admin captured new Polygon Geoboundary for ${office_name || 'Main Office'} with ${polygon_coordinates.length} vertices.`;

    // 1. SQLite Fallback Write
    await db.run(
      'INSERT INTO office_geofence (office_name, polygon_coordinates, created_by) VALUES (?, ?, ?)',
      [office_name || 'Main Office', JSON.stringify(polygon_coordinates), req.user.id]
    );
    await db.run(
      'INSERT INTO logs (employee_id, event_type, location, details) VALUES (?, ?, ?, ?)',
      [req.user.id, 'System Update', 'Database Settings', details]
    );

    // 2. Supabase Cloud Write
    if (isSupabaseLive) {
      await supabase.from('office_geofence').insert({
        office_name: office_name || 'Main Office',
        polygon_coordinates: polygon_coordinates,
        created_by: req.user.id
      });
      await supabase.from('logs').insert({
        employee_id: req.user.id,
        event_type: 'System Update',
        location: 'Database Settings',
        details: details
      });
    }

    res.json({ success: true, message: 'Polygon geofence successfully mapped and secured to cloud.' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/settings/geofence
// @desc    Get the active office polygon geofence
router.get('/geofence', async (req, res, next) => {
  const db = getDb();
  try {
    const isSupabaseLive = await checkSupabaseConnection();
    let activeGeofence = null;

    if (isSupabaseLive) {
      const { data, error } = await supabase.from('office_geofence')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (!error && data) {
        activeGeofence = data;
      }
    }

    if (!activeGeofence) {
      activeGeofence = await db.get('SELECT * FROM office_geofence ORDER BY created_at DESC LIMIT 1');
      if (activeGeofence) {
        activeGeofence.polygon_coordinates = JSON.parse(activeGeofence.polygon_coordinates);
      }
    }

    res.json({ success: true, geofence: activeGeofence || null });
  } catch (error) {
    next(error);
  }
});

export default router;
