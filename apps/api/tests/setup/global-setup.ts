import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * AGENTS.md §3 requires MongoDB Community 7.x as a single-node replica set
 * because transactions are needed for exit processing, licence seat assignment
 * and asset assignment history (P2/P3).
 *
 * `mongodb-memory-server` downloads and runs a REAL mongod 7.x binary, so the
 * test suite exercises genuine transactions instead of a mock. Docker is not
 * available on this machine, which is why this approach is used instead of
 * docker-compose.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup(): Promise<void> {
  // Pin the 7.x line mandated by AGENTS.md rather than whatever is default.
  process.env.MONGOMS_VERSION = '7.0.14';

  replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  });

  process.env.MONGO_URI = replSet.getUri();

  // Global setup output is intentional; `no-console` is not enabled in `src`
  // (AGENTS.md §11) but is off for tests too, so no directive is needed here.
  console.log(`\n[test] mongod replica set ready at ${replSet.getUri()}`);
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
  replSet = undefined;
}