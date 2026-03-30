import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [ConfigModule, SyncModule],
  controllers: [ProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
