import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  refreshToken?: string;
}
