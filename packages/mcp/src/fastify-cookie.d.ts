// Pulls in @fastify/cookie's module augmentation of FastifyRequest/FastifyReply
// (request.cookies, reply.setCookie/clearCookie) for this package's own
// isolated typecheck. The plugin itself is only ever registered once, by the
// consuming app (apps/bff/src/app.ts) — this file has no runtime effect.
import '@fastify/cookie';
