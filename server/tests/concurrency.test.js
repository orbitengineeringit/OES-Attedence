process.env.DB_FILE = './concurrency_test_database.sqlite';

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { initializeDatabase } from '../database/db.js';
import { checkRateLimit } from '../services/rateLimiter.js';
import fs from 'fs';

describe('Distributed Rate Limiter Concurrency & Atomicity', () => {
  let db;

  beforeAll(async () => {
    if (fs.existsSync('./concurrency_test_database.sqlite')) {
      try {
        fs.unlinkSync('./concurrency_test_database.sqlite');
      } catch (e) {}
    }
    db = await initializeDatabase();
  });

  afterAll(async () => {
    if (fs.existsSync('./concurrency_test_database.sqlite')) {
      try {
        fs.unlinkSync('./concurrency_test_database.sqlite');
      } catch (e) {}
    }
  });

  test('should enforce rate limit atomically under concurrent load', async () => {
    const key = 'test-concurrent-key';
    const maxHits = 10;
    const windowMs = 60000;
    const totalRequests = 15;

    // Fire 15 simultaneous requests concurrently
    const promises = Array.from({ length: totalRequests }).map(() =>
      checkRateLimit(key, maxHits, windowMs)
    );

    const results = await Promise.all(promises);

    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;

    console.log(`[CONCURRENCY TEST] Total: ${totalRequests}, Passed: ${passedCount}, Failed: ${failedCount}`);

    expect(passedCount).toBe(maxHits); // Exactly 10 must pass
    expect(failedCount).toBe(totalRequests - maxHits); // Exactly 5 must fail
  });
});
