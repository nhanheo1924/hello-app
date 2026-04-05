import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordByOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/, {
    message:
      'newPassword must include uppercase, lowercase, number and be 8-64 characters',
  })
  newPassword!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  otpVerificationToken!: string;
}
