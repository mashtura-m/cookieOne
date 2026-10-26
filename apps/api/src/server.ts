import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config';
import { HttpError } from './errors';
import { authRoutes } from './routes/auth';
import { orgRoutes } from './routes/orgs';
import { domainRoutes } from './routes/domains';
import { scanRoutes } from './routes/scans';
import { inventoryRoutes } from './routes/inventory';
import { bannerRoutes } from './routes/banner';
import { consentRoutes } from './routes/consents';
import { publicRoutes } from './routes/public';

export async function buildServer(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-change-me') {
    throw new Error('Set JWT_SECRET in production');
  }

  await app.register(cors, { origin: true, credentials: false, exposedHeaders: ['content-disposition'] });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request', code: 'validation', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong on our side. Try again.' : err.message });
  });

  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(domainRoutes);
  await app.register(scanRoutes);
  await app.register(inventoryRoutes);
  await app.register(bannerRoutes);
  await app.register(consentRoutes);

  return app;
}
