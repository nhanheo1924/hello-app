import {
  Controller,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('stream')
  stream(
    @Req() request: Request,
    @Res() response: Response,
    @Query('workspaceId') workspaceId?: string,
    @Query('token') token?: string,
  ): void {
    this.syncService.openStream(request, response, {
      workspaceId,
      token,
    });
  }
}

