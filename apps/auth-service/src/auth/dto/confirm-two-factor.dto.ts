import { IsString, Matches } from 'class-validator';

export class ConfirmTwoFactorDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}
