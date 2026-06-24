import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
  }
}

export async function registerTenantMiddleware(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify().catch(() => null);
      if (payload && (payload as any).tenant) {
        request.tenantId = (payload as any).tenant;
      }
    } catch {
      // No token or invalid token — public access
    }
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const tenant = request.tenantId;
    if (tenant) {
      request.headers['x-tenant-id'] = tenant;
    }
  });
}
