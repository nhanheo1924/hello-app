import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
  schema: string;
  parsed: boolean;
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseTarget = this.parseDatabaseTarget(
    process.env.DATABASE_URL,
  );

  async onModuleInit(): Promise<void> {
    this.assertDatabaseTargetIsDirect();
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        this.logger.log(
          `Database connection established (${this.describeDatabaseTarget()})`,
        );
        return;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown database error";
        this.logger.error(
          `Database connect attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );

        if (attempt < maxAttempts) {
          await this.sleep(2000);
        }
      }
    }

    throw new Error(
      `Unable to connect database after ${maxAttempts} attempts (${this.describeDatabaseTarget()})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseDatabaseTarget(
    rawDatabaseUrl: string | undefined,
  ): DatabaseTarget {
    const value = String(rawDatabaseUrl || "").trim();
    if (!value) {
      return {
        host: "",
        port: "",
        database: "",
        schema: "",
        parsed: false,
      };
    }

    try {
      const url = new URL(value);
      const schema = url.searchParams.get("schema") || "";
      return {
        host: url.hostname || "",
        port: url.port || "5432",
        database: url.pathname.replace(/^\/+/, ""),
        schema,
        parsed: true,
      };
    } catch {
      return {
        host: "",
        port: "",
        database: "",
        schema: "",
        parsed: false,
      };
    }
  }

  private assertDatabaseTargetIsDirect(): void {
    const nodeEnv = String(process.env.NODE_ENV || "development").toLowerCase();
    if (nodeEnv === "production") {
      return;
    }

    const allowDockerDatabaseHosts = String(
      process.env.ALLOW_DOCKER_DATABASE_HOSTS || "",
    )
      .trim()
      .toLowerCase();
    if (
      allowDockerDatabaseHosts === "true" ||
      allowDockerDatabaseHosts === "1"
    ) {
      this.logger.warn(
        "Skipping direct-host DB validation because ALLOW_DOCKER_DATABASE_HOSTS is enabled.",
      );
      return;
    }

    if (!this.databaseTarget.parsed) {
      this.logger.warn(
        "DATABASE_URL is missing or invalid; skipping direct-host validation.",
      );
      return;
    }

    const disallowedHosts = new Set([
      "postgres",
      "host.docker.internal",
      "docker.for.win.localhost",
      "docker.for.mac.localhost",
    ]);
    const host = this.databaseTarget.host.toLowerCase();
    if (disallowedHosts.has(host)) {
      throw new Error(
        `DATABASE_URL host "${this.databaseTarget.host}" is blocked in non-production. Use a direct PostgreSQL host (e.g. localhost).`,
      );
    }

    const requiredPort = String(process.env.DB_REQUIRED_PORT || "5432").trim();
    if (
      requiredPort &&
      this.databaseTarget.port &&
      this.databaseTarget.port !== requiredPort
    ) {
      throw new Error(
        `DATABASE_URL port "${this.databaseTarget.port}" is blocked in non-production. Expected direct DB port ${requiredPort}.`,
      );
    }
  }

  private describeDatabaseTarget(): string {
    if (!this.databaseTarget.parsed) {
      return "target=unknown";
    }

    const host = this.databaseTarget.host || "unknown-host";
    const port = this.databaseTarget.port || "5432";
    const database = this.databaseTarget.database || "unknown-db";
    const schema = this.databaseTarget.schema || "public";
    return `host=${host}:${port}, db=${database}, schema=${schema}`;
  }
}
