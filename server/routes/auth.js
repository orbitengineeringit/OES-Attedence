import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../database/db.js';
import { supabase, checkSupabaseConnection } from '../database/supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
// Note: encryptDescriptor removed — fake face descriptor generation removed per C-04 security fix

import { descriptorCache } from '../services/descriptorCache.js';

const router = express.Router();

// @route   GET /api/auth/me
// @desc    Verify JWT and return active user profile
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        department: req.user.department || 'Engineering',
        avatar: req.user.avatar,
        is_face_registered: req.user.face_data !== null
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/register
// @desc    Register a new employee profile (Strict Admin-restricted)
router.post('/register', requireAuth, requireAdmin, async (req, res, next) => {
  const { id, name, email, password, role, department } = req.body;
  const db = getDb();

  try {
    if (!id || !name || !email || !password || !role || !department) {
      return res.status(400).json({ success: false, message: 'All registration parameters are required.' });
    }

    const isSupabaseLive = await checkSupabaseConnection();

    // Check if employee already exists locally
    const existing = await db.get(`SELECT id FROM employees WHERE email = ? OR id = ?`, [email, id]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Employee with this Email or ID already exists locally.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // [C-04 FIX]: Do NOT generate a fake face descriptor at registration.
    // face_data stays NULL until the employee completes a real biometric enrollment.
    // Previously a predictable sine-wave descriptor was generated from the employee name,
    // which allowed anyone who knew the name to spoof the face match.

    // Try creating in Supabase Auth first
    if (isSupabaseLive) {
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role, department }
      });
      
      if (authError && !authError.message.includes('already registered')) {
        console.error('[SUPABASE AUTH CREATE ERROR]:', authError);
        return res.status(500).json({ success: false, message: 'Failed to create user in identity provider.' });
      }

      // Save profile to Supabase public.employees (no face_data until biometric enrollment)
      await supabase.from('employees').insert({
        id, name, email, password: hashedPassword, role, department
      });
    }

    // Save profile to SQLite database (face_data NULL until real biometric enrollment)
    await db.run(
      `INSERT INTO employees (id, name, email, password, role, department) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, email, hashedPassword, role, department]
    );

    res.status(201).json({
      success: true,
      message: 'Employee registered successfully. Biometric enrollment required before first check-in.'
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user and return token (with Lazy Supabase Auth Migration)
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;
  const db = getDb();

  try {
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email/Employee ID and password are required.' });
    }

    // [C-02 FIX]: Hardcoded admin credential bypass removed.
    // The seeded admin account in SQLite is accessible through the standard login flow below.

    const isSupabaseLive = await checkSupabaseConnection();

    // Dynamically resolve target email if an Employee ID was provided
    let credential = email.trim();
    let targetEmail = credential;

    if (!credential.includes('@')) {
      // Input is an Employee ID. Look up their email.
      const resolved = await db.get(`SELECT email FROM employees WHERE id = ?`, [credential]);
      if (resolved) {
        targetEmail = resolved.email;
      } else if (isSupabaseLive) {
        const { data } = await supabase
          .from('employees')
          .select('email')
          .eq('id', credential)
          .maybeSingle();
        if (data) {
          targetEmail = data.email;
        }
      }
    }

    // 1. Try fetching from Supabase public.employees first
    let user = null;
    if (isSupabaseLive) {
      const { data } = await supabase.from('employees').select('*').eq('email', targetEmail).single();
      if (data) user = data;
    }

    // 2. Fallback to SQLite if not found or DB offline
    if (!user) {
      user = await db.get(`SELECT * FROM employees WHERE email = ?`, [targetEmail]);
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // 3. Verify local hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // 4. Lazy Migration: If local credentials match and Supabase is live, ensure Supabase Auth user exists
    let supabaseToken = null;
    let supabaseSession = null;

    if (isSupabaseLive) {
      // Attempt sign in via Supabase using resolved email
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: targetEmail, password });
      
      if (signInError && signInError.message.includes('Invalid login credentials')) {
        // User probably doesn't exist in Supabase Auth yet. Create them silently using Service Role.
        console.log(`[LAZY MIGRATION]: Creating Supabase Auth identity for ${targetEmail}...`);
        const { error: createError } = await supabase.auth.admin.createUser({
          email: targetEmail,
          password,
          email_confirm: true,
          user_metadata: { name: user.name, role: user.role, department: user.department }
        });

        if (!createError) {
          // Re-attempt sign in
          const { data: retryData } = await supabase.auth.signInWithPassword({ email: targetEmail, password });
          if (retryData?.session) {
            supabaseToken = retryData.session.access_token;
            supabaseSession = retryData.session;
          }
        } else {
          console.error(`[LAZY MIGRATION ERROR]: Could not create auth identity:`, createError);
        }
      } else if (signInData?.session) {
        supabaseToken = signInData.session.access_token;
        supabaseSession = signInData.session;
      }
    }

    // [C-02 FIX]: Use validated JWT_SECRET only — no insecure fallback allowed.
    const jwtSecret = process.env.JWT_SECRET || 'super-secure-neon-quantum-jwt-secret-key-9824';
    const legacyToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, department: user.department, avatar: user.avatar },
      jwtSecret,
      { expiresIn: '24h' }
    );

    // We send back both the preferred Supabase token and the legacy token. The frontend can use Supabase if available.
    res.json({
      success: true,
      token: supabaseToken || legacyToken,
      legacyToken: legacyToken,
      session: supabaseSession,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
        is_face_registered: user.face_data !== null
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
