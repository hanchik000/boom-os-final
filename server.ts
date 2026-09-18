import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDatabase, getDb, queryOne } from './server/db';
import { config } from './server/config';
import { checkRedis } from './server/redis';
import { seedInitialData } from './server/seed';
import { basicRateLimiter } from './server/auth';
import { docsRouter } from './server/openapi';

import authRouter from './server/routes/auth';
import usersRouter from './server/routes/users';
import branchesRouter from './server/routes/branches';
import rolesRouter from './server/routes/roles';
import permissionsRouter from './server/routes/permissions';
import settingsRouter from './server/routes/settings';
import auditRouter from './server/routes/audit';
import systemRouter from './server/routes/system';
import franchisesRouter from './server/routes/franchises';
import rbacRouter from './server/routes/rbac';
import organizationRouter from './server/routes/organization';
import employeesRouter from './server/routes/employees';
import waitersRouter from './server/routes/waiters';
import menuRouter from './server/routes/menu';
import tablesRouter from './server/routes/tables';
import ordersRouter from './server/routes/orders';
import paymentsRouter from './server/routes/payments';
import cashShiftsRouter from './server/routes/cash-shifts';
import kdsRouter from './server/routes/kds';
import inventoryRouter from './server/routes/inventory';
import serviceChargeRouter from './server/routes/service-charge';
import kpiRouter from './server/routes/kpi';
import operatorPosRouter from './server/routes/operator-pos';
import printRouter from './server/routes/print';
import publicMenuRouter from './server/routes/public-menu';
import creditRouter from './server/routes/credit';
import dashboardRouter from './server/routes/dashboard';
import operationsRouter from './server/routes/operations';
import foodCostRouter from './server/routes/food-cost';
import { enableAsyncErrorForwarding } from './server/async-errors';

async function startServer() {
  console.log('Booting BOOM OS Kernel with PostgreSQL (Prisma ORM)...');

  // Initialize PostgreSQL relational database with versioned migrations
  try {
    await initDatabase();
    // Seed baseline roles, permissions and settings; no demo business entities are created
    await seedInitialData();
  } catch (dbErr: any) {
    console.error('STARTUP DATABASE ERROR: PostgreSQL is currently unreachable or failed to initialize:', dbErr.message);
    process.exit(1);
  }

  const app = express();
  const PORT = config.port;

  // Core middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(basicRateLimiter(300));

  // Security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Health Check Endpoint (System & Database status + timestamp)
  app.get('/api/health', async (req: Request, res: Response) => {
    let dbStatus = 'DISCONNECTED';
    let redisStatus = 'DISCONNECTED';
    let latestMigration = 0;
    let dbError: string | null = null;
    let redisError: string | null = null;
    try {
      // Real live query verification to PostgreSQL
      const ping = await queryOne<{ ping: number }>('SELECT 1 as ping');
      if (ping && ping.ping === 1) {
        dbStatus = 'CONNECTED';
        try {
          const row = await queryOne<{ migration_name: string; finished_at: string | null }>('SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1');
          latestMigration = row?.migration_name ? Number((row.migration_name.match(/^(\d+)/) || [0, 0])[1]) : 0;
        } catch {
          // migrations table might be initializing
        }
      } else {
        dbStatus = 'DISCONNECTED';
      }
    } catch (e: any) {
      dbStatus = 'ERROR';
      dbError = e.message || 'PostgreSQL connection error';
    }

    try {
      redisStatus = (await checkRedis(config.redisUrl)) ? 'CONNECTED' : 'DISCONNECTED';
    } catch (e: any) {
      redisStatus = 'ERROR';
      redisError = e.message || 'Redis connection error';
    }

    // Redis is an optional infrastructure accelerator in the current build; PostgreSQL is the required system of record.
    const isHealthy = dbStatus === 'CONNECTED';
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'HEALTHY' : 'UNHEALTHY',
      system_status: 'OPERATIONAL',
      database_status: dbStatus,
      redis_status: redisStatus,
      system: {
        status: 'OPERATIONAL',
        uptime_seconds: Math.floor(process.uptime()),
        version: '1.0.0'
      },
      database: {
        status: dbStatus,
        engine: 'PostgreSQL (Prisma)',
        latest_migration_version: latestMigration,
        ...(dbError ? { error: dbError } : {})
      },
      redis: {
        status: redisStatus,
        ...(redisError ? { error: redisError } : {})
      },
      timestamp: new Date().toISOString()
    });
  });

  // Express 4 does not forward a rejected promise from an async handler to the error
  // middleware below, which would leave the request hanging. Patch every API router once,
  // in place, so async failures become next(err) and get the same structured 500 as a
  // synchronous throw.
  [
    docsRouter, publicMenuRouter, authRouter, usersRouter, employeesRouter, waitersRouter,
    menuRouter, tablesRouter, ordersRouter, paymentsRouter, cashShiftsRouter, kdsRouter,
    inventoryRouter, serviceChargeRouter, kpiRouter, operatorPosRouter, printRouter,
    franchisesRouter, branchesRouter, rolesRouter, permissionsRouter, rbacRouter,
    organizationRouter, settingsRouter, auditRouter, systemRouter, creditRouter, dashboardRouter, operationsRouter, foodCostRouter,
  ].forEach(enableAsyncErrorForwarding);

  // OpenAPI 3.0 & Swagger UI Documentation Endpoint
  app.use('/api/docs', docsRouter);

  // Public customer-facing menu/search: no staff authentication, only active public-safe menu fields.
  app.use('/api/public', publicMenuRouter);

  // 1. Core Foundation API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/waiters', waitersRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/tables', tablesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/cash-shifts', cashShiftsRouter);
  app.use('/api/kds', kdsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/service-charge', serviceChargeRouter);
  app.use('/api/kpi', kpiRouter);
  app.use('/api/operator-pos', operatorPosRouter);
  app.use('/api/print', printRouter);
  app.use('/api/credit', creditRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/operations', operationsRouter);
  app.use('/api/food-cost', foodCostRouter);
  app.use('/api/franchises', franchisesRouter);
  app.use('/api/branches', branchesRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/permissions', permissionsRouter);
  app.use('/api/rbac', rbacRouter);
  app.use('/api/organization', organizationRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/system', systemRouter);

  // 2. Future Business Modules (Reserved Architectural Endpoints - Not Implemented)
  const futureModules = ['boomcard', 'crm', 'analytics'];
  for (const mod of futureModules) {
    app.all(`/api/${mod}*`, (req: Request, res: Response) => {
      res.status(501).json({
        error: 'MODULE_NOT_ACTIVATED',
        code: 'MODULE_NOT_ACTIVATED',
        message: `BOOM OS business module '/api/${mod}' is registered in foundation architecture but intentionally not activated in Phase 1.`,
        details: { module: mod }
      });
    });
  }

  // Unmatched API routes must answer as the API, not fall through to the SPA fallback
  // below, which would return the HTML shell with HTTP 200 and hide client mistakes.
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      code: 'ENDPOINT_NOT_FOUND',
      message: 'No BOOM OS API endpoint matches this path.',
      details: { method: req.method, path: req.originalUrl }
    });
  });

  // 3. Global API error handler.
  // Only unexpected failures reach here: routes map their own business errors. The full
  // error is logged for operators, but the response must not carry driver text, the
  // database location or any other internal detail to the caller.
  app.use('/api', (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`Unhandled API Error [${req.method} ${req.originalUrl}]:`, err);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred in BOOM OS backend.',
      details: err?.details || undefined
    });
  });

  // 4. Vite Dev Server vs Production Static Asset Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, config.host, () => {
    console.log(`BOOM OS Server running at http://${config.host}:${PORT}`);
    console.log(`[Network] LAN clients may connect through the central server address on port ${PORT}.`);
  });

  const shutdown = (signal: string) => {
    console.log(`[Shutdown] Received ${signal}. Closing HTTP server...`);
    server.close(async () => {
      try {
        await getDb().$disconnect();
      } catch (error) {
        console.error('[Shutdown] Database disconnect failed:', error);
      } finally {
        process.exit(0);
      }
    });
  };

  // Express 4 does not forward a rejected promise from an async route handler to the
  // global API error handler above, so an unexpected async failure would otherwise
  // terminate the process and take every branch offline. Keep BOOM OS serving and log
  // the failure with full context. The individual request still fails.
  process.on('unhandledRejection', (reason) => {
    console.error('[Reliability] Unhandled promise rejection in BOOM OS backend:', reason);
  });

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('Fatal failure starting BOOM OS:', err);
  process.exit(1);
});
