import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { limiters } from './middleware/rate-limit.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { v1 } from './routes.js';
import { buildOpenApi } from './docs/openapi.js';
import { registerNotificationRules } from './modules/notifications/rules.js';

const API_PREFIX = '/api/v1';
const DOCS_PATH = '/api/docs';
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

// BigInt (counters, file sizes) must serialise as numbers in JSON responses.
BigInt.prototype.toJSON = function toJSON() {
  return Number(this);
};

/** Builds the Express application (used by server.js and the integration tests). */
function createApp() {
  registerNotificationRules();
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // never 304 sensitive JSON
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  // Structured request logging with a correlation id (echoed back as X-Request-Id).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url && req.url.split('?')[0] }) },
      autoLogging: { ignore: (req) => req.url.includes('/health/') },
    }),
  );

  // Security headers. Swagger UI needs inline scripts/styles; the JSON API gets a deny-all CSP.
  const apiHelmet = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] },
    },
  });
  // Signed file links may be previewed in a same-origin iframe; everything else denies framing.
  const filesHelmet = helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], styleSrc: ["'unsafe-inline'"], frameAncestors: ["'self'"] } },
    frameguard: { action: 'sameorigin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  app.use((req, res, next) => (req.path.startsWith(DOCS_PATH) ? docsHelmet : req.path.startsWith('/api/v1/files/') ? filesHelmet : apiHelmet)(req, res, next));

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // Authenticated JSON must never be cached by browsers or intermediaries.
  app.use(API_PREFIX, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  // Global per-IP rate limit (Redis-backed, shared by all replicas). Health probes are exempt.
  app.use(API_PREFIX, (req, res, next) => (req.path.startsWith('/health/') ? next() : limiters.global(req, res, next)));

  app.use(API_PREFIX, v1);

  if (env.SWAGGER_ENABLED) {
    const spec = buildOpenApi();
    app.get(`${DOCS_PATH}/openapi.json`, (_req, res) => res.json(spec));
    app.use(DOCS_PATH, swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: `${env.APP_NAME} API` }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export { createApp, API_PREFIX };
