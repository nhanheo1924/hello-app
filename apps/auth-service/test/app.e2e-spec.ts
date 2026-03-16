process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/ctm-auth-service?schema=public';
process.env.JWT_ACCESS_EXPIRES_IN = '60m';
process.env.JWT_ISSUER = 'https://api.nhanctm.site';
process.env.JWT_AUDIENCE = 'ctm-web';
process.env.JWT_ACTIVE_KID = 'test-k1';
process.env.JWT_ACCESS_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAm4HBo/GXm8HAfR3e\\nC9kP6J1WGd9r7gAm4eHAYWlN8P8wr5SzfM9TR9h9EmfmN26g6bRjP5WhAmDW6D2P\\nM9fPZQIDAQABAkEAj6Ww1MEhMvbhgN5yw8QjXz6OHM5D11k2P3M88Cx9nJ2Q6+gV\\nWJ3Y1A9Y8wWv8QxQ+6c9j86YJQ4V6l1Q33iAQQIhAMfYv+P2O7kP6w2m4m0jY76i\\nEzkfcbPRG4Pp5rN3szkBAiEAxQn7H9R9d5fN2+g5nN9cJxv+M+eK3m1uE3zj7f4l\\nVYsCIQCF7a7Hh3xwQmN8I4v9mYxm8rygM2QJ4C0od3qE+6U5AQIgA4s0f8A2B0K7\\nW9FWK9v3A7zY5uXH9OnP+Q9t+2qfD8ECIQC0XH2l3m6JfYwQ9g1D6eQ2U3JzB2g9\\nX2bF2Nf5h8a2LQ==\\n-----END PRIVATE KEY-----';
process.env.JWT_ACCESS_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\\nMFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAJuBwaPxl5vBwH0d3gvZD+idVhnfa+4A\\nJuHhwGFpTfD/MK+Us3zPU0fYfRJn5jduoOm0Yz+VoQJg1ug9jzPXz2UCAwEAAQ==\\n-----END PUBLIC KEY-----';
process.env.JWT_PUBLIC_KEYS_JSON = '[]';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-must-be-at-least-32';
process.env.INTERNAL_PROXY_SECRET = 'test-proxy-secret-must-be-at-least-32';
process.env.TOTP_ENCRYPTION_SECRET = 'test-totp-secret-must-be-at-least-32';
process.env.WEB_APP_URL = 'http://localhost:3001';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('x-proxy-secret', process.env.INTERNAL_PROXY_SECRET as string)
      .expect(200);
  });

  it('/health (GET) should be public', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });
});
