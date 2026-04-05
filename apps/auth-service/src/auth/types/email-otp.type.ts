export const EMAIL_OTP_TYPES = ['REGISTER', 'RESET_PASSWORD', 'MFA'] as const;

export type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];
