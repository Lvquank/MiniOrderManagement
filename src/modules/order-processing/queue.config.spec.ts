import { redisConnection, workerEnabled } from './queue.config';

describe('Queue roles and connection configuration', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('lets REDIS_URL fully override host, password, port and TLS settings', () => {
    Object.assign(process.env, { REDIS_URL: 'redis://127.0.0.1/2', REDIS_HOST: 'other', REDIS_PORT: '9999', REDIS_PASSWORD: 'old', REDIS_TLS: 'true' });
    expect(redisConnection()).toEqual(expect.objectContaining({ host: '127.0.0.1', port: 6379, db: 2, password: undefined, maxRetriesPerRequest: 1 }));
    expect(redisConnection()).not.toHaveProperty('tls');
    expect(redisConnection(true)).toEqual(expect.objectContaining({ maxRetriesPerRequest: null }));
  });

  it('disables background workers on Vercel and on API-only services', () => {
    process.env.VERCEL = '1'; process.env.WORKER_ENABLED = 'true';
    expect(workerEnabled()).toBe(false);
    delete process.env.VERCEL; process.env.WORKER_ENABLED = 'false';
    expect(workerEnabled()).toBe(false);
    process.env.WORKER_ENABLED = 'true';
    expect(workerEnabled()).toBe(true);
  });
});
