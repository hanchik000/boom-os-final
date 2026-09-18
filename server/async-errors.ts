import type { NextFunction, Request, Response, Router } from 'express';

// Express 4 invokes route handlers without awaiting them, so a rejected promise from an
// `async (req, res) => { ... }` handler never reaches the global API error handler: it
// surfaces as an unhandled rejection and the request hangs until the client times out.
//
// Rather than rewriting every route, each router is patched once, in place: every handler
// it has already registered is wrapped so a rejection is forwarded to next(err). The
// existing error middleware then produces the same structured 500 it produces for a
// synchronous throw, which keeps API semantics unchanged.

type AnyHandler = ((...args: any[]) => any) & { __boomAsyncWrapped?: boolean; stack?: unknown };

function wrapHandler(layer: { handle?: AnyHandler }): void {
  const original = layer.handle;
  if (typeof original !== 'function' || original.__boomAsyncWrapped) return;
  // Arity 4 marks an error handler; those already receive failures explicitly.
  if (original.length >= 4) return;

  const wrapped: AnyHandler = function (this: unknown, req: Request, res: Response, next: NextFunction) {
    let result: unknown;
    try {
      result = original.call(this, req, res, next);
    } catch (error) {
      next(error);
      return;
    }
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(next);
    }
    return result;
  };
  wrapped.__boomAsyncWrapped = true;
  Object.defineProperty(wrapped, 'length', { value: original.length, configurable: true });
  layer.handle = wrapped;
}

/**
 * Forward rejected promises from a router's async handlers to Express error handling.
 * Mutates the router in place and returns it. Safe to call more than once.
 */
export function enableAsyncErrorForwarding<T>(router: T): T {
  const stack = (router as unknown as { stack?: unknown[] })?.stack;
  if (!Array.isArray(stack)) return router;

  for (const entry of stack as Array<{ handle?: AnyHandler; route?: { stack?: unknown[] } }>) {
    if (entry.route && Array.isArray(entry.route.stack)) {
      // A concrete route: wrap each handler registered for it.
      for (const routeLayer of entry.route.stack as Array<{ handle?: AnyHandler }>) {
        wrapHandler(routeLayer);
      }
    } else if (entry.handle && Array.isArray((entry.handle as { stack?: unknown[] }).stack)) {
      // A nested router mounted with router.use(...).
      enableAsyncErrorForwarding(entry.handle as unknown as Router);
    } else {
      // Router-level middleware such as router.use(authenticateToken).
      wrapHandler(entry);
    }
  }
  return router;
}
