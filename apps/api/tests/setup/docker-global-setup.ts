import mongoose from 'mongoose';
import Redis from 'ioredis';

/**
 * Global setup for `npm run test:docker` (HR_DOCKER_TESTS=1).
 *
 * Unlike the default global setup this starts NO mongod. It verifies that the
 * services published by `docker compose` are genuinely reachable and usable,
 * then leaves MONGO_URI pointing at them. Failing fast here is deliberate: a
 * silently-missing Redis would fall back to nothing and the RedisStore
 * coverage this mode exists to provide would be fake.
 *
 * Note `directConnection=true` in the default URI. `rs0`'s only member
 * advertises itself as `mongo:27017`, a name resolvable only inside the Docker
 * network, so a driver on the host would fail with `ENOTFOUND mongo` when it
 * tried to follow the topology. Pinning the connection keeps the node treated as
 * a replica set member, so transactions still work.
 */
export async function setup(): Promise<void> {
  const mongoUri =
    process.env.HR_DOCKER_MONGO_URI ??
    'mongodb://127.0.0.1:27017/harvik_hr_test?replicaSet=rs0&directConnection=true';
  const redisUrl = process.env.HR_DOCKER_REDIS_URL ?? 'redis://127.0.0.1:6379';

  process.env.MONGO_URI = mongoUri;

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.isWritablePrimary) {
      throw new Error(`replica set is not PRIMARY (setName=${hello.setName ?? 'none'})`);
    }
    if (typeof hello.logicalSessionTimeoutMinutes !== 'number') {
      // A standalone mongod reports null here and cannot do transactions, which
      // AGENTS.md §3 forbids.
      throw new Error('mongod is standalone; a replica set is required for transactions');
    }
    console.log(
      `[test:docker] MongoDB ready set=${hello.setName} primary=${hello.primary} uri=${mongoUri}`,
    );
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error(`unexpected Redis PING reply: ${pong}`);
    const info = await redis.info('server');
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim();
    if (!version?.startsWith('7')) {
      throw new Error(`AGENTS.md §3 requires Redis 7, container reports ${version}`);
    }
    console.log(`[test:docker] Redis ready version=${version} url=${redisUrl}`);
  } finally {
    redis.disconnect();
  }
}

export async function teardown(): Promise<void> {
  // Nothing to stop: the services belong to `docker compose`, not to this run.
}
