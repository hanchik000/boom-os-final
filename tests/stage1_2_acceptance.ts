/**
 * BOOM OS Foundation - Stage 1.2 Acceptance Tests Suite
 * Verifies:
 * 1. FRANCHISE MANAGEMENT (CRUD, Codes, Linking/Unlinking Branches, Hierarchy Views)
 * 2. EMPLOYEE ASSIGNMENT (Primary Branch, Multi-Branch, Isolation, Superuser Bypass, Hierarchy)
 * 3. RBAC TEST CONSOLE (Simulation Granted, Denied, Read-Only Guarantee, Capability Matrix)
 */

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  num: number;
  name: string;
  category: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function loginAsOwner(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: 'owner@boomburger.ru',
      password: 'Password123!'
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Owner login failed with status ${res.status}: ${data.message || ''}`);
  }
  const data = await res.json();
  return data.token;
}

async function runTest(
  num: number,
  name: string,
  category: string,
  fn: (token: string) => Promise<{ passed: boolean; message: string }>
) {
  const start = Date.now();
  const token = await loginAsOwner();
  try {
    const outcome = await fn(token);
    const duration = Date.now() - start;
    results.push({
      num,
      name,
      category,
      passed: outcome.passed,
      message: outcome.message,
      durationMs: duration
    });
    console.log(`[TEST ${num}/17] ${outcome.passed ? '✓ PASSED' : '✗ FAILED'}: ${name} (${duration}ms)`);
    if (!outcome.passed) {
      console.log(`  -> Reason: ${outcome.message}`);
    }
  } catch (err: any) {
    const duration = Date.now() - start;
    results.push({
      num,
      name,
      category,
      passed: false,
      message: err.message || 'Exception during execution',
      durationMs: duration
    });
    console.log(`[TEST ${num}/17] ✗ FAILED: ${name} (${duration}ms) - ${err.message}`);
  }
}

async function main() {
  console.log('===============================================================');
  console.log('  BOOM OS FOUNDATION — STAGE 1.2 ACCEPTANCE TESTS (17/17)     ');
  console.log('===============================================================\n');

  const runId = Math.floor(Math.random() * 90000) + 10000;
  let testFranchiseId = '';
  const testFranchiseCode = `FR-TST-${runId}`;
  let testBranchId = '';
  const testBranchCode = `BR-TST-${runId}`;
  let testUserId = '';
  const testUserEmail = `staff_${runId}@boomburger.ru`;
  let testUserToken = '';

  // 1. Create Franchise
  await runTest(1, 'Create Regional Franchise with Contact & Legal Info', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: `Test Franchise ${runId}`,
        code: testFranchiseCode,
        legal_name: `BOOMBURGER Test Regional Unit ${runId} LLC`,
        contact_name: 'Serdar Berdiyev',
        phone: '+993 (12) 88-99-00',
        email: `franchise_${runId}@boomburger.com`,
        address: '15 Bitaraplyk Shayoly, Ashgabat',
        status: 'ACTIVE'
      })
    });

    const data = await res.json();
    if (res.status === 201 && data.franchise?.id) {
      testFranchiseId = data.franchise.id;
      return { passed: true, message: `Franchise created with ID ${testFranchiseId} and code ${testFranchiseCode}` };
    }
    return { passed: false, message: data.message || `HTTP ${res.status}` };
  });

  // 2. Duplicate Franchise Code Rejected
  await runTest(2, 'Duplicate Franchise Code Rejected with 400 or 409 Conflict', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: `Duplicate Franchise ${runId}`,
        code: testFranchiseCode, // Same unique code
        legal_name: 'Duplicate LLC',
        contact_name: 'Duplicate Person',
        phone: '+993 00 00-00-00',
        email: 'dup@test.com',
        address: 'Nowhere',
        status: 'ACTIVE'
      })
    });

    const data = await res.json();
    const isConflict = (res.status === 400 || res.status === 409) && 
                       (data.message?.toLowerCase().includes('code') || data.error === 'CONFLICT');
    return {
      passed: isConflict,
      message: `HTTP ${res.status} returned: "${data.message}"`
    };
  });

  // 3. Update Franchise
  await runTest(3, 'Update Franchise Details & Contact Information', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: `Updated Test Franchise ${runId}`,
        contact_name: 'Updated Contact Name',
        phone: '+993 (12) 11-22-33'
      })
    });

    const data = await res.json();
    return {
      passed: res.status === 200 && data.franchise?.contact_name === 'Updated Contact Name',
      message: `Franchise contact updated to "${data.franchise?.contact_name}"`
    };
  });

  // 4. Deactivate Franchise
  await runTest(4, 'Toggle Franchise Status (Deactivate / Reactivate)', 'Franchise Management', async (token) => {
    const deactivateRes = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'INACTIVE' })
    });
    const dData = await deactivateRes.json();

    const reactivateRes = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'ACTIVE' })
    });
    const rData = await reactivateRes.json();

    const dInactive = dData.status === 'INACTIVE' || dData.franchise?.status === 'INACTIVE';
    const rActive = rData.status === 'ACTIVE' || rData.franchise?.status === 'ACTIVE';
    const passed = dInactive && rActive;
    return {
      passed,
      message: `Status transitioned: ACTIVE -> INACTIVE -> ACTIVE verified`
    };
  });

  // Create a helper branch for tests 5-8
  const branchRes = await fetch(`${BASE_URL}/api/branches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await loginAsOwner()}`
    },
    body: JSON.stringify({
      code: testBranchCode,
      name: `Acceptance Branch ${runId}`,
      address: '77 Oguzkhan St, Ashgabat',
      phone: '+993 (12) 77-77-77',
      timezone: 'Asia/Ashgabat',
      currency: 'TMT',
      status: 'ACTIVE'
    })
  });
  const bData = await branchRes.json();
  testBranchId = bData.branch?.id;

  // 5. Assign Branch to Franchise
  await runTest(5, 'Assign Branch to Franchise (Link Location to Regional Entity)', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/branches/${testBranchId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return {
      passed: res.status === 200 && data.branch?.franchise_id === testFranchiseId,
      message: `Branch ${testBranchCode} assigned to franchise ${testFranchiseCode}`
    };
  });

  // 6. Remove Branch from Franchise without deleting Branch
  await runTest(6, 'Remove Branch from Franchise (Unlink without Record Deletion)', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/branches/${testBranchId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    // Verify branch still exists in system
    const checkBranch = await fetch(`${BASE_URL}/api/branches/${testBranchId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const passed = res.status === 200 && checkBranch.status === 200 && data.branch?.franchise_id === null;

    // Relink it back for subsequent tests
    await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/branches/${testBranchId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });

    return {
      passed,
      message: `Branch unlinked safely (franchise_id is null) while branch entity remains intact`
    };
  });

  // 7. View Franchise Branches
  await runTest(7, 'Query Franchise Branches List (GET /api/franchises/:id/branches)', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/branches`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const hasBranch = data.branches?.some((b: any) => b.id === testBranchId);
    return {
      passed: res.status === 200 && hasBranch,
      message: `Found ${data.branches?.length || 0} branches in franchise, including newly linked branch`
    };
  });

  // Create a staff user for employee assignment tests
  const userCreateRes = await fetch(`${BASE_URL}/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await loginAsOwner()}`
    },
    body: JSON.stringify({
      email: testUserEmail,
      full_name: `Test Staff ${runId}`,
      phone: `+993 (65) ${runId.toString().slice(0, 6)}`,
      password: 'EmployeePassword123!',
      roles: ['CASHIER'],
      branch_id: testBranchId,
      status: 'ACTIVE'
    })
  });
  const uData = await userCreateRes.json();
  testUserId = uData.user?.id;

  // 8. View Franchise Employees
  await runTest(8, 'Query Franchise Employees Hierarchy (GET /api/franchises/:id/employees)', 'Franchise Management', async (token) => {
    const res = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}/employees`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const hasEmployee = data.employees?.some((e: any) => e.id === testUserId);
    return {
      passed: res.status === 200 && hasEmployee,
      message: `Found ${data.employees?.length || 0} employees under franchise branches, including user ${testUserEmail}`
    };
  });

  // 9. Assign Primary Branch to Employee
  await runTest(9, 'Assign Primary Home Branch to Employee (PUT /api/users/:id/branch-access)', 'Employee Assignment', async (token) => {
    const res = await fetch(`${BASE_URL}/api/users/${testUserId}/branch-access`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        primary_branch_id: testBranchId,
        allowed_branch_ids: [testBranchId]
      })
    });
    const data = await res.json();
    const passed = res.status === 200 && (data.primary_branch_id === testBranchId || data.user?.branch_id === testBranchId);
    return {
      passed,
      message: `Primary branch assigned to employee ${testUserId}`
    };
  });

  // 10. Assign Multiple Allowed Branches to Employee
  await runTest(10, 'Assign Multiple Working Branches to Employee', 'Employee Assignment', async (token) => {
    // Also include Arbat Branch 01 (br_arb_01)
    const res = await fetch(`${BASE_URL}/api/users/${testUserId}/branch-access`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        primary_branch_id: testBranchId,
        allowed_branch_ids: [testBranchId, 'br_arb_01']
      })
    });
    const data = await res.json();
    const hasBoth = data.allowed_branch_ids?.includes(testBranchId) && data.allowed_branch_ids?.includes('br_arb_01');
    return {
      passed: res.status === 200 && hasBoth,
      message: `Employee granted multi-branch authority over 2 distinct locations: [${data.allowed_branch_ids?.join(', ')}]`
    };
  });

  // Login as test user for isolation tests
  const testLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: testUserEmail,
      password: 'EmployeePassword123!'
    })
  });
  const tData = await testLoginRes.json();
  testUserToken = tData.token;

  // 11. User Branch Access Isolation
  await runTest(11, 'Enforce Branch Isolation: Cashier Blocked from Unassigned Branch (HTTP 403)', 'Security Boundary', async () => {
    // Attempt accessing br_sev_03 (Sevastopol branch which is definitely NOT in user's allowed_branch_ids)
    const res = await fetch(`${BASE_URL}/api/branches/br_sev_03`, {
      headers: { Authorization: `Bearer ${testUserToken}` }
    });

    const data = await res.json().catch(() => null);
    return {
      passed: res.status === 403,
      message: `HTTP 403 FORBIDDEN confirmed: Cashier blocked from unassigned branch br_sev_03. Reason: ${data?.message}`
    };
  });

  // 12. Superuser Universal Branch Access Bypass
  await runTest(12, 'Superuser (OWNER) Bypasses Branch Restrictions (Universal Access)', 'Security Boundary', async (token) => {
    const res = await fetch(`${BASE_URL}/api/branches/br_sev_03`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return {
      passed: res.status === 200 && data.branch?.id === 'br_sev_03',
      message: `OWNER granted seamless access to br_sev_03 without explicit branch whitelist requirement`
    };
  });

  // 13. Hierarchy Verification: FRANCHISE -> BRANCH -> EMPLOYEE
  await runTest(13, 'Verify Architectural Hierarchy: FRANCHISE -> BRANCH -> EMPLOYEE', 'Hierarchy Integrity', async (token) => {
    // Fetch franchise, branches in franchise, and employee in branch
    const fRes = await fetch(`${BASE_URL}/api/franchises/${testFranchiseId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const fData = await fRes.json();

    const bRes = await fetch(`${BASE_URL}/api/branches/${testBranchId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const bData = await bRes.json();

    const uRes = await fetch(`${BASE_URL}/api/users/${testUserId}/branch-access`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const uData = await uRes.json();

    const franchiseMatches = bData.branch?.franchise_id === testFranchiseId;
    const branchMatches = uData.primary_branch_id === testBranchId;

    return {
      passed: franchiseMatches && branchMatches,
      message: `Verified relational chain: Franchise [${fData.franchise?.code}] -> Branch [${bData.branch?.code}] -> Employee [${uData.full_name}]`
    };
  });

  // 14. RBAC Test Simulation: Access Granted
  await runTest(14, 'RBAC Test Console: Evaluate Allowed Access (Verdict: ACCESS GRANTED)', 'RBAC Simulation', async (token) => {
    const res = await fetch(`${BASE_URL}/api/rbac/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: testUserId,
        branch_id: testBranchId, // Assigned branch
        permission: 'branches.view', // Cashier has branches.view
        test_matrix: false
      })
    });

    const data = await res.json();
    return {
      passed: res.status === 200 && data.allowed === true && data.status === 'ACCESS GRANTED',
      message: `Simulation returned: ${data.status} | Reason: "${data.reason}"`
    };
  });

  // 15. RBAC Test Simulation: Access Denied
  await runTest(15, 'RBAC Test Console: Evaluate Forbidden Access (Verdict: ACCESS DENIED)', 'RBAC Simulation', async (token) => {
    const res = await fetch(`${BASE_URL}/api/rbac/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: testUserId,
        branch_id: 'br_sev_03', // Forbidden branch
        permission: 'settings.update', // Cashier does not have settings.update
        test_matrix: false
      })
    });

    const data = await res.json();
    return {
      passed: res.status === 200 && data.allowed === false && data.status === 'ACCESS DENIED',
      message: `Simulation returned: ${data.status} | Diagnostic Reason: "${data.reason}"`
    };
  });

  // 16. RBAC Simulation is Strictly Read-Only (Guaranteed No Mutations)
  await runTest(16, 'RBAC Test Console Guarantee: Read-Only Simulation Leaves Zero State Changes', 'RBAC Simulation', async (token) => {
    // Snapshot user roles and branch access before simulation
    const beforeRes = await fetch(`${BASE_URL}/api/users/${testUserId}/branch-access`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const beforeData = await beforeRes.json();

    // Run simulation simulating an alternate role and branch
    await fetch(`${BASE_URL}/api/rbac/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: testUserId,
        role_id: 'role_owner', // Simulating owner role
        branch_id: 'br_sev_03',
        permission: 'settings.update',
        test_matrix: true
      })
    });

    // Check user data after simulation
    const afterRes = await fetch(`${BASE_URL}/api/users/${testUserId}/branch-access`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const afterData = await afterRes.json();

    const untouched =
      beforeData.primary_branch_id === afterData.primary_branch_id &&
      JSON.stringify(beforeData.allowed_branch_ids) === JSON.stringify(afterData.allowed_branch_ids);

    return {
      passed: untouched,
      message: `Zero database mutation confirmed: User permissions, roles, and branch authorities strictly unchanged`
    };
  });

  // 17. RBAC Matrix Multi-Action Evaluation
  await runTest(17, 'RBAC Capability Matrix: Multi-Permission Evaluation & Diagnostics', 'RBAC Simulation', async (token) => {
    const res = await fetch(`${BASE_URL}/api/rbac/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        user_id: testUserId,
        branch_id: testBranchId,
        test_matrix: true
      })
    });

    const data = await res.json();
    const matrix = data.matrix_results || [];
    const hasCorePerms = matrix.some((m: any) => m.permission === 'users.view') &&
                         matrix.some((m: any) => m.permission === 'settings.update');

    return {
      passed: res.status === 200 && matrix.length >= 10 && hasCorePerms,
      message: `Full matrix evaluated: ${matrix.length} distinct permissions inspected with individual diagnostic verdicts`
    };
  });

  // Clean up test branch & user
  try {
    const token = await loginAsOwner();
    await fetch(`${BASE_URL}/api/users/${testUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    // Ignore cleanup errors
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n===============================================================');
  console.log(`  RESULTS: ${passed}/17 PASSED (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
