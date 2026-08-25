process.env.DB_FILE = './production_cache_test_database.sqlite';
process.env.FORCE_DB_DESCRIPTOR_CACHE = 'true';

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { descriptorCache } from '../services/descriptorCache.js';
import { initializeDatabase } from '../database/db.js';
import fs from 'fs';

describe('Production Serverless Descriptor Cache Path', () => {
  let db;

  // Helper to generate synthetic test 128-float descriptors
  function generateTestDescriptor(seedStr) {
    const desc = [];
    const lower = seedStr.toLowerCase();
    for (let i = 0; i < 128; i++) {
      let charVal = lower.charCodeAt(i % lower.length) / 128.0;
      desc.push(Math.sin(i * charVal) * 0.8 + 0.1);
    }
    return desc;
  }

  beforeAll(async () => {
    if (fs.existsSync('./production_cache_test_database.sqlite')) {
      try {
        fs.unlinkSync('./production_cache_test_database.sqlite');
      } catch (e) {}
    }
    db = await initializeDatabase();
  });

  afterAll(async () => {
    if (fs.existsSync('./production_cache_test_database.sqlite')) {
      try {
        fs.unlinkSync('./production_cache_test_database.sqlite');
      } catch (e) {}
    }
  });

  test('should match and immediately reflect database additions/deletions on the production serverless path', async () => {
    const empId = 'OES/PROD_TEST_99';
    const descArray = generateTestDescriptor('prod_cache_emp');
    const descJson = JSON.stringify(descArray);

    // 1. Clear in-memory cache completely to ensure memory path cannot yield matches
    descriptorCache.cache.clear();

    // 2. Initial match attempt: must fail (empty DB and empty cache)
    const matchBefore = await descriptorCache.match(db, descArray, 0.68);
    expect(matchBefore.success).toBe(false);

    // 3. Write directly to DB tables (mimics another serverless function registering a new employee)
    await db.run(
      `INSERT INTO employees (id, name, email, password, role, department) VALUES (?, ?, ?, ?, ?, ?)`,
      [empId, 'Prod Test', 'prod@test.com', 'pass', 'employee', 'Engineering']
    );
    await db.run(
      `INSERT INTO face_descriptors (employee_id, descriptor_json) VALUES (?, ?)`,
      [empId, descJson]
    );

    // 4. Match attempt on production path: must succeed on-the-fly from the DB!
    const matchAfter = await descriptorCache.match(db, descArray, 0.68);
    expect(matchAfter.success).toBe(true);
    expect(matchAfter.match.id).toBe(empId);
    expect(matchAfter.match.name).toBe('Prod Test');

    // 5. Delete employee directly from DB (mimics another serverless function deleting the employee)
    await db.run(`DELETE FROM face_descriptors WHERE employee_id = ?`, [empId]);
    await db.run(`DELETE FROM employees WHERE id = ?`, [empId]);

    // 6. Match attempt on production path: must fail immediately without restart (no stale cache!)
    const matchAfterDelete = await descriptorCache.match(db, descArray, 0.68);
    expect(matchAfterDelete.success).toBe(false);
  });

  test('should prune expired challenge nonces inline during new nonce writes', async () => {
    const expiredSessionId = 'OES/EXPIRED_SESSION_123';
    const activeSessionId = 'OES/ACTIVE_SESSION_456';
    const now = Date.now();

    // 1. Manually insert an expired nonce (created 61 seconds ago) directly into the database
    await db.run(
      `INSERT INTO challenge_nonces (session_id, challenge_type, created_at) VALUES (?, ?, ?)`,
      [expiredSessionId, 'blink', now - 61000]
    );

    // Verify it exists in the database
    const checkBefore = await db.get(`SELECT session_id FROM challenge_nonces WHERE session_id = ?`, [expiredSessionId]);
    expect(checkBefore).toBeDefined();
    expect(checkBefore.session_id).toBe(expiredSessionId);

    // 2. Trigger a new nonce generation write via challengeStore
    const { challengeStore } = await import('../services/challengeStore.js');
    await challengeStore.set(activeSessionId, 'turn_left');

    // 3. Confirm that the expired nonce was auto-pruned and is now gone!
    const checkAfterPrune = await db.get(`SELECT session_id FROM challenge_nonces WHERE session_id = ?`, [expiredSessionId]);
    expect(checkAfterPrune).toBeUndefined();

    // Confirm that the newly created active nonce exists
    const checkActive = await db.get(`SELECT session_id FROM challenge_nonces WHERE session_id = ?`, [activeSessionId]);
    expect(checkActive).toBeDefined();
    expect(checkActive.session_id).toBe(activeSessionId);
  });
});
