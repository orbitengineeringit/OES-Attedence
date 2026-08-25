process.env.DB_FILE = './cache_test_database.sqlite';

import { describe, test, expect, beforeAll } from 'vitest';
import { descriptorCache } from '../services/descriptorCache.js';
import { initializeDatabase, getDb } from '../database/db.js';
import fs from 'fs';

describe('Descriptor Cache Service', () => {
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
    if (fs.existsSync('./cache_test_database.sqlite')) {
      try {
        fs.unlinkSync('./cache_test_database.sqlite');
      } catch (e) {}
    }
    // Initialize database
    db = await initializeDatabase();
    await descriptorCache.initialize(db);
  });

  test('should cache and evict descriptors correctly in-memory', () => {
    const originalSize = descriptorCache.size();
    const descAlice = generateTestDescriptor('alice_smith');
    
    descriptorCache.set('OES/999', 'Alice Test', 'alice@test.com', 'employee', descAlice);
    expect(descriptorCache.size()).toBe(originalSize + 1);

    // Evict it
    descriptorCache.remove('OES/999');
    expect(descriptorCache.size()).toBe(originalSize);
  });

  test('should match live descriptors against cache within threshold', () => {
    const descBob = generateTestDescriptor('bob_jones');
    descriptorCache.set('OES/888', 'Bob Test', 'bob@test.com', 'employee', descBob);

    // Match exact Bob
    const exactMatch = descriptorCache.match(descBob, 0.68);
    expect(exactMatch.success).toBe(true);
    expect(exactMatch.match.id).toBe('OES/888');
    expect(exactMatch.confidenceScore).toBe(100);

    // Match Bob with some small noise/perturbation
    const perturbedBob = descBob.map(v => v + (Math.random() - 0.5) * 0.01);
    const noisyMatch = descriptorCache.match(perturbedBob, 0.68);
    expect(noisyMatch.success).toBe(true);
    expect(noisyMatch.match.id).toBe('OES/888');

    // Clean up
    descriptorCache.remove('OES/888');
  });

  test('should detect duplicates for separate employees but permit re-registrations for same employee', () => {
    const descAlice = generateTestDescriptor('alice_smith');
    descriptorCache.set('OES/101', 'Alice Smith', 'alice@company.com', 'employee', descAlice);

    // Same face -> Same employee (update)
    const sameEmpResult = descriptorCache.checkForDuplicate(descAlice, 'OES/101', 0.58);
    expect(sameEmpResult.isDuplicate).toBe(false);

    // Same face -> Different employee
    const diffEmpResult = descriptorCache.checkForDuplicate(descAlice, 'OES/102', 0.58);
    expect(diffEmpResult.isDuplicate).toBe(true);
    expect(diffEmpResult.matchedEmp.id).toBe('OES/101');

    // Different face -> Different employee
    const descBob = generateTestDescriptor('bob_jones_unique');
    const diffFaceResult = descriptorCache.checkForDuplicate(descBob, 'OES/102', 0.58);
    expect(diffFaceResult.isDuplicate).toBe(false);

    // Clean up
    descriptorCache.remove('OES/101');
  });
});
