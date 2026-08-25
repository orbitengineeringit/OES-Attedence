import { getDb } from '../database/db.js';

let isLocked = false;
const queue = [];

async function acquireLock() {
  if (!isLocked) {
    isLocked = true;
    return;
  }
  return new Promise(resolve => queue.push(resolve));
}

function releaseLock() {
  if (queue.length > 0) {
    const next = queue.shift();
    next();
  } else {
    isLocked = false;
  }
}

export async function checkRateLimit(key, max, windowMs) {
  const db = getDb();
  const now = Date.now();
  const engine = db.engine || 'sqlite';
  
  // Clean up expired rate limit records first (non-blocking cleanup)
  try {
    if (engine === 'postgres') {
      await db.run(`DELETE FROM rate_limit_hits WHERE reset_at < $1`, [now]);
    } else {
      await db.run(`DELETE FROM rate_limit_hits WHERE reset_at < ?`, [now]);
    }
  } catch (err) {
    console.error('[RATE LIMIT PRUNE ERROR]:', err);
  }
  
  // Acquire the process-level lock to prevent concurrent transaction nesting on the same connection
  await acquireLock();
  
  try {
    if (engine === 'postgres') {
      await db.run('BEGIN');
    } else {
      await db.run('BEGIN IMMEDIATE');
    }
    
    // 1. Insert row if not exists with hits = 0 so it exists for locking
    if (engine === 'postgres') {
      await db.run(
        `INSERT INTO rate_limit_hits (key, hits, reset_at) VALUES ($1, 0, $2) ON CONFLICT (key) DO NOTHING`,
        [key, now + windowMs]
      );
    } else {
      await db.run(
        `INSERT INTO rate_limit_hits (key, hits, reset_at) VALUES (?, 0, ?) ON CONFLICT (key) DO NOTHING`,
        [key, now + windowMs]
      );
    }
    
    // 2. Select the current hits with lock (FOR UPDATE for Postgres, standard for SQLite)
    let record;
    if (engine === 'postgres') {
      record = await db.get(
        `SELECT hits, reset_at FROM rate_limit_hits WHERE key = $1 FOR UPDATE`,
        [key]
      );
    } else {
      record = await db.get(
        `SELECT hits, reset_at FROM rate_limit_hits WHERE key = ?`,
        [key]
      );
    }
    
    let hits = record.hits;
    let resetAt = Number(record.reset_at);
    
    if (resetAt < now) {
      // Window expired, reset counter
      hits = 1;
      resetAt = now + windowMs;
      if (engine === 'postgres') {
        await db.run(
          `UPDATE rate_limit_hits SET hits = 1, reset_at = $1 WHERE key = $2`,
          [resetAt, key]
        );
      } else {
        await db.run(
          `UPDATE rate_limit_hits SET hits = 1, reset_at = ? WHERE key = ?`,
          [resetAt, key]
        );
      }
      await db.run('COMMIT');
      return { passed: true, remaining: max - 1, reset: resetAt };
    }
    
    if (hits >= max) {
      // Limit exceeded, rollback and reject
      await db.run('ROLLBACK');
      return { passed: false, remaining: 0, reset: resetAt };
    }
    
    // Increment hits
    hits += 1;
    if (engine === 'postgres') {
      await db.run(
        `UPDATE rate_limit_hits SET hits = hits + 1 WHERE key = $1`,
        [key]
      );
    } else {
      await db.run(
        `UPDATE rate_limit_hits SET hits = hits + 1 WHERE key = ?`,
        [key]
      );
    }
    
    await db.run('COMMIT');
    return { passed: true, remaining: max - hits, reset: resetAt };
  } catch (err) {
    try {
      await db.run('ROLLBACK');
    } catch (rollbackErr) {}
    console.error('[RATE LIMIT TRANSACTION ERROR]:', err);
    // Fail-open for safety to prevent checking-in blocks on DB blips, but log warning
    return { passed: true, remaining: 1, reset: now + windowMs };
  } finally {
    releaseLock();
  }
}
