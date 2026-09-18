import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`FATAL CONFIGURATION ERROR: ${name} environment variable is required.`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  host: optional('HOST', '0.0.0.0'),
  port: Number(process.env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: optional('REDIS_URL', 'redis://127.0.0.1:6379'),
  jwtSecret: required('JWT_SECRET'),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 7),
  sessionIdleTimeoutMinutes: Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES || 180),
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  defaultTimezone: optional('DEFAULT_TIMEZONE', 'Asia/Ashgabat'),
  defaultCurrency: optional('DEFAULT_CURRENCY', 'TMT'),
};

if (!Number.isInteger(config.sessionTtlDays) || config.sessionTtlDays < 1 || config.sessionTtlDays > 30) {
  throw new Error('FATAL CONFIGURATION ERROR: SESSION_TTL_DAYS must be an integer between 1 and 30.');
}
if (!Number.isInteger(config.sessionIdleTimeoutMinutes) || config.sessionIdleTimeoutMinutes < 5 || config.sessionIdleTimeoutMinutes > 1440) {
  throw new Error('FATAL CONFIGURATION ERROR: SESSION_IDLE_TIMEOUT_MINUTES must be an integer between 5 and 1440.');
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('FATAL CONFIGURATION ERROR: PORT must be an integer between 1 and 65535.');
}
