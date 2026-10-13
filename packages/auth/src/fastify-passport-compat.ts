import type { FastifyInstance } from 'fastify';

/**
 * Passport is built for Express: when a strategy redirects (every OAuth
 * provider's login route), it calls `res.setHeader()` and `res.end()`
 * directly, and Fastify's reply wrapper has neither, so the route 500s.
 * Delegate both to the underlying raw Node response. Call once at boot,
 * after registering `@fastify/cookie`:
 *
 *   enablePassportFastifyCompat(app.getHttpAdapter().getInstance());
 *
 * See https://github.com/nestjs/nest/issues/5702.
 */
export function enablePassportFastifyCompat(fastify: Pick<FastifyInstance, 'addHook'>): void {
  fastify.addHook('onRequest', (_request, reply, done) => {
    const patchable = reply as unknown as {
      setHeader: typeof reply.raw.setHeader;
      end: typeof reply.raw.end;
    };
    patchable.setHeader = reply.raw.setHeader.bind(reply.raw);
    patchable.end = reply.raw.end.bind(reply.raw);
    done();
  });
}
