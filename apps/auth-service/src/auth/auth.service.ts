import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  Prisma,
  SessionRevokeReason,
  SystemRole,
  User,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'crypto';
import ms, { type StringValue } from 'ms';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyTwoFactorLoginDto } from './dto/verify-two-factor-login.dto';
import { JwtKeyService } from './jwt-key.service';
import { AuthResponse, PublicUser } from './interfaces/auth-response.interface';
import { AuthTokens } from './interfaces/auth-tokens.interface';

interface FailedAttempt {
  count: number;
  windowStartedAt: number;
}

interface TwoFactorChallengePayload {
  sub: string;
  email: string;
  purpose: '2fa-login';
  nonce: string;
}

interface GoogleUserProfile {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface SessionContext {
  ip: string;
  userAgent: string | null;
  deviceId?: string | null;
}

interface AdminUsersQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: UserStatus;
  systemRole?: SystemRole;
}

interface AdminAuditLogsQuery {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  email?: string;
  from?: string;
  to?: string;
}

type OauthExchangePayload = {
  accessToken: string;
  expiresIn: number;
  session: {
    sid: string;
  };
  user: {
    id: string;
    email: string;
    status: UserStatus;
    systemRole: SystemRole;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    dob: string | null;
    address: string | null;
    avatarUrl: string | null;
    timezone: string | null;
    locale: string | null;
    fullName: string | null;
    twoFactorEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

type PrismaTx = Prisma.TransactionClient;

const SYSTEM_ADMIN_ROLES = new Set<SystemRole>([
  SystemRole.SUPER_ADMIN,
  SystemRole.SYSTEM_ADMIN,
]);

export interface SessionView {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  createdByIp: string | null;
  createdByUserAgent: string | null;
  isCurrent: boolean;
}

export type AuthSession = AuthResponse;

export interface TwoFactorChallengeResponse {
  requiresTwoFactor: true;
  twoFactorToken: string;
}

export type LoginResult = AuthSession | TwoFactorChallengeResponse;

export interface TwoFactorSetupPayload {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class AuthService {
  private readonly accessTokenExpiresIn: StringValue;
  private readonly accessTokenExpiresInSeconds: number;
  private readonly oauthExchangeCodeExpiresInMs: number;
  private readonly twoFactorChallengeExpiresIn: StringValue;
  private readonly twoFactorIssuer: string;
  private readonly twoFactorEncryptionSecret: string;
  private readonly googleOauthClientId: string;
  private readonly googleOauthClientSecret: string;
  private readonly googleOauthRedirectUri: string;
  private readonly failedAuthAttempts = new Map<string, FailedAttempt>();
  private readonly maxFailedAttemptsPerWindow = 8;
  private readonly failedAttemptWindowMs = 5 * 60_000;

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly jwtKeyService: JwtKeyService,
  ) {
    this.accessTokenExpiresIn = this.configService.get<StringValue>(
      'JWT_ACCESS_EXPIRES_IN',
      '60m' as StringValue,
    );
    const accessTokenTtlMs = ms(this.accessTokenExpiresIn);
    if (typeof accessTokenTtlMs !== 'number') {
      throw new InternalServerErrorException({
        code: 'CONFIG_INVALID',
        message: 'Invalid JWT_ACCESS_EXPIRES_IN value',
      });
    }
    if (accessTokenTtlMs !== 60 * 60_000) {
      throw new InternalServerErrorException({
        code: 'CONFIG_INVALID',
        message: 'JWT_ACCESS_EXPIRES_IN must be exactly 60m',
      });
    }
    this.accessTokenExpiresInSeconds = Math.floor(accessTokenTtlMs / 1000);
    const oauthExchangeCodeExpiresIn = this.configService.get<StringValue>(
      'OAUTH_EXCHANGE_CODE_EXPIRES_IN',
      '60s' as StringValue,
    );
    const oauthExchangeCodeExpiresInMs = ms(oauthExchangeCodeExpiresIn);
    if (
      typeof oauthExchangeCodeExpiresInMs !== 'number' ||
      !Number.isFinite(oauthExchangeCodeExpiresInMs) ||
      oauthExchangeCodeExpiresInMs <= 0
    ) {
      throw new InternalServerErrorException({
        code: 'CONFIG_INVALID',
        message: 'Invalid OAUTH_EXCHANGE_CODE_EXPIRES_IN value',
      });
    }
    this.oauthExchangeCodeExpiresInMs = oauthExchangeCodeExpiresInMs;
    this.twoFactorChallengeExpiresIn = this.configService.get<StringValue>(
      'TWO_FACTOR_CHALLENGE_EXPIRES_IN',
      '5m' as StringValue,
    );
    this.twoFactorIssuer = this.configService.get<string>(
      'TOTP_ISSUER',
      'CTM Auth',
    );
    const rawTotpEncryptionSecret =
      this.configService.get<string>('TOTP_ENCRYPTION_SECRET')?.trim() ?? '';
    const fallbackEncryptionSecret =
      this.configService.get<string>('INTERNAL_PROXY_SECRET', '')?.trim() ?? '';
    this.twoFactorEncryptionSecret =
      rawTotpEncryptionSecret.length >= 32
        ? rawTotpEncryptionSecret
        : fallbackEncryptionSecret;

    this.googleOauthClientId =
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID', '') ?? '';
    this.googleOauthClientSecret =
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET', '') ?? '';
    this.googleOauthRedirectUri =
      this.configService.get<string>('GOOGLE_OAUTH_REDIRECT_URI', '') ?? '';

    authenticator.options = {
      step: 30,
      window: 1,
    };
  }

  async register(
    dto: RegisterDto,
    sessionContext: SessionContext,
  ): Promise<AuthSession> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    this.assertAuthAttemptsAllowed(normalizedEmail, sessionContext.ip);
    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      this.registerFailedAuthAttempt(normalizedEmail, sessionContext.ip);
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already exists',
      });
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    const firstName =
      this.normalizeNullableText(dto.firstName, 120) ??
      this.normalizeNullableText(dto.fullName, 120);
    if (!firstName) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'firstName is required',
      });
    }
    const lastName = this.normalizeNullableText(dto.lastName, 120);
    const fullName =
      this.normalizeNullableText(
        [firstName, lastName].filter(Boolean).join(' '),
        120,
      ) ?? this.normalizeNullableText(dto.fullName, 120);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName,
          fullName,
          displayName: this.buildDisplayName(
            {
              firstName,
              lastName,
              fullName,
              email: normalizedEmail,
            },
          ),
          status: UserStatus.ACTIVE,
        },
      });
      const tokens = await this.issueTokens(tx, user, {
        ...sessionContext,
        deviceId: null,
      });

      await this.writeAuditLog(tx, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.REGISTER,
      });

      return { user, tokens };
    });
    this.clearFailedAuthAttempts(normalizedEmail, sessionContext.ip);

    return {
      user: this.toPublicUser(created.user),
      accessToken: created.tokens.accessToken,
      expiresIn: created.tokens.expiresIn,
      session: { sid: created.tokens.sessionId },
    };
  }

  async login(
    dto: LoginDto,
    sessionContext: SessionContext,
  ): Promise<LoginResult> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    this.assertAuthAttemptsAllowed(normalizedEmail, sessionContext.ip);
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      this.registerFailedAuthAttempt(normalizedEmail, sessionContext.ip);
      await this.writeAuditLog(this.prisma, {
        email: normalizedEmail,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_FAIL,
        detail: { code: 'INVALID_CREDENTIALS' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      this.registerFailedAuthAttempt(normalizedEmail, sessionContext.ip);
      await this.writeAuditLog(this.prisma, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_FAIL,
        detail: { code: 'LOCKED' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    const passwordMatches = await argon2.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordMatches) {
      this.registerFailedAuthAttempt(normalizedEmail, sessionContext.ip);
      await this.writeAuditLog(this.prisma, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_FAIL,
        detail: { code: 'INVALID_CREDENTIALS' },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    this.clearFailedAuthAttempts(normalizedEmail, sessionContext.ip);

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      return {
        requiresTwoFactor: true,
        twoFactorToken: await this.signTwoFactorChallenge(user),
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await this.revokeActiveSessionsForUser(
        tx,
        user.id,
        SessionRevokeReason.NEW_LOGIN,
        sessionContext,
      );
      const tokens = await this.issueTokens(tx, user, {
        ...sessionContext,
        deviceId: dto.deviceId?.trim() || null,
      });
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
        },
      });
      await this.writeAuditLog(tx, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_OK,
      });
      if (revoked.sessionsRevoked > 0) {
        await this.writeAuditLog(tx, {
          userId: user.id,
          email: user.email,
          ip: sessionContext.ip,
          userAgent: sessionContext.userAgent,
          action: AuditAction.SESSION_REVOKED,
          detail: {
            reason: SessionRevokeReason.NEW_LOGIN,
            count: revoked.sessionsRevoked,
          },
        });
      }

      return {
        user: updatedUser,
        tokens,
      };
    });

    return {
      user: this.toPublicUser(result.user),
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      session: { sid: result.tokens.sessionId },
    };
  }

  async verifyTwoFactorLogin(
    dto: VerifyTwoFactorLoginDto,
    sessionContext: SessionContext,
  ): Promise<AuthSession> {
    const payload = await this.verifyTwoFactorChallenge(dto.twoFactorToken);
    this.assertTwoFactorInputProvided(dto.otp, dto.backupCode);

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException(
        'Two-factor authentication is not enabled',
      );
    }

    const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);

    if (dto.otp) {
      const otpIsValid = this.verifyTotpCode(secret, dto.otp);
      if (!otpIsValid) {
        throw new UnauthorizedException('Invalid OTP code');
      }
    } else if (dto.backupCode) {
      const consumed = await this.consumeBackupCode(user, dto.backupCode);
      if (!consumed) {
        throw new UnauthorizedException('Invalid backup code');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await this.revokeActiveSessionsForUser(
        tx,
        user.id,
        SessionRevokeReason.NEW_LOGIN,
        sessionContext,
      );
      const tokens = await this.issueTokens(tx, user, {
        ...sessionContext,
        deviceId: null,
      });
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
        },
      });
      await this.writeAuditLog(tx, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_OK,
        detail: { factor: '2fa' },
      });
      if (revoked.sessionsRevoked > 0) {
        await this.writeAuditLog(tx, {
          userId: user.id,
          email: user.email,
          ip: sessionContext.ip,
          userAgent: sessionContext.userAgent,
          action: AuditAction.SESSION_REVOKED,
          detail: {
            reason: SessionRevokeReason.NEW_LOGIN,
            count: revoked.sessionsRevoked,
          },
        });
      }

      return { user: updatedUser, tokens };
    });

    return {
      user: this.toPublicUser(result.user),
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      session: { sid: result.tokens.sessionId },
    };
  }

  async beginTwoFactorSetup(userId: string): Promise<TwoFactorSetupPayload> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User does not exist');
    }

    if (user.twoFactorEnabled) {
      throw new BadRequestException(
        'Two-factor authentication is already enabled',
      );
    }

    const secret = authenticator.generateSecret();
    const encryptedSecret = this.encryptTwoFactorSecret(secret);
    const otpauthUrl = authenticator.keyuri(
      user.email,
      this.twoFactorIssuer,
      secret,
    );
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 5,
    });

    await this.usersService.updateById(user.id, {
      twoFactorTempSecret: encryptedSecret,
    });

    return {
      secret,
      otpauthUrl,
      qrCodeDataUrl,
    };
  }

  async confirmTwoFactorSetup(
    userId: string,
    otp: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User does not exist');
    }

    if (!user.twoFactorTempSecret) {
      throw new BadRequestException('Two-factor setup has not been started');
    }

    const secret = this.decryptTwoFactorSecret(user.twoFactorTempSecret);
    const otpIsValid = this.verifyTotpCode(secret, otp);
    if (!otpIsValid) {
      throw new UnauthorizedException('Invalid OTP code');
    }

    const backupCodes = this.generateBackupCodes();
    const backupCodeHashes = await Promise.all(
      backupCodes.map((code) =>
        argon2.hash(this.normalizeBackupCode(code), {
          type: argon2.argon2id,
        }),
      ),
    );

    await this.usersService.updateById(user.id, {
      twoFactorEnabled: true,
      twoFactorSecret: this.encryptTwoFactorSecret(secret),
      twoFactorTempSecret: null,
      twoFactorBackupCodes: backupCodeHashes,
    });

    return { backupCodes };
  }

  async disableTwoFactor(
    userId: string,
    dto: DisableTwoFactorDto,
  ): Promise<{ success: true }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User does not exist');
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return { success: true };
    }

    this.assertTwoFactorInputProvided(dto.otp, dto.backupCode);

    if (dto.otp) {
      const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
      const otpIsValid = this.verifyTotpCode(secret, dto.otp);
      if (!otpIsValid) {
        throw new UnauthorizedException('Invalid OTP code');
      }
    } else if (dto.backupCode) {
      const consumed = await this.consumeBackupCode(user, dto.backupCode);
      if (!consumed) {
        throw new UnauthorizedException('Invalid backup code');
      }
    }

    await this.usersService.updateById(user.id, {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorTempSecret: null,
      twoFactorBackupCodes: Prisma.JsonNull,
    });

    return { success: true };
  }

  async logout(userId: string, sessionId: string): Promise<{ success: true }> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findFirst({
        where: {
          id: sessionId,
          userId,
        },
        include: {
          user: true,
        },
      });

      if (!session || session.revokedAt) {
        return;
      }

      await this.revokeSessionById(tx, session.id, SessionRevokeReason.LOGOUT);
      await this.writeAuditLog(tx, {
        userId: session.user.id,
        email: session.user.email,
        action: AuditAction.LOGOUT,
      });
    });

    return { success: true };
  }

  async getProfile(userId: string, sessionId?: string): Promise<PublicUser> {
    if (sessionId) {
      const session = await this.prisma.session.findFirst({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
        },
      });
      if (!session) {
        throw new UnauthorizedException({
          code: 'SESSION_REVOKED',
          message: 'Session revoked',
        });
      }
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User does not exist',
      });
    }

    return this.toPublicUser(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const existing = await this.usersService.findById(userId);
    if (!existing) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User does not exist',
      });
    }

    const updateData: Prisma.UserUpdateInput = {};
    const nextFirstName =
      dto.firstName !== undefined
        ? this.normalizeNullableText(dto.firstName, 120)
        : existing.firstName;
    const nextLastName =
      dto.lastName !== undefined
        ? this.normalizeNullableText(dto.lastName, 120)
        : existing.lastName;
    const normalizedFullNameInput =
      dto.fullName !== undefined
        ? this.normalizeNullableText(dto.fullName, 120)
        : undefined;

    if (dto.firstName !== undefined) {
      updateData.firstName = nextFirstName;
    }
    if (dto.lastName !== undefined) {
      updateData.lastName = nextLastName;
    }
    if (dto.displayName !== undefined) {
      updateData.displayName = this.normalizeNullableText(dto.displayName, 120);
    }
    if (dto.fullName !== undefined) {
      updateData.fullName = normalizedFullNameInput;
    } else if (dto.firstName !== undefined || dto.lastName !== undefined) {
      updateData.fullName = this.normalizeNullableText(
        [nextFirstName, nextLastName].filter(Boolean).join(' '),
        120,
      );
    }
    if (dto.dob !== undefined) {
      updateData.dob = dto.dob ? new Date(dto.dob) : null;
    }
    if (dto.address !== undefined) {
      updateData.address = this.normalizeNullableText(dto.address, 255);
    }
    if (dto.avatarUrl !== undefined) {
      updateData.avatarUrl = this.normalizeNullableText(dto.avatarUrl, 512);
    }
    if (dto.timezone !== undefined) {
      updateData.timezone = this.normalizeNullableText(dto.timezone, 64);
    }
    if (dto.locale !== undefined) {
      const normalizedLocale = this.normalizeNullableText(dto.locale, 16);
      updateData.locale = normalizedLocale ? normalizedLocale.toLowerCase() : null;
    }

    if (
      dto.displayName === undefined &&
      (dto.fullName !== undefined ||
        dto.firstName !== undefined ||
        dto.lastName !== undefined)
    ) {
      updateData.displayName = this.buildDisplayName(
        {
          firstName: nextFirstName,
          lastName: nextLastName,
          fullName:
            dto.fullName !== undefined
              ? normalizedFullNameInput ?? null
              : existing.fullName,
          email: existing.email,
          fallbackDisplayName: existing.displayName,
        },
      );
    }

    if (Object.keys(updateData).length === 0) {
      return this.toPublicUser(existing);
    }

    const updated = await this.usersService.updateById(userId, updateData);
    return this.toPublicUser(updated);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    sessionContext: SessionContext,
  ): Promise<{ success: true }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User does not exist',
      });
    }

    const currentPasswordMatches = await argon2.verify(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!currentPasswordMatches) {
      throw new BadRequestException({
        code: 'PASSWORD_MISMATCH',
        message: 'Current password is incorrect',
      });
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_REUSE',
        message: 'New password must be different from current password',
      });
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      this.assertTwoFactorInputProvided(dto.otp, dto.backupCode);

      if (dto.otp) {
        const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
        const otpIsValid = this.verifyTotpCode(secret, dto.otp);
        if (!otpIsValid) {
          throw new UnauthorizedException('Invalid OTP code');
        }
      } else if (dto.backupCode) {
        const consumed = await this.consumeBackupCode(user, dto.backupCode);
        if (!consumed) {
          throw new UnauthorizedException('Invalid backup code');
        }
      }
    }

    const nextPasswordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: nextPasswordHash,
        },
      });

      await this.revokeActiveSessionsForUser(
        tx,
        user.id,
        SessionRevokeReason.SECURITY,
        sessionContext,
      );

      await this.writeAuditLog(tx, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.SECURITY_EVENT,
        detail: {
          type: 'PASSWORD_CHANGED',
        },
      });
    });

    return { success: true };
  }

  async listSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<{ sessions: SessionView[] }> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: this.getSessionExpiresAt(session.createdAt),
        lastUsedAt: session.lastSeenAt,
        createdByIp: session.ip,
        createdByUserAgent: session.userAgent,
        isCurrent: currentSessionId === session.id,
      })),
    };
  }

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<{ success: true }> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
      },
    });
    if (!session) {
      throw new BadRequestException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.revokeSessionById(tx, session.id, SessionRevokeReason.ADMIN);
      await this.writeAuditLog(tx, {
        userId,
        email: null,
        action: AuditAction.SESSION_REVOKED,
        detail: { reason: SessionRevokeReason.ADMIN, sessionId: session.id },
      });
    });

    return { success: true };
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<{ revoked: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const sessions = await tx.session.findMany({
        where: {
          userId,
          revokedAt: null,
          ...(currentSessionId
            ? {
                id: {
                  not: currentSessionId,
                },
              }
            : {}),
        },
      });
      if (sessions.length === 0) {
        return 0;
      }
      const ids = sessions.map((session) => session.id);
      await tx.session.updateMany({
        where: { id: { in: ids } },
        data: {
          revokedAt: new Date(),
          revokeReason: SessionRevokeReason.ADMIN,
        },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: ids },
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
      await this.writeAuditLog(tx, {
        userId,
        email: null,
        action: AuditAction.SESSION_REVOKED,
        detail: { reason: SessionRevokeReason.ADMIN, count: ids.length },
      });
      return ids.length;
    });

    return { revoked: result };
  }

  async getAdminSecurityDashboard(actorUserId: string): Promise<{
    data: {
      users: {
        total: number;
        active: number;
        locked: number;
        disabled: number;
      };
      sessions: {
        active: number;
        revokedLast24h: number;
      };
      security: {
        twoFactorEnabledUsers: number;
        loginFailuresLast24h: number;
      };
    };
  }> {
    await this.requireSystemAdmin(actorUserId);

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      totalUsers,
      activeUsers,
      lockedUsers,
      disabledUsers,
      activeSessions,
      revokedLast24h,
      twoFactorEnabledUsers,
      loginFailuresLast24h,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.LOCKED } }),
      this.prisma.user.count({ where: { status: UserStatus.DISABLED } }),
      this.prisma.session.count({ where: { revokedAt: null } }),
      this.prisma.session.count({
        where: {
          revokedAt: {
            gte: last24h,
          },
        },
      }),
      this.prisma.user.count({
        where: {
          twoFactorEnabled: true,
        },
      }),
      this.prisma.auditLog.count({
        where: {
          action: AuditAction.LOGIN_FAIL,
          createdAt: {
            gte: last24h,
          },
        },
      }),
    ]);

    return {
      data: {
        users: {
          total: totalUsers,
          active: activeUsers,
          locked: lockedUsers,
          disabled: disabledUsers,
        },
        sessions: {
          active: activeSessions,
          revokedLast24h,
        },
        security: {
          twoFactorEnabledUsers,
          loginFailuresLast24h,
        },
      },
    };
  }

  async listAdminUsers(
    actorUserId: string,
    query: AdminUsersQuery,
  ): Promise<{
    data: Array<{
      id: string;
      email: string;
      status: UserStatus;
      systemRole: SystemRole;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      fullName: string | null;
      twoFactorEnabled: boolean;
      createdAt: Date;
      updatedAt: Date;
      lastLoginAt: Date | null;
    }>;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    await this.requireSystemAdmin(actorUserId);
    const pagination = this.resolvePagination(query.page, query.limit);

    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.systemRole ? { systemRole: query.systemRole } : {}),
    };

    const q = String(query.q ?? '').trim();
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          email: true,
          status: true,
          systemRole: true,
          firstName: true,
          lastName: true,
          displayName: true,
          fullName: true,
          twoFactorEnabled: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      }),
    ]);

    return {
      data: users,
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      },
    };
  }

  async updateAdminUserStatus(
    actorUserId: string,
    targetUserId: string,
    status: UserStatus,
  ): Promise<{
    data: {
      id: string;
      status: UserStatus;
      systemRole: SystemRole;
      updatedAt: Date;
    };
  }> {
    const actor = await this.requireSystemAdmin(actorUserId);
    if (
      actor.id === targetUserId &&
      (status === UserStatus.DISABLED || status === UserStatus.LOCKED)
    ) {
      throw new BadRequestException({
        code: 'INVALID_OPERATION',
        message: 'Cannot lock or disable your own account',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const next = await tx.user.update({
        where: { id: targetUserId },
        data: { status },
        select: {
          id: true,
          status: true,
          systemRole: true,
          updatedAt: true,
        },
      });

      if (status !== UserStatus.ACTIVE) {
        const now = new Date();
        const activeSessions = await tx.session.findMany({
          where: {
            userId: targetUserId,
            revokedAt: null,
          },
          select: { id: true },
        });
        if (activeSessions.length > 0) {
          const sessionIds = activeSessions.map((item) => item.id);
          await tx.session.updateMany({
            where: { id: { in: sessionIds } },
            data: {
              revokedAt: now,
              revokeReason: SessionRevokeReason.ADMIN,
            },
          });
          await tx.refreshToken.updateMany({
            where: {
              sessionId: { in: sessionIds },
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });
        }
      }

      await this.writeAuditLog(tx, {
        userId: actor.id,
        email: actor.email,
        action: AuditAction.SECURITY_EVENT,
        detail: {
          event: 'ADMIN_USER_STATUS_UPDATED',
          targetUserId,
          status,
        },
      });

      return next;
    });

    return {
      data: updated,
    };
  }

  async updateAdminUserSystemRole(
    actorUserId: string,
    targetUserId: string,
    systemRole: SystemRole,
  ): Promise<{
    data: {
      id: string;
      status: UserStatus;
      systemRole: SystemRole;
      updatedAt: Date;
    };
  }> {
    const actor = await this.requireSystemAdmin(actorUserId);
    if (
      actor.systemRole !== SystemRole.SUPER_ADMIN &&
      systemRole === SystemRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException({
        code: 'AUTH_FORBIDDEN',
        message: 'Only SUPER_ADMIN can assign SUPER_ADMIN role',
      });
    }

    if (
      actor.id === targetUserId &&
      actor.systemRole === SystemRole.SUPER_ADMIN &&
      systemRole !== SystemRole.SUPER_ADMIN
    ) {
      throw new BadRequestException({
        code: 'INVALID_OPERATION',
        message: 'SUPER_ADMIN cannot downgrade own role',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      if (
        actor.systemRole !== SystemRole.SUPER_ADMIN &&
        target.systemRole === SystemRole.SUPER_ADMIN
      ) {
        throw new ForbiddenException({
          code: 'AUTH_FORBIDDEN',
          message: 'Only SUPER_ADMIN can modify SUPER_ADMIN account',
        });
      }

      const next = await tx.user.update({
        where: { id: targetUserId },
        data: { systemRole },
        select: {
          id: true,
          status: true,
          systemRole: true,
          updatedAt: true,
        },
      });

      await this.writeAuditLog(tx, {
        userId: actor.id,
        email: actor.email,
        action: AuditAction.SECURITY_EVENT,
        detail: {
          event: 'ADMIN_USER_SYSTEM_ROLE_UPDATED',
          targetUserId,
          systemRole,
        },
      });

      return next;
    });

    return {
      data: updated,
    };
  }

  async listAdminUserSessions(
    actorUserId: string,
    targetUserId: string,
  ): Promise<{
    data: SessionView[];
  }> {
    await this.requireSystemAdmin(actorUserId);
    const target = await this.usersService.findById(targetUserId);
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: targetUserId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      data: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: this.getSessionExpiresAt(session.createdAt),
        lastUsedAt: session.lastSeenAt,
        createdByIp: session.ip,
        createdByUserAgent: session.userAgent,
        isCurrent: false,
      })),
    };
  }

  async revokeAdminUserSessions(
    actorUserId: string,
    targetUserId: string,
    sessionId?: string,
  ): Promise<{ data: { revoked: number } }> {
    const actor = await this.requireSystemAdmin(actorUserId);
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const sessions = await tx.session.findMany({
        where: {
          userId: targetUserId,
          revokedAt: null,
          ...(sessionId ? { id: sessionId } : {}),
        },
        select: {
          id: true,
        },
      });

      if (sessions.length === 0) {
        return 0;
      }

      const now = new Date();
      const sessionIds = sessions.map((item) => item.id);
      await tx.session.updateMany({
        where: {
          id: {
            in: sessionIds,
          },
        },
        data: {
          revokedAt: now,
          revokeReason: SessionRevokeReason.ADMIN,
        },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await this.writeAuditLog(tx, {
        userId: actor.id,
        email: actor.email,
        action: AuditAction.SESSION_REVOKED,
        detail: {
          reason: SessionRevokeReason.ADMIN,
          targetUserId,
          count: sessionIds.length,
          sessionId: sessionId ?? null,
        },
      });

      return sessionIds.length;
    });

    return {
      data: {
        revoked: result,
      },
    };
  }

  async listAdminAuditLogs(
    actorUserId: string,
    query: AdminAuditLogsQuery,
  ): Promise<{
    data: Array<{
      id: string;
      userId: string | null;
      email: string | null;
      ip: string | null;
      userAgent: string | null;
      action: AuditAction;
      detail: Prisma.JsonValue | null;
      createdAt: Date;
    }>;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    await this.requireSystemAdmin(actorUserId);
    const pagination = this.resolvePagination(query.page, query.limit);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
    };
    if (query.action) {
      const action = String(query.action).trim();
      if ((Object.values(AuditAction) as string[]).includes(action)) {
        where.action = action as AuditAction;
      }
    }
    if (query.email) {
      where.email = {
        contains: query.email.trim(),
        mode: 'insensitive',
      };
    }
    if (query.from || query.to) {
      const from = this.parseDateInput(query.from, 'from');
      const to = this.parseDateInput(query.to, 'to');
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        email: row.email,
        ip: row.ip,
        userAgent: row.userAgent,
        action: row.action,
        detail: row.detail as Prisma.JsonValue | null,
        createdAt: row.createdAt,
      })),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      },
    };
  }

  getGoogleAuthorizationUrl(state: string): string {
    if (!this.isGoogleOAuthConfigured()) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    const params = new URLSearchParams({
      client_id: this.googleOauthClientId,
      redirect_uri: this.googleOauthRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'select_account',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async loginWithGoogleAuthCode(
    code: string,
    sessionContext: SessionContext,
  ): Promise<LoginResult> {
    if (!this.isGoogleOAuthConfigured()) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: this.googleOauthClientId,
        client_secret: this.googleOauthClientSecret,
        redirect_uri: this.googleOauthRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new UnauthorizedException('Google authentication failed');
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token?: string;
    };

    if (!tokenPayload.access_token) {
      throw new UnauthorizedException('Google authentication failed');
    }

    const profileResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
        },
      },
    );

    if (!profileResponse.ok) {
      throw new UnauthorizedException('Google profile lookup failed');
    }

    const profile = (await profileResponse.json()) as GoogleUserProfile;
    if (!profile.sub || !profile.email || !profile.email_verified) {
      throw new UnauthorizedException(
        'Google account must have verified email',
      );
    }

    const normalizedEmail = profile.email.toLowerCase().trim();
    const googleName = this.normalizeNullableText(profile.name, 120);
    let user = await this.usersService.findByGoogleId(profile.sub);

    if (!user) {
      const existingByEmail =
        await this.usersService.findByEmail(normalizedEmail);
      if (existingByEmail) {
        const patch: Prisma.UserUpdateInput = {
          googleId: profile.sub,
        };
        const shouldBackfillFirstName =
          !this.normalizeNullableText(existingByEmail.firstName, 120) &&
          googleName;
        if (shouldBackfillFirstName) {
          patch.firstName = googleName;
        }
        const shouldBackfillFullName =
          !this.normalizeNullableText(existingByEmail.fullName, 120) &&
          googleName;
        if (shouldBackfillFullName) {
          patch.fullName = googleName;
        }
        if (
          !this.normalizeNullableText(existingByEmail.displayName, 120) ||
          shouldBackfillFirstName ||
          shouldBackfillFullName
        ) {
          patch.displayName = this.buildDisplayName({
            firstName: shouldBackfillFirstName
              ? googleName
              : existingByEmail.firstName,
            lastName: existingByEmail.lastName,
            fullName: shouldBackfillFullName
              ? googleName
              : existingByEmail.fullName,
            email: existingByEmail.email,
            fallbackDisplayName: existingByEmail.displayName,
          });
        }
        user = await this.usersService.updateById(existingByEmail.id, patch);
      } else {
        const passwordHash = await argon2.hash(randomUUID(), {
          type: argon2.argon2id,
        });
        const firstName = googleName ?? normalizedEmail.split('@')[0];
        const createdUser = await this.usersService.create({
          email: normalizedEmail,
          passwordHash,
          firstName,
          lastName: null,
          fullName: googleName,
          displayName: this.buildDisplayName({
            firstName,
            lastName: null,
            fullName: googleName,
            email: normalizedEmail,
          }),
        });
        user = await this.usersService.updateById(createdUser.id, {
          googleId: profile.sub,
        });
      }
    }

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      return {
        requiresTwoFactor: true,
        twoFactorToken: await this.signTwoFactorChallenge(user),
      };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await this.revokeActiveSessionsForUser(
        tx,
        user.id,
        SessionRevokeReason.NEW_LOGIN,
        sessionContext,
      );
      const tokens = await this.issueTokens(tx, user, {
        ...sessionContext,
        deviceId: null,
      });
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
        },
      });
      await this.writeAuditLog(tx, {
        userId: user.id,
        email: user.email,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        action: AuditAction.LOGIN_OK,
        detail: { provider: 'google' },
      });
      if (revoked.sessionsRevoked > 0) {
        await this.writeAuditLog(tx, {
          userId: user.id,
          email: user.email,
          ip: sessionContext.ip,
          userAgent: sessionContext.userAgent,
          action: AuditAction.SESSION_REVOKED,
          detail: {
            reason: SessionRevokeReason.NEW_LOGIN,
            count: revoked.sessionsRevoked,
          },
        });
      }

      return {
        user: updatedUser,
        tokens,
      };
    });

    return {
      user: this.toPublicUser(result.user),
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      session: { sid: result.tokens.sessionId },
    };
  }

  async createOauthExchangeCode(session: AuthSession): Promise<string> {
    const code = this.generateOauthExchangeCode();
    const codeHash = this.hashOauthExchangeCode(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.oauthExchangeCodeExpiresInMs);

    await this.prisma.oauthExchangeCode.create({
      data: {
        id: randomUUID(),
        codeHash,
        payloadJson: this.serializeOauthExchangePayload(session),
        expiresAt,
      },
    });

    return code;
  }

  async consumeOauthExchangeCode(rawCode: string): Promise<AuthSession> {
    const oauthCode = String(rawCode || '').trim();
    if (!oauthCode) {
      throw new UnauthorizedException('OAuth exchange code is required');
    }

    const now = new Date();
    const codeHash = this.hashOauthExchangeCode(oauthCode);
    const payload = await this.prisma.$transaction(async (tx) => {
      const row = await tx.oauthExchangeCode.findUnique({
        where: { codeHash },
      });
      if (!row || row.expiresAt <= now || row.consumedAt) {
        throw new UnauthorizedException('OAuth exchange code is invalid or expired');
      }

      const consumed = await tx.oauthExchangeCode.updateMany({
        where: {
          id: row.id,
          consumedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          consumedAt: now,
        },
      });

      if (consumed.count !== 1) {
        throw new UnauthorizedException('OAuth exchange code is invalid or expired');
      }

      return row.payloadJson;
    });

    return this.deserializeOauthExchangePayload(payload as Prisma.JsonValue);
  }

  private async issueTokens(
    tx: PrismaTx,
    user: User,
    sessionContext: SessionContext,
  ): Promise<AuthTokens> {
    const now = new Date();
    const sessionId = randomUUID();
    const accessToken = await this.signAccessToken(
      user.id,
      user.email,
      sessionId,
      user.systemRole,
    );

    await tx.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        ip: sessionContext.ip,
        userAgent: sessionContext.userAgent,
        deviceId: sessionContext.deviceId ?? null,
        lastSeenAt: now,
      },
    });

    return {
      accessToken,
      expiresIn: this.accessTokenExpiresInSeconds,
      sessionId,
    };
  }

  private async signAccessToken(
    userId: string,
    email: string,
    sessionId: string,
    systemRole: SystemRole,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: userId,
        email,
        sid: sessionId,
        systemRole,
      },
      {
        algorithm: 'RS256',
        privateKey: this.jwtKeyService.getActivePrivateKey(),
        keyid: this.jwtKeyService.getActiveKid(),
        expiresIn: this.accessTokenExpiresIn,
        issuer: this.jwtKeyService.getIssuer(),
        audience: this.jwtKeyService.getAudience(),
      },
    );
  }

  private async signTwoFactorChallenge(user: User): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        purpose: '2fa-login',
        nonce: randomUUID(),
      },
      {
        algorithm: 'RS256',
        privateKey: this.jwtKeyService.getActivePrivateKey(),
        keyid: this.jwtKeyService.getActiveKid(),
        expiresIn: this.twoFactorChallengeExpiresIn,
        issuer: this.jwtKeyService.getIssuer(),
        audience: this.jwtKeyService.getAudience(),
      },
    );
  }

  private async verifyTwoFactorChallenge(
    token: string,
  ): Promise<TwoFactorChallengePayload> {
    try {
      const payload =
        await this.jwtService.verifyAsync<TwoFactorChallengePayload>(token, {
          algorithms: ['RS256'],
          publicKey: this.jwtKeyService.getActivePublicKey(),
          issuer: this.jwtKeyService.getIssuer(),
          audience: this.jwtKeyService.getAudience(),
        });

      if (
        !payload.sub ||
        !payload.email ||
        payload.purpose !== '2fa-login' ||
        !payload.nonce
      ) {
        throw new UnauthorizedException({
          code: 'TWO_FACTOR_INVALID',
          message: 'Invalid 2FA challenge',
        });
      }

      return payload;
    } catch {
      throw new UnauthorizedException({
        code: 'TWO_FACTOR_INVALID',
        message: 'Invalid or expired 2FA challenge',
      });
    }
  }

  private getSessionExpiresAt(createdAt: Date): Date {
    return new Date(
      createdAt.getTime() + this.accessTokenExpiresInSeconds * 1000,
    );
  }

  private async revokeActiveSessionsForUser(
    tx: PrismaTx,
    userId: string,
    reason: SessionRevokeReason,
    sessionContext: SessionContext,
  ): Promise<{ sessionsRevoked: number }> {
    const activeSessions = await tx.session.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (activeSessions.length === 0) {
      return { sessionsRevoked: 0 };
    }

    const sessionIds = activeSessions.map((session) => session.id);
    await tx.session.updateMany({
      where: {
        id: { in: sessionIds },
      },
      data: {
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
    await tx.refreshToken.updateMany({
      where: {
        sessionId: { in: sessionIds },
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.writeAuditLog(tx, {
      userId,
      email: null,
      ip: sessionContext.ip,
      userAgent: sessionContext.userAgent,
      action: AuditAction.SESSION_REVOKED,
      detail: {
        reason,
        count: sessionIds.length,
      },
    });

    return { sessionsRevoked: sessionIds.length };
  }

  private async revokeSessionById(
    tx: PrismaTx,
    sessionId: string,
    reason: SessionRevokeReason,
  ): Promise<void> {
    const now = new Date();
    await tx.session.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: reason,
      },
    });
    await tx.refreshToken.updateMany({
      where: {
        sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
  }

  private async writeAuditLog(
    tx: PrismaTx | PrismaService,
    input: {
      userId?: string | null;
      email?: string | null;
      ip?: string | null;
      userAgent?: string | null;
      action: AuditAction;
      detail?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId ?? null,
        email: input.email ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        action: input.action,
        detail:
          input.detail === undefined
            ? undefined
            : ((input.detail ?? null) as Prisma.InputJsonValue),
      },
    });
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      systemRole: user.systemRole,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      dob: user.dob,
      address: user.address,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      locale: user.locale,
      fullName: user.fullName,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private generateOauthExchangeCode(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashOauthExchangeCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private serializeOauthExchangePayload(
    session: AuthSession,
  ): Prisma.InputJsonValue {
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      session: {
        sid: session.session.sid,
      },
      user: {
        id: session.user.id,
        email: session.user.email,
        status: session.user.status,
        systemRole: session.user.systemRole,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        displayName: session.user.displayName,
        dob: session.user.dob ? session.user.dob.toISOString() : null,
        address: session.user.address,
        avatarUrl: session.user.avatarUrl,
        timezone: session.user.timezone,
        locale: session.user.locale,
        fullName: session.user.fullName,
        twoFactorEnabled: session.user.twoFactorEnabled,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    };
  }

  private deserializeOauthExchangePayload(payload: Prisma.JsonValue): AuthSession {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new UnauthorizedException('OAuth exchange payload is invalid');
    }

    const record = payload as Record<string, unknown>;
    const accessToken =
      typeof record.accessToken === 'string' ? record.accessToken.trim() : '';
    const expiresIn = Number(record.expiresIn);
    const sessionRecord =
      record.session && typeof record.session === 'object' && !Array.isArray(record.session)
        ? (record.session as Record<string, unknown>)
        : {};
    const sid = typeof sessionRecord.sid === 'string' ? sessionRecord.sid.trim() : '';
    const user = this.deserializePublicUserFromOauthPayload(record.user);

    if (
      !accessToken ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      !sid ||
      !user
    ) {
      throw new UnauthorizedException('OAuth exchange payload is invalid');
    }

    return {
      accessToken,
      expiresIn: Math.floor(expiresIn),
      session: { sid },
      user,
    };
  }

  private deserializePublicUserFromOauthPayload(input: unknown): PublicUser | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const record = input as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const email = typeof record.email === 'string' ? record.email.trim() : '';
    const status = this.toUserStatus(record.status);
    const systemRole = this.toSystemRole(record.systemRole);
    const createdAt = this.toDate(record.createdAt);
    const updatedAt = this.toDate(record.updatedAt);

    if (!id || !email || !status || !systemRole || !createdAt || !updatedAt) {
      return null;
    }

    const dob = this.toNullableDate(record.dob);

    return {
      id,
      email,
      status,
      systemRole,
      firstName: this.toNullableString(record.firstName),
      lastName: this.toNullableString(record.lastName),
      displayName: this.toNullableString(record.displayName),
      dob,
      address: this.toNullableString(record.address),
      avatarUrl: this.toNullableString(record.avatarUrl),
      timezone: this.toNullableString(record.timezone),
      locale: this.toNullableString(record.locale),
      fullName: this.toNullableString(record.fullName),
      twoFactorEnabled: record.twoFactorEnabled === true,
      createdAt,
      updatedAt,
    };
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toNullableDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return this.toDate(value);
  }

  private toDate(value: unknown): Date | null {
    if (typeof value !== 'string' && !(value instanceof Date)) {
      return null;
    }
    const raw = value instanceof Date ? value.toISOString() : value;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private toUserStatus(value: unknown): UserStatus | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === UserStatus.ACTIVE ||
      normalized === UserStatus.LOCKED ||
      normalized === UserStatus.DISABLED
    ) {
      return normalized as UserStatus;
    }
    return null;
  }

  private toSystemRole(value: unknown): SystemRole | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === SystemRole.SUPER_ADMIN ||
      normalized === SystemRole.SYSTEM_ADMIN ||
      normalized === SystemRole.USER
    ) {
      return normalized as SystemRole;
    }
    return null;
  }

  private buildDisplayName(input: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    email: string;
    fallbackDisplayName?: string | null;
  }): string {
    const normalizedFirstName = this.normalizeNullableText(input.firstName, 120);
    const normalizedLastName = this.normalizeNullableText(input.lastName, 120);
    const normalizedFullName = this.normalizeNullableText(input.fullName, 120);
    const normalizedFallbackDisplayName = this.normalizeNullableText(
      input.fallbackDisplayName,
      120,
    );

    const splitName = this.normalizeNullableText(
      [normalizedFirstName, normalizedLastName].filter(Boolean).join(' '),
      120,
    );
    if (splitName) {
      return splitName;
    }

    if (normalizedFirstName) {
      return normalizedFirstName;
    }

    if (normalizedFullName) {
      return normalizedFullName;
    }

    if (normalizedFallbackDisplayName) {
      return normalizedFallbackDisplayName;
    }

    const localPart = String(input.email || '').split('@')[0].trim();
    if (localPart) {
      return localPart.slice(0, 120);
    }

    return 'User';
  }

  private normalizeNullableText(
    value: string | null | undefined,
    maxLength: number,
  ): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.slice(0, maxLength);
  }

  private verifyTotpCode(secret: string, otp: string): boolean {
    return authenticator.verify({
      token: otp.trim(),
      secret,
    });
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: 8 }).map(() => {
      const value = randomBytes(4).toString('hex').toUpperCase();
      return `${value.slice(0, 4)}-${value.slice(4, 8)}`;
    });
  }

  private normalizeBackupCode(code: string): string {
    return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private extractBackupCodeHashes(user: User): string[] {
    const rawCodes = user.twoFactorBackupCodes;
    if (!Array.isArray(rawCodes)) {
      return [];
    }

    return rawCodes.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }

  private async consumeBackupCode(
    user: User,
    backupCode: string,
  ): Promise<boolean> {
    const hashes = this.extractBackupCodeHashes(user);
    if (hashes.length === 0) {
      return false;
    }

    const normalizedCode = this.normalizeBackupCode(backupCode);

    for (let index = 0; index < hashes.length; index += 1) {
      const hash = hashes[index];
      const isMatch = await argon2.verify(hash, normalizedCode);
      if (isMatch) {
        const remainingHashes = hashes.filter(
          (_, itemIndex) => itemIndex !== index,
        );
        await this.usersService.updateById(user.id, {
          twoFactorBackupCodes: remainingHashes,
        });
        return true;
      }
    }

    return false;
  }

  private encryptTwoFactorSecret(secret: string): string {
    const key = createHash('sha256')
      .update(this.twoFactorEncryptionSecret)
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64url'),
      authTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  private decryptTwoFactorSecret(payload: string): string {
    const [ivEncoded, authTagEncoded, encryptedEncoded] = payload.split('.');
    if (!ivEncoded || !authTagEncoded || !encryptedEncoded) {
      throw new InternalServerErrorException('Stored 2FA secret is invalid');
    }

    const key = createHash('sha256')
      .update(this.twoFactorEncryptionSecret)
      .digest();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64url'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private isGoogleOAuthConfigured(): boolean {
    return (
      this.googleOauthClientId.trim().length > 0 &&
      this.googleOauthClientSecret.trim().length > 0 &&
      this.googleOauthRedirectUri.trim().length > 0
    );
  }

  private assertTwoFactorInputProvided(
    otp: string | undefined,
    backupCode: string | undefined,
  ): void {
    if (!otp && !backupCode) {
      throw new BadRequestException('Provide OTP or backup code');
    }
  }

  private assertAuthAttemptsAllowed(email: string, requestIp: string): void {
    this.cleanupExpiredFailedAttempts();

    const key = this.buildAuthAttemptKey(email, requestIp);
    const attempt = this.failedAuthAttempts.get(key);
    if (attempt && attempt.count >= this.maxFailedAttemptsPerWindow) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private registerFailedAuthAttempt(email: string, requestIp: string): void {
    this.cleanupExpiredFailedAttempts();

    const key = this.buildAuthAttemptKey(email, requestIp);
    const current = this.failedAuthAttempts.get(key);
    const now = Date.now();

    if (!current) {
      this.failedAuthAttempts.set(key, { count: 1, windowStartedAt: now });
      return;
    }

    if (now - current.windowStartedAt > this.failedAttemptWindowMs) {
      this.failedAuthAttempts.set(key, { count: 1, windowStartedAt: now });
      return;
    }

    current.count += 1;
    this.failedAuthAttempts.set(key, current);
  }

  private clearFailedAuthAttempts(email: string, requestIp: string): void {
    const key = this.buildAuthAttemptKey(email, requestIp);
    this.failedAuthAttempts.delete(key);
  }

  private cleanupExpiredFailedAttempts(): void {
    const now = Date.now();
    for (const [key, value] of this.failedAuthAttempts.entries()) {
      if (now - value.windowStartedAt > this.failedAttemptWindowMs) {
        this.failedAuthAttempts.delete(key);
      }
    }
  }

  private async requireSystemAdmin(userId: string): Promise<User> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User does not exist',
      });
    }
    if (!SYSTEM_ADMIN_ROLES.has(user.systemRole)) {
      throw new ForbiddenException({
        code: 'AUTH_FORBIDDEN',
        message: 'Admin permission required',
      });
    }
    return user;
  }

  private resolvePagination(
    page?: number,
    limit?: number,
  ): { page: number; limit: number; skip: number } {
    const safePage =
      Number.isInteger(page) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit =
      Number.isInteger(limit) && Number(limit) > 0
        ? Math.min(Number(limit), 100)
        : 20;

    return {
      page: safePage,
      limit: safeLimit,
      skip: (safePage - 1) * safeLimit,
    };
  }

  private parseDateInput(value: string | undefined, fieldName: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Invalid ${fieldName} datetime`,
      });
    }
    return parsed;
  }

  private buildAuthAttemptKey(email: string, requestIp: string): string {
    return `${email.toLowerCase().trim()}::${requestIp}`;
  }
}
