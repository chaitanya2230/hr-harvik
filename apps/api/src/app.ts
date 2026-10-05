import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import type { Request } from 'express';
import { env, isTest } from './config/env';
import { logger } from './utils/logger';
import { requestId } from './middleware/requestId';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { healthRouter, readyRouter } from './modules/health/health.routes';

/**
 * AGENTS.md §11 — security middleware, applied in a deliberate order:
 *   requestId → structured logging → helmet → cors → parsers → cookie →
 *   HPP → NoSQL-injection sanitisation → rate limit → routes → 404 → errors
 */
export interface CreateAppOptions {
  /**
   * Mounted after the API router but before the 404 handler.
   *
   * Used by the test suite to exercise the real middleware stack (RBAC,
   * validation) against routes that exist today, without inventing
   * placeholder production endpoints.
   */
  beforeNotFound?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // AGENTS.md §11 — no X-Powered-By header.
  app.disable('x-powered-by');
  app.set('etag', false);

  // Rate limiting must see the real client IP when running behind nginx.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId ?? 'unknown',
      // Health probes would otherwise dominate the logs.
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready',
      },
    }),
  );

  app.use(helmet());

  app.use(
    cors({
      // §11 — explicit allow-list, never `origin: true`.
      origin(origin, callback) {
        // Same-origin / curl / server-to-server requests have no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, env.CORS_ORIGINS.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  // AGENTS.md §11 — HTTP parameter pollution protection.
  app.use(hpp());
  // AGENTS.md §11 — strip $-prefixed operators from user-supplied objects.
  app.use(mongoSanitize());

  // Disabled under test so suites are not throttled by the global budget.
  if (!isTest) app.use(apiLimiter);

  // Operational endpoints stay outside the versioned API.
  app.use('/health', healthRouter);
  app.use('/ready', readyRouter);

  app.use('/api/v1', apiRouter);

  options.beforeNotFound?.(app);

  // §13 — uploads are never served statically, so /uploads/* falls through to
  // this 404 rather than exposing files.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}