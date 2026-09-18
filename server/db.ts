import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
let isDbInitialized = false;

// Enforce that DATABASE_URL must be provided from environment without hardcoded fallback
export function getDatabaseUrl(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    console.error('FATAL CONFIGURATION ERROR: DATABASE_URL environment variable is missing.');
    throw new Error(
      'FATAL CONFIGURATION ERROR: DATABASE_URL environment variable is missing. ' +
      'BOOM OS requires a valid PostgreSQL connection URL from the environment (e.g. postgresql://user:password@host:port/database).'
    );
  }
  return dbUrl.trim();
}

let _prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!_prisma) {
    const url = getDatabaseUrl();
    _prisma = new PrismaClient({
      datasources: {
        db: { url }
      }
    });
  }
  return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(target, prop, receiver) {
    const client = getDb();
    const val = Reflect.get(client, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  }
});

// Global safeguard: Ensure BigInt values can be safely serialized by JSON.stringify
if (typeof (BigInt.prototype as any).toJSON !== 'function') {
  (BigInt.prototype as any).toJSON = function () {
    return Number(this);
  };
}

export function sanitizeBigInt<T = any>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data === 'bigint') return Number(data) as any;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeBigInt(item)) as any;
  }
  // Raw queries return DECIMAL columns as Decimal instances. Copying them field by
  // field below would strip the class and serialize money as "[object Object]", so
  // render them as exact decimal strings, matching how BOOM OS carries money.
  if (Prisma.Decimal.isDecimal(data)) {
    return (data as any).toString() as any;
  }
  if (data instanceof Date) {
    return data as any;
  }
  if (typeof data === 'object') {
    const copy: any = {};
    for (const key of Object.keys(data)) {
      copy[key] = sanitizeBigInt((data as any)[key]);
    }
    return copy;
  }
  return data;
}

export function convertSqlPlaceholders(sql: string): string {
  let paramIdx = 1;
  // Replace standard '?' placeholders with PostgreSQL '$1', '$2', ...
  return sql.replace(/\?/g, () => `$${paramIdx++}`);
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const converted = convertSqlPlaceholders(sql);
  const rows = await prisma.$queryRawUnsafe<T[]>(converted, ...params);
  return sanitizeBigInt(rows);
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function execute(sql: string, params: any[] = []): Promise<{ changes: number }> {
  const converted = convertSqlPlaceholders(sql);
  const changes = await prisma.$executeRawUnsafe(converted, ...params);
  return { changes };
}

export async function execRaw(sql: string): Promise<void> {
  await prisma.$executeRawUnsafe(sql);
}


// Transaction-scoped query surface. Exported so route helpers that receive a
// transaction can be typed instead of falling back to `any`.
export interface TxClient {
  query: <R = any>(sql: string, params?: any[]) => Promise<R[]>;
  queryOne: <R = any>(sql: string, params?: any[]) => Promise<R | null>;
  execute: (sql: string, params?: any[]) => Promise<{ changes: number }>;
}

export async function transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (client) => {
    const txQuery = async <R = any>(sql: string, params: any[] = []): Promise<R[]> => {
      const converted = convertSqlPlaceholders(sql);
      const rows = await (client as any).$queryRawUnsafe(converted, ...params) as R[];
      return sanitizeBigInt(rows);
    };
    const txQueryOne = async <R = any>(sql: string, params: any[] = []): Promise<R | null> => {
      const rows = await txQuery<R>(sql, params);
      return rows.length ? rows[0] : null;
    };
    const txExecute = async (sql: string, params: any[] = []): Promise<{ changes: number }> => {
      const converted = convertSqlPlaceholders(sql);
      const changes = await (client as any).$executeRawUnsafe(converted, ...params);
      return { changes };
    };
    return fn({ query: txQuery, queryOne: txQueryOne, execute: txExecute });
  });
}

export async function getPrismaMigrationStatus(): Promise<Array<{ id: string; name: string; applied_at: string | null }>> {
  const rows = await query<{ id: string; migration_name: string; finished_at: string | null }>(
    `SELECT id, migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at ASC`
  );
  return rows.map(row => ({ id: row.id, name: row.migration_name, applied_at: row.finished_at }));
}

export async function getMigrationStatus(): Promise<{ version: number; name: string; description: string; applied_at: string }[]> {
  const rows = await prisma.schemaMigration.findMany({
    orderBy: { version: 'asc' }
  });
  return rows.map(r => ({
    version: r.version,
    name: r.name,
    description: r.description || '',
    applied_at: r.applied_at
  }));
}

export async function initDatabase(): Promise<PrismaClient> {
  if (isDbInitialized) {
    return prisma;
  }

  // Validate DATABASE_URL existence from environment (no fallback allowed)
  getDatabaseUrl();

  // Connect Prisma to real PostgreSQL
  try {
    const client = getDb();
    await client.$connect();
    // Test PostgreSQL connectivity with a real ping query
    await client.$queryRawUnsafe('SELECT 1 as ping;');
    console.log('[Database] Successfully connected to PostgreSQL via Prisma ORM.');
  } catch (err: any) {
    console.error('[Database] Failed to connect to PostgreSQL:', err.message);
    throw err;
  }

  isDbInitialized = true;
  return prisma;
}

export function isPostgresConnected(): boolean {
  return isDbInitialized;
}
