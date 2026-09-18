import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const auth = readFileSync('server/auth.ts', 'utf8');
const authRoute = readFileSync('server/routes/auth.ts', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');
const context = readFileSync('src/context/AuthContext.tsx', 'utf8');

assert.match(schema, /model AuthSession/);
assert.match(schema, /token_hash\s+String\s+@unique/);
assert.match(auth, /SESSION_REVOKED/);
assert.match(auth, /hashSessionId/);
assert.match(authRoute, /createAuthSession/);
assert.match(authRoute, /revokeAuthSession/);
assert.doesNotMatch(context, /owner@boomburger\.ru/);
assert.doesNotMatch(context, /Password123!/);
assert.match(compose, /postgres:/);
assert.match(compose, /redis:/);
console.log('STAGE 2 STATIC ACCEPTANCE: 8/8 checks passed');
