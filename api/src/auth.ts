import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export type Role = 'viewer' | 'analyst' | 'operator' | 'admin';

interface JwtPayload {
  sub: string;
  roles: Role[];
  tenant?: string;
}

const ROLE_HIERARCHY: Record<Role, number> = {
  viewer: 1,
  analyst: 2,
  operator: 3,
  admin: 4,
};

export function authorize(required: Role) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      const hasAccess = payload.roles.some(r => ROLE_HIERARCHY[r] >= ROLE_HIERARCHY[required]);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Insufficient permissions' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  };
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.warn('[Auth] WARNING: JWT_SECRET not set. Using insecure default. Set JWT_SECRET env var in production.');
  }

  await app.register(import('@fastify/jwt'), {
    secret: jwtSecret || 'obs-platform-secret-change-in-production',
    sign: { expiresIn: '1h' },
  });

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as any;

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    const analystPassword = process.env.ANALYST_PASSWORD || 'analyst';
    const operatorPassword = process.env.OPERATOR_PASSWORD || 'operator';
    const viewerPassword = process.env.VIEWER_PASSWORD || 'viewer';

    const userCredentials: Record<string, { roles: Role[]; password: string }> = {
      admin: { roles: ['admin'], password: adminPassword },
      analyst: { roles: ['analyst'], password: analystPassword },
      operator: { roles: ['operator'], password: operatorPassword },
      viewer: { roles: ['viewer'], password: viewerPassword },
    };

    const user = userCredentials[username];
    if (!user || password !== user.password) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ sub: username, roles: user.roles });
    return { token };
  });

  app.get('/api/auth/me', {
    preHandler: [async (request: FastifyRequest, reply: FastifyReply) => {
      try { await request.jwtVerify(); } catch { reply.status(401).send({ error: 'Unauthorized' }); }
    }],
  }, async (request) => {
    const payload = await request.jwtVerify<JwtPayload>();
    return { user: payload.sub, roles: payload.roles };
  });
}
