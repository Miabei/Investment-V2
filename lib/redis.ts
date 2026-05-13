import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL 未配置');
  return new Redis(url, {
    // BullMQ 后续会复用这个 client,要求 maxRetriesPerRequest=null
    maxRetriesPerRequest: null,
    // 按需连接,避免 build 阶段(Docker 没起时)报噪音错误
    lazyConnect: true,
  });
}

export const redis: Redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
