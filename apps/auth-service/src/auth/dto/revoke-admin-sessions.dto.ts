import { IsOptional, IsUUID } from 'class-validator';

export class RevokeAdminSessionsDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
