import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'bff-service',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async checkReadiness(): Promise<Record<string, unknown>> {
    const readiness = await this.healthService.checkDownstreamReadiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'bff-service',
        downstream: readiness.downstream,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ready',
      service: 'bff-service',
      downstream: readiness.downstream,
      timestamp: new Date().toISOString(),
    };
  }
}
