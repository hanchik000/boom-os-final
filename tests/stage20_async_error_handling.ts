// BOOM OS — async request error handling.
//
// Express 4 does not await route handlers, so before Stage 20 a rejected promise from an
// async handler escaped as an unhandled rejection and the request hung until the client
// gave up. This proves the centralized fix: the rejection reaches the global API error
// handler and the caller gets the same structured 500 a synchronous throw produces.
import assert from 'node:assert/strict';
import express, { NextFunction, Request, Response } from 'express';
import { enableAsyncErrorForwarding } from '../server/async-errors';

const app = express();
app.use(express.json());

const router = express.Router();
let middlewareRan = false;

// Router-level middleware must keep working after patching.
router.use((req: Request, _res: Response, next: NextFunction) => { middlewareRan = true; next(); });
router.get('/async-throw', async (_req: Request, _res: Response) => {
  throw Object.assign(new Error('Simulated async failure'), { code: 'SIMULATED_ASYNC_FAILURE' });
});
router.get('/async-rejection', async (_req: Request, _res: Response) => {
  await Promise.reject(new Error('Simulated rejected promise'));
});
router.get('/sync-throw', (_req: Request, _res: Response) => {
  throw new Error('Simulated sync failure');
});
router.get('/ok', async (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Nested router, to prove the patch recurses.
const nested = express.Router();
nested.get('/deep-throw', async () => { throw new Error('Simulated nested failure'); });
router.use('/nested', nested);

enableAsyncErrorForwarding(router);
app.use('/api/test', router);

// The same shape as the global API error handler in server.ts.
app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred in BOOM OS backend.',
  });
});

const server = app.listen(0);
await new Promise<void>(resolve => server.once('listening', () => resolve()));
const port = (server.address() as any).port;

// A hang is the regression under test, so every call is time-boxed.
async function call(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (error: any) {
    throw new Error(`${path} did not answer (${error.message}) — the request hung`);
  } finally {
    clearTimeout(timer);
  }
}

let unhandled: unknown = null;
process.on('unhandledRejection', reason => { unhandled = reason; });

const asyncThrow = await call('/api/test/async-throw');
assert.equal(asyncThrow.status, 500, 'async throw must answer with 500, not hang');
assert.equal(asyncThrow.body?.error, 'INTERNAL_SERVER_ERROR');
assert.equal(asyncThrow.body?.code, 'SIMULATED_ASYNC_FAILURE', 'error code must survive');
assert.ok(middlewareRan, 'router-level middleware must still run after patching');

const asyncRejection = await call('/api/test/async-rejection');
assert.equal(asyncRejection.status, 500, 'rejected promise must answer with 500');

const syncThrow = await call('/api/test/sync-throw');
assert.equal(syncThrow.status, 500, 'synchronous throw must keep its existing behaviour');

const nestedThrow = await call('/api/test/nested/deep-throw');
assert.equal(nestedThrow.status, 500, 'nested router failures must be forwarded too');

const ok = await call('/api/test/ok');
assert.equal(ok.status, 200, 'successful responses must be unaffected');
assert.deepEqual(ok.body, { ok: true });

await new Promise(resolve => setImmediate(resolve));
assert.equal(unhandled, null, 'no failure may escape as an unhandled rejection');

server.close();
console.log('STAGE 20 ASYNC ERROR HANDLING: PASS (6/6)');
console.log('Checks: async throw, rejected promise, sync throw, nested router, success path, no unhandled rejection.');
