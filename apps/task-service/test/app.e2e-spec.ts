import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";

jest.mock("../src/auth/jwks.service", () => ({
  JwksService: class MockJwksService {
    verifyAccessToken() {
      return Promise.resolve({
        sub: "00000000-0000-0000-0000-000000000001",
        sid: "00000000-0000-0000-0000-000000000002",
        email: "mock@example.com",
      });
    }
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { AppModule } = require("../src/app.module");
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(30000);

describe("TaskService Health (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const prismaMock: Partial<PrismaService> = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ ok: 1 }]) as PrismaService["$queryRaw"],
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("/api/health (GET)", async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const response = (await request(server).get("/api/health").expect(200)) as {
      body: {
        status: string;
        timestamp: string;
      };
    };

    expect(response.body.status).toBe("ok");
    expect(typeof response.body.timestamp).toBe("string");
  });
});
