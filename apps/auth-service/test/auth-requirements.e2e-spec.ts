import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

process.env.NODE_ENV = 'test';
// tokens should be long enough for frontend (60 minutes)
process.env.JWT_ACCESS_EXPIRES_IN = '60m';
process.env.JWT_ISSUER = 'https://api.nhanctm.site';
process.env.JWT_AUDIENCE = 'ctm-web';
process.env.JWT_ACTIVE_KID = 'test-k1';
process.env.JWT_ACCESS_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
process.env.JWT_ACCESS_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
process.env.JWT_PUBLIC_KEYS_JSON = '[]';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-at-least-32';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.INTERNAL_PROXY_SECRET = 'test-proxy-secret-must-be-at-least-32';
process.env.TOTP_ENCRYPTION_SECRET = 'test-totp-secret-must-be-at-least-32';
process.env.WEB_APP_URL = 'http://localhost:3001';

import { AppModule } from '../src/app.module';

type JwksResponseBody = {
  keys: unknown[];
};

type AuthResponseBody = {
  accessToken: string;
  session: {
    sid: string;
  };
};

type SessionsResponseBody = {
  sessions: Array<{
    id: string;
    isCurrent: boolean;
  }>;
};

type ErrorResponseBody = {
  code: string;
};

describe('Auth requirements (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = new PrismaClient();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  it('should satisfy access-token-only auth flow', async () => {
    const proxyHeader = {
      'x-proxy-secret': process.env.INTERNAL_PROXY_SECRET as string,
    };
    const email = `req_${Date.now()}@example.com`;
    const password = 'Password1';

    const jwks = await request(app.getHttpServer())
      .get('/.well-known/jwks.json')
      .expect(200);
    const jwksBody = jwks.body as JwksResponseBody;
    expect(Array.isArray(jwksBody.keys)).toBe(true);
    expect(jwksBody.keys.length).toBeGreaterThan(0);

    // exercise the new signup path (alias for register)
    const register = await request(app.getHttpServer())
      .post('/auth/signup')
      .set(proxyHeader)
      .send({ email, password })
      .expect(201);
    const registerBody = register.body as AuthResponseBody;
    expect(typeof registerBody.accessToken).toBe('string');

    const login1 = await request(app.getHttpServer())
      .post('/auth/login')
      .set(proxyHeader)
      .send({ email, password })
      .expect(201);
    const login1Body = login1.body as AuthResponseBody;
    const sid1 = login1Body.session.sid;
    const access1 = login1Body.accessToken;

    await request(app.getHttpServer())
      .get('/auth/me')
      .set(proxyHeader)
      .set('Authorization', `Bearer ${access1}`)
      .expect(200);

    const sessions1 = await request(app.getHttpServer())
      .get('/auth/sessions')
      .set(proxyHeader)
      .set('Authorization', `Bearer ${access1}`)
      .expect(200);
    const sessions1Body = sessions1.body as SessionsResponseBody;
    expect(
      sessions1Body.sessions.some(
        (session) => session.id === sid1 && session.isCurrent,
      ),
    ).toBe(true);

    const login2 = await request(app.getHttpServer())
      .post('/auth/login')
      .set(proxyHeader)
      .send({ email, password })
      .expect(201);
    const login2Body = login2.body as AuthResponseBody;
    const sid2 = login2Body.session.sid;
    const access2 = login2Body.accessToken;

    expect(sid2).not.toEqual(sid1);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set(proxyHeader)
      .set('Authorization', `Bearer ${access1}`)
      .expect(401)
      .expect((response) => {
        const body = response.body as ErrorResponseBody;
        expect(body.code).toBe('SESSION_REVOKED');
      });

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set(proxyHeader)
      .set('Authorization', `Bearer ${access2}`)
      .send({})
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual({ success: true });
      });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set(proxyHeader)
      .set('Authorization', `Bearer ${access2}`)
      .expect(401)
      .expect((response) => {
        const body = response.body as ErrorResponseBody;
        expect(body.code).toBe('SESSION_REVOKED');
      });
  });
});
