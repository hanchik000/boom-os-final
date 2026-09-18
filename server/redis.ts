import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';

function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    tls: url.protocol === 'rediss:',
  };
}

/** Lightweight Redis infrastructure probe without adding a client dependency. */
export function checkRedis(redisUrl: string, timeoutMs = 1500): Promise<boolean> {
  const target = parseRedisUrl(redisUrl);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const socket = target.tls
      ? tls.connect({ host: target.host, port: target.port, servername: target.host })
      : net.createConnection({ host: target.host, port: target.port });

    const timer = setTimeout(() => {
      socket.destroy();
      finish(false);
    }, timeoutMs);

    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });

    socket.once('data', (data: Buffer) => {
      clearTimeout(timer);
      const response = data.toString('utf8');
      socket.destroy();
      finish(response.includes('+PONG') || response.includes('$4\r\nPONG'));
    });

    socket.once('connect', () => {
      socket.write('*1\r\n$4\r\nPING\r\n');
    });
  });
}
