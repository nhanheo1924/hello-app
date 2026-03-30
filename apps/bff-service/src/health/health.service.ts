import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DownstreamHealthState {
  auth: 'ready' | 'unavailable';
  task: 'ready' | 'unavailable';
}

@Injectable()
export class HealthService {
  constructor(private readonly configService: ConfigService) {}

  async checkDownstreamReadiness(): Promise<{
    ready: boolean;
    downstream: DownstreamHealthState;
  }> {
    const authReadyUrl = this.buildReadyUrl(
      this.configService.get<string>(
        'AUTH_SERVICE_BASE_URL',
        'http://localhost:3000/api/auth',
      ),
      'auth',
    );
    const taskReadyUrl = this.buildReadyUrl(
      this.configService.get<string>(
        'TASK_SERVICE_BASE_URL',
        'http://localhost:3102/api',
      ),
      'task',
    );

    const [authReady, taskReady] = await Promise.all([
      this.isReady(authReadyUrl),
      this.isReady(taskReadyUrl),
    ]);

    return {
      ready: authReady && taskReady,
      downstream: {
        auth: authReady ? 'ready' : 'unavailable',
        task: taskReady ? 'ready' : 'unavailable',
      },
    };
  }

  private buildReadyUrl(baseUrl: string, kind: 'auth' | 'task'): string {
    const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!normalized) {
      return kind === 'auth'
        ? 'http://localhost:3000/api/health/ready'
        : 'http://localhost:3102/api/health/ready';
    }

    if (kind === 'auth' && normalized.endsWith('/auth')) {
      return `${normalized.slice(0, -'/auth'.length)}/health/ready`;
    }

    return `${normalized}/health/ready`;
  }

  private async isReady(url: string): Promise<boolean> {
    const timeoutMs = 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
