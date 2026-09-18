import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const email = `runtime-${Date.now()}@boom.local`;
const password = process.env.BOOTSTRAP_OWNER_PASSWORD || 'BoomRuntimeOwner18_8!';

async function request(path, options = {}) {
  const res = await fetch(base + path, {
    ...options,
    headers: {'content-type':'application/json', ...(options.headers || {})},
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return {res, body};
}

const health = await request('/api/health');
assert.equal(health.res.status, 200);
assert.equal(health.body?.status, 'HEALTHY');
assert.equal(health.body?.database_status, 'CONNECTED');

// The customer menu is branch-scoped by design (branch isolation), so the public
// endpoint must be reachable without authentication yet still demand a branch.
const publicMenu = await request('/api/public/menu');
assert.notEqual(publicMenu.res.status, 401);
assert.equal(publicMenu.res.status, 400);
assert.equal(publicMenu.body?.code, 'BRANCH_REQUIRED');

const unauthMe = await request('/api/auth/me');
assert.equal(unauthMe.res.status, 401);

const bootstrap = await request('/api/auth/bootstrap', {
  method:'POST',
  body: JSON.stringify({full_name:'Runtime Owner', email, password}),
});
assert.equal(bootstrap.res.status, 201);
assert.ok(bootstrap.body?.token);
const token = bootstrap.body.token;

const secondBootstrap = await request('/api/auth/bootstrap', {
  method:'POST',
  body: JSON.stringify({full_name:'Second Owner', email:`second-${Date.now()}@boom.local`, password}),
});
assert.equal(secondBootstrap.res.status, 409);
assert.equal(secondBootstrap.body?.code, 'BOOTSTRAP_ALREADY_COMPLETED');

const me = await request('/api/auth/me', {headers:{authorization:`Bearer ${token}`}});
assert.equal(me.res.status, 200);
assert.equal(me.body?.user?.email, email);
assert.ok(Array.isArray(me.body?.user?.roleCodes));
assert.ok(me.body.user.roleCodes.includes('OWNER'));

const protectedBranches = await request('/api/branches', {headers:{authorization:`Bearer ${token}`}});
assert.notEqual(protectedBranches.res.status, 401);

const logout = await request('/api/auth/logout', {
  method:'POST', headers:{authorization:`Bearer ${token}`}, body:'{}'
});
assert.equal(logout.res.status, 200);

const meAfterLogout = await request('/api/auth/me', {headers:{authorization:`Bearer ${token}`}});
assert.equal(meAfterLogout.res.status, 401);

console.log('STAGE 18.8 FULL RUNTIME: PASS');
console.log('Checks: health, PostgreSQL, public menu, unauthenticated rejection, bootstrap, bootstrap lock, OWNER login token, /me, protected route, logout, token revocation.');
