import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  Prisma,
  SessionRevokeReason,
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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
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

type PrismaTx = Prisma.TransactionClient;

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
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: dto.fullName?.trim() || null,
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
    let user = await this.usersService.findByGoogleId(profile.sub);

    if (!user) {
      const existingByEmail =
        await this.usersService.findByEmail(normalizedEmail);
      if (existingByEmail) {
        user = await this.usersService.updateById(existingByEmail.id, {
          googleId: profile.sub,
          fullName: existingByEmail.fullName ?? profile.name?.trim() ?? null,
        });
      } else {
        const passwordHash = await argon2.hash(randomUUID(), {
          type: argon2.argon2id,
        });
        const createdUser = await this.usersService.create({
          email: normalizedEmail,
          passwordHash,
          fullName: profile.name?.trim() || null,
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
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: userId,
        email,
        sid: sessionId,
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
      fullName: user.fullName,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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

  private buildAuthAttemptKey(email: string, requestIp: string): string {
    return `${email.toLowerCase().trim()}::${requestIp}`;
  }
}
