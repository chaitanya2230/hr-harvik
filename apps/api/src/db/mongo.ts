import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// AGENTS.md §11 — NoSQL injection protection: reject untyped operator objects
// that arrive via query strings.
mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);
mongoose.set('strictPopulate', true);

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectMongo(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;

  connectionPromise ??= mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      // Indexes are built explicitly in production so app boot stays fast.
      autoIndex: env.NODE_ENV !== 'production',
    })
    .then((m) => {
      logger.info({ db: m.connection.name }, 'MongoDB connected');
      return m;
    })
    .catch((error: unknown) => {
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
}

export async function disconnectMongo(): Promise<void> {
  connectionPromise = null;
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

export const mongoReadyState = (): number => mongoose.connection.readyState;

/** Used by `/ready` — AGENTS.md §11 requires readiness to verify MongoDB. */
export async function pingMongo(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  const result = await mongoose.connection.db.admin().ping();
  return result.ok === 1;
}