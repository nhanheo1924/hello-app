import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class DisableTwoFactorDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  backupCode?: string;
}
