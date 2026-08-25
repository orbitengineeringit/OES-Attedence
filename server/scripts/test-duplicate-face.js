import { descriptorCache } from '../services/descriptorCache.js';

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

async function runDuplicateFaceTests() {
  console.log(`=============================================================`);
  console.log(`  RUNNING DUPLICATE FACE REGISTRATION PROTECTION VERIFICATION`);
  console.log(`=============================================================`);

  // Seed cache with Employee 1 (Alice - OES/101)
  const descAlice = generateTestDescriptor('alice_smith');
  descriptorCache.set('OES/101', 'Alice Smith', 'alice@company.com', 'employee', descAlice);

  // Scenario 1: Same face -> Same employee (Face Re-registration/Update) -> MUST ALLOW
  const checkSameEmp = descriptorCache.checkForDuplicate(descAlice, 'OES/101', 0.58);
  console.log(`[TEST 1] Same face -> Same employee (OES/101):`, checkSameEmp.isDuplicate ? 'REJECTED ❌' : 'ALLOWED ✅ (PASSED)');
  if (checkSameEmp.isDuplicate) throw new Error('Test 1 failed: Re-registration for same employee was incorrectly blocked!');

  // Scenario 2: Same face -> Different employee (Bob - OES/102) -> MUST REJECT
  const checkDiffEmpSameFace = descriptorCache.checkForDuplicate(descAlice, 'OES/102', 0.58);
  console.log(`[TEST 2] Same face -> Different employee (OES/102):`, checkDiffEmpSameFace.isDuplicate ? 'REJECTED ✅ (PASSED)' : 'ALLOWED ❌');
  if (!checkDiffEmpSameFace.isDuplicate) throw new Error('Test 2 failed: Duplicate face was not blocked!');
  console.log(`         Matched Existing Employee: ID ${checkDiffEmpSameFace.matchedEmp.id} (${checkDiffEmpSameFace.matchedEmp.name})`);

  // Scenario 3: Different face -> Different employee (Bob - OES/102) -> MUST ALLOW
  const descBob = generateTestDescriptor('bob_jones_unique');
  const checkDiffEmpDiffFace = descriptorCache.checkForDuplicate(descBob, 'OES/102', 0.58);
  console.log(`[TEST 3] Different face -> Different employee (OES/102):`, checkDiffEmpDiffFace.isDuplicate ? 'REJECTED ❌' : 'ALLOWED ✅ (PASSED)');
  if (checkDiffEmpDiffFace.isDuplicate) throw new Error('Test 3 failed: Unique face was incorrectly blocked!');

  // Scenario 4: Different face -> Same employee (Alice Face Update) -> MUST ALLOW & UPDATE
  const descAliceUpdated = generateTestDescriptor('alice_smith_updated_pose');
  const checkUpdateFace = descriptorCache.checkForDuplicate(descAliceUpdated, 'OES/101', 0.58);
  console.log(`[TEST 4] Different face -> Same employee update (OES/101):`, checkUpdateFace.isDuplicate ? 'REJECTED ❌' : 'ALLOWED ✅ (PASSED)');
  if (checkUpdateFace.isDuplicate) throw new Error('Test 4 failed: Face update for same employee was blocked!');

  console.log(`=============================================================`);
  console.log(`  ALL 4 DUPLICATE FACE REGISTRATION SCENARIOS PASSED 100%!`);
  console.log(`=============================================================`);
}

runDuplicateFaceTests().catch((err) => {
  console.error('[TEST SUITE FAILURE]:', err);
  process.exit(1);
});
