import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/, {
    message:
      'newPassword must include uppercase, lowercase, number and be 8-64 characters',
  })
  newPassword!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'otp must be a 6-digit code',
  })
  otp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  backupCode?: string;
}
