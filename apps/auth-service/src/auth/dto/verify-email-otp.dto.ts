import { IsEmail, IsIn, IsString, Matches } from 'class-validator';
import { EMAIL_OTP_TYPES, type EmailOtpType } from '../types/email-otp.type';

export class VerifyEmailOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, {
    message: 'code must be a 6-digit number',
  })
  code!: string;

  @IsIn(EMAIL_OTP_TYPES)
  type!: EmailOtpType;
}
