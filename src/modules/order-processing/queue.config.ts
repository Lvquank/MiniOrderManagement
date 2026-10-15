import 'dotenv/config';
import { ConnectionOptions } from 'bullmq';

export function workerEnabled() {
  return process.env.VERCEL !== '1' && process.env.WORKER_ENABLED !== 'false';
}

export function redisConnection(worker = false): ConnectionOptions {
  const url = process.env.REDIS_URL ? new URL(process.env.REDIS_URL) : undefined;
  return {
    host: url?.hostname || process.env.REDIS_HOST || '127.0.0.1',
    port: Number(url ? url.port || 6379 : process.env.REDIS_PORT || 6379),
    username: url?.username ? decodeURIComponent(url.username) : undefined,
    password: url ? (url.password ? decodeURIComponent(url.password) : undefined) : process.env.REDIS_PASSWORD || undefined,
    db: url?.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...((url ? url.protocol === 'rediss:' : process.env.REDIS_TLS === 'true') ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableReadyCheck: false,
    connectTimeout: 2000,
    ...(!worker ? { enableOfflineQueue: false, commandTimeout: 2000 } : {}),
  };
}
