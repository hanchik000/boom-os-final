import { Router, Request, Response } from 'express';
import { query, queryOne, prisma } from '../db';
import { authenticateToken } from '../auth';

const router = Router();

// Public health check
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1;');
    res.json({
      status: 'HEALTHY',
      system: 'BOOM OS Foundation',
      database: 'PostgreSQL',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'UNHEALTHY',
      database: 'DISCONNECTED',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Authenticated system summary
router.get('/stats', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM users WHERE deleted_at IS NULL');
  const activeUserCount = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM users WHERE status = 'ACTIVE' AND deleted_at IS NULL");
  const branchCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM branches');
  const activeBranchCount = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM branches WHERE status = 'ACTIVE'");
  const franchiseCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM franchises WHERE deleted_at IS NULL');
  const activeFranchiseCount = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM franchises WHERE deleted_at IS NULL AND status = 'ACTIVE'");
  const roleCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM roles');
  const permissionCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM permissions');
  const auditLogsCount = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM audit_logs');

  const recentLogs = await query(
    `SELECT a.id, a.action, a.entity_type, a.created_at, u.full_name as user_name, b.name as branch_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN branches b ON b.id = a.branch_id
     ORDER BY a.created_at DESC
     LIMIT 8`
  );

  res.json({
    stats: {
      users: {
        total: userCount?.count || 0,
        active: activeUserCount?.count || 0
      },
      branches: {
        total: branchCount?.count || 0,
        active: activeBranchCount?.count || 0
      },
      franchises: {
        total: franchiseCount?.count || 0,
        active: activeFranchiseCount?.count || 0
      },
      roles: {
        total: roleCount?.count || 0
      },
      permissions: {
        total: permissionCount?.count || 0
      },
      auditLogsTotal: auditLogsCount?.count || 0
    },
    systemStatus: {
      database: 'CONNECTED',
      engine: 'PostgreSQL (Prisma)',
      security: 'ENFORCED',
      isolation: 'MULTI_BRANCH_ACTIVE',
      rbac: 'ACTIVE',
      environment: process.env.NODE_ENV || 'development'
    },
    recentActivities: recentLogs
  });
});

export default router;
