import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { type EmailOtpType } from '../auth/types/email-otp.type';

interface SendOtpEmailInput {
  to: string;
  code: string;
  type: EmailOtpType;
  ttlSeconds: number;
}

@Injectable()
export class EmailService {
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const resendApiKey =
      this.configService.get<string>('RESEND_API_KEY', '')?.trim() ?? '';
    this.from =
      this.configService
        .get<string>('RESEND_FROM', 'auth@nhanctm.site')
        ?.trim() || 'auth@nhanctm.site';

    this.resend = resendApiKey ? new Resend(resendApiKey) : null;
  }

  async sendOtpEmail(input: SendOtpEmailInput): Promise<void> {
    if (!this.resend) {
      throw new ServiceUnavailableException({
        code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
        message: 'Email provider is not configured',
      });
    }

    const subject = this.buildOtpSubject(input.type);
    const html = this.renderOtpTemplate({
      code: input.code,
      type: input.type,
      ttlSeconds: input.ttlSeconds,
      to: input.to,
    });

    try {
      await this.resend.emails.send({
        from: this.from,
        to: [input.to],
        subject,
        html,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'EMAIL_DELIVERY_FAILED',
        message: 'Unable to deliver email verification code',
      });
    }
  }

  private buildOtpSubject(type: EmailOtpType): string {
    if (type === 'RESET_PASSWORD') {
      return 'Reset your Hello password';
    }
    if (type === 'MFA') {
      return 'Your Hello verification code';
    }
    return 'Verify your Hello account';
  }

  private renderOtpTemplate(input: {
    code: string;
    type: EmailOtpType;
    ttlSeconds: number;
    to: string;
  }): string {
    const ttlMinutes = Math.max(1, Math.ceil(input.ttlSeconds / 60));
    const heading =
      input.type === 'RESET_PASSWORD'
        ? 'Password reset verification'
        : input.type === 'MFA'
          ? 'Sign-in verification'
          : 'Account verification';
    const summary =
      input.type === 'RESET_PASSWORD'
        ? 'Use this code to continue resetting your password.'
        : input.type === 'MFA'
          ? 'Use this code to complete your secure sign-in.'
          : 'Use this code to verify your email before creating your account.';

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:24px;background:#0b1020;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e5e7eb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px;background:linear-gradient(135deg,#111827 0%,#1d4ed8 100%);">
          <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">Hello Security</p>
          <h1 style="margin:10px 0 0 0;font-size:24px;line-height:1.3;color:#f8fafc;">${heading}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#d1d5db;">${summary}</p>
          <p style="margin:0 0 16px 0;font-size:14px;color:#9ca3af;">Requested for <strong style="color:#f3f4f6;">${this.escapeHtml(input.to)}</strong></p>
          <div style="margin:0 auto 18px auto;padding:14px 16px;max-width:320px;text-align:center;border-radius:12px;background:#0f172a;border:1px solid #1e3a8a;">
            <span style="display:inline-block;font-size:34px;letter-spacing:0.32em;font-weight:700;color:#ffffff;">${this.escapeHtml(input.code)}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#93c5fd;">This code expires in ${ttlMinutes} minute${ttlMinutes > 1 ? 's' : ''}.</p>
          <p style="margin:16px 0 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">If you did not request this code, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
