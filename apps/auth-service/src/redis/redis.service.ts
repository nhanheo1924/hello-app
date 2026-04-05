import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = String(
      this.configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
    )
      .trim()
      .replace(/\/+$/, '');

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async setIfAbsentWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async getRemainingTtlSeconds(key: string): Promise<number> {
    const ttl = await this.client.ttl(key);
    return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0;
  }
}
