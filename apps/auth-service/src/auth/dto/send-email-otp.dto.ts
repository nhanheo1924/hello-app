import { IsEmail, IsIn } from 'class-validator';
import { EMAIL_OTP_TYPES, type EmailOtpType } from '../types/email-otp.type';

export class SendEmailOtpDto {
  @IsEmail()
  email!: string;

  @IsIn(EMAIL_OTP_TYPES)
  type!: EmailOtpType;
}
