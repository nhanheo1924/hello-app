import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import ms, { type StringValue } from 'ms';
import { randomUUID } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AuthService,
  AuthSession,
  LoginResult,
  TwoFactorChallengeResponse,
} from './auth.service';
import { ConfirmTwoFactorDto } from './dto/confirm-two-factor.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { LoginDto } from './dto/login.dto';
import {
  AdminAuditLogsQueryDto,
  AdminUsersQueryDto,
} from './dto/admin-query.dto';
import { RegisterDto } from './dto/register.dto';
import { RevokeAdminSessionsDto } from './dto/revoke-admin-sessions.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { UpdateAdminUserStatusDto } from './dto/update-admin-user-status.dto';
import { UpdateAdminUserSystemRoleDto } from './dto/update-admin-user-system-role.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyTwoFactorLoginDto } from './dto/verify-two-factor-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { PublicUser } from './interfaces/auth-response.interface';

const GOOGLE_STATE_COOKIE_NAME = 'ctm_google_oauth_state';
const GOOGLE_CALLBACK_COOKIE_NAME = 'ctm_google_oauth_callback';
const TWO_FACTOR_CHALLENGE_COOKIE_NAME = 'ctm_2fa_challenge';

@Controller('auth')
export class AuthController {
  private readonly googleStateCookieOptions: CookieOptions;
  private readonly twoFactorChallengeCookieOptions: CookieOptions;
  private readonly webAppUrl: string;
  private readonly webAppOauthCallbackUrl: string;
  private readonly publicAuthBasePath: string;
  private readonly allowedWebOrigins: Set<string>;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    const secureCookies =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.publicAuthBasePath = this.normalizePublicAuthBasePath(
      this.configService.get<string>('AUTH_PUBLIC_BASE_PATH', '/api/v1/auth'),
    );

    this.googleStateCookieOptions = {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: `${this.publicAuthBasePath}/google`,
      maxAge: 10 * 60 * 1000,
    };

    const challengeTtlConfig = this.configService.get<StringValue>(
      'TWO_FACTOR_CHALLENGE_EXPIRES_IN',
      '5m' as StringValue,
    );
    const challengeTtlMs = ms(challengeTtlConfig);
    this.twoFactorChallengeCookieOptions = {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: `${this.publicAuthBasePath}/2fa`,
      maxAge:
        typeof challengeTtlMs === 'number' ? challengeTtlMs : 5 * 60 * 1000,
    };

    this.webAppUrl = this.configService.get<string>(
      'WEB_APP_URL',
      'http://localhost:5173',
    );
    this.webAppOauthCallbackUrl = this.configService.get<string>(
      'WEB_APP_OAUTH_CALLBACK_URL',
      new URL('/auth/callback/', this.webAppUrl).toString(),
    );
    this.allowedWebOrigins = this.buildAllowedWebOrigins(
      this.configService.get<string>('CORS_ORIGIN', ''),
      this.webAppUrl,
      this.webAppOauthCallbackUrl,
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  // expose both /auth/register and /auth/signup for compatibility with frontend
  @Post(['register', 'signup'])
  async register(@Body() dto: RegisterDto, @Req() request: Request) {
    const result = await this.authService.register(
      dto,
      this.getSessionContext(request),
    );
    return this.toAuthResponse(result);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.authService.login(
      dto,
      this.getSessionContext(request, dto.deviceId),
    );

    if (this.isTwoFactorChallenge(result)) {
      return result;
    }

    return this.toAuthResponse(result);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('2fa/verify-login')
  async verifyTwoFactorLogin(
    @Body() dto: VerifyTwoFactorLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challengeToken =
      dto.twoFactorToken?.trim() ??
      this.getCookieValue(request, TWO_FACTOR_CHALLENGE_COOKIE_NAME);

    if (!challengeToken) {
      throw new UnauthorizedException('Missing 2FA challenge token');
    }

    const result = await this.authService.verifyTwoFactorLogin(
      {
        ...dto,
        twoFactorToken: challengeToken,
      },
      this.getSessionContext(request),
    );

    this.clearTwoFactorChallengeCookie(response);

    return this.toAuthResponse(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser('userId') userId: string) {
    return this.authService.beginTwoFactorSetup(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/confirm')
  confirmTwoFactor(
    @CurrentUser('userId') userId: string,
    @Body() dto: ConfirmTwoFactorDto,
  ) {
    return this.authService.confirmTwoFactorSetup(userId, dto.otp);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disableTwoFactor(
    @CurrentUser('userId') userId: string,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.authService.disableTwoFactor(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('logout')
  logout(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sid') sessionId: string,
  ) {
    return this.authService.logout(userId, sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sid') sessionId: string,
  ) {
    return this.authService.listSessions(userId, sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke')
  revokeSession(
    @CurrentUser('userId') userId: string,
    @Body() dto: RevokeSessionDto,
  ) {
    return this.authService.revokeSession(userId, dto.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  revokeOtherSessions(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sid') sessionId: string,
  ) {
    return this.authService.revokeOtherSessions(userId, sessionId);
  }

  // allow both /auth/google and /auth/google/start as entry points
  @Get(['google', 'google/start'])
  googleStart(
    @Query('callback') callback: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      const state = randomUUID();
      const url = this.authService.getGoogleAuthorizationUrl(state);
      const callbackUrl = this.resolveRequestedOauthCallbackUrl(
        callback,
        request,
      );
      response.cookie(
        GOOGLE_STATE_COOKIE_NAME,
        state,
        this.googleStateCookieOptions,
      );
      if (callbackUrl) {
        response.cookie(
          GOOGLE_CALLBACK_COOKIE_NAME,
          callbackUrl,
          this.googleStateCookieOptions,
        );
      } else {
        this.clearGoogleCallbackCookie(response);
      }
      return response.redirect(url);
    } catch {
      return this.redirectToWeb(response, 'error', 'Google login unavailable');
    }
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const stateFromCookie = this.getCookieValue(
      request,
      GOOGLE_STATE_COOKIE_NAME,
    );
    const callbackUrlFromCookie = this.getCookieValue(
      request,
      GOOGLE_CALLBACK_COOKIE_NAME,
    );
    this.clearGoogleStateCookie(response);
    this.clearGoogleCallbackCookie(response);

    if (!code || !state || !stateFromCookie || state !== stateFromCookie) {
      return this.redirectToWeb(
        response,
        'error',
        'Invalid Google login state',
        callbackUrlFromCookie,
      );
    }

    try {
      const result = await this.authService.loginWithGoogleAuthCode(
        code,
        this.getSessionContext(request),
      );

      if (this.isTwoFactorChallenge(result)) {
        this.setTwoFactorChallengeCookie(response, result.twoFactorToken);
        return this.redirectToWeb(
          response,
          '2fa',
          undefined,
          callbackUrlFromCookie,
        );
      }

      // successful login; send token back via query param for frontend to consume
      const successUrl = this.buildWebOauthCallbackUrl(callbackUrlFromCookie);
      // redirect back to the sign‑in page with the token so frontend can pick it up
      successUrl.searchParams.set('token', result.accessToken);
      return response.redirect(successUrl.toString());
    } catch {
      return this.redirectToWeb(
        response,
        'error',
        'Google login failed',
        callbackUrlFromCookie,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sid') sid: string,
  ) {
    const user = await this.authService.getProfile(userId, sid);
    return {
      user: this.toUserResponse(user),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.authService.updateProfile(userId, dto);
    return {
      user: this.toUserResponse(user),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  changePassword(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.authService.changePassword(
      userId,
      dto,
      this.getSessionContext(request),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/dashboard/security')
  adminSecurityDashboard(@CurrentUser('userId') userId: string) {
    return this.authService.getAdminSecurityDashboard(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/users')
  adminUsers(
    @CurrentUser('userId') userId: string,
    @Query() query: AdminUsersQueryDto,
  ) {
    return this.authService.listAdminUsers(userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/users/:userId/status')
  adminUpdateUserStatus(
    @CurrentUser('userId') actorUserId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateAdminUserStatusDto,
  ) {
    return this.authService.updateAdminUserStatus(
      actorUserId,
      targetUserId,
      dto.status,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/users/:userId/system-role')
  adminUpdateUserSystemRole(
    @CurrentUser('userId') actorUserId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateAdminUserSystemRoleDto,
  ) {
    return this.authService.updateAdminUserSystemRole(
      actorUserId,
      targetUserId,
      dto.systemRole,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/users/:userId/sessions')
  adminUserSessions(
    @CurrentUser('userId') actorUserId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.authService.listAdminUserSessions(actorUserId, targetUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/users/:userId/sessions/revoke')
  adminRevokeUserSessions(
    @CurrentUser('userId') actorUserId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: RevokeAdminSessionsDto,
  ) {
    return this.authService.revokeAdminUserSessions(
      actorUserId,
      targetUserId,
      dto.sessionId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/audit-logs')
  adminAuditLogs(
    @CurrentUser('userId') userId: string,
    @Query() query: AdminAuditLogsQueryDto,
  ) {
    return this.authService.listAdminAuditLogs(userId, query);
  }

  private toAuthResponse(result: AuthSession): {
    accessToken: string;
    expiresIn: number;
    session: { sid: string };
    user: {
      id: string;
      email: string;
      systemRole: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      dob: Date | null;
      address: string | null;
      avatarUrl: string | null;
      timezone: string | null;
      locale: string | null;
      fullName: string | null;
      twoFactorEnabled: boolean;
    };
  } {
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      session: result.session,
      user: this.toUserResponse(result.user),
    };
  }

  private toUserResponse(user: PublicUser): {
    id: string;
    email: string;
    systemRole: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    dob: Date | null;
    address: string | null;
    avatarUrl: string | null;
    timezone: string | null;
    locale: string | null;
    fullName: string | null;
    twoFactorEnabled: boolean;
  } {
    return {
      id: user.id,
      email: user.email,
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
    };
  }

  private redirectToWeb(
    response: Response,
    status: 'success' | 'error' | '2fa',
    message?: string,
    callbackUrlOverride?: string,
  ) {
    const url = this.buildWebOauthCallbackUrl(callbackUrlOverride);
    url.searchParams.set('google', status);
    if (message) {
      url.searchParams.set('message', message);
    }
    return response.redirect(url.toString());
  }

  private buildWebOauthCallbackUrl(callbackUrlOverride?: string): URL {
    const normalizedOverride = this.normalizeOauthCallbackUrl(
      callbackUrlOverride,
    );
    return new URL(normalizedOverride ?? this.webAppOauthCallbackUrl);
  }

  private getCookieValue(request: Request, key: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private setTwoFactorChallengeCookie(response: Response, token: string): void {
    response.cookie(
      TWO_FACTOR_CHALLENGE_COOKIE_NAME,
      token,
      this.twoFactorChallengeCookieOptions,
    );
  }

  private clearTwoFactorChallengeCookie(response: Response): void {
    response.clearCookie(TWO_FACTOR_CHALLENGE_COOKIE_NAME, {
      httpOnly: true,
      sameSite: this.twoFactorChallengeCookieOptions.sameSite,
      secure: this.twoFactorChallengeCookieOptions.secure,
      path: this.twoFactorChallengeCookieOptions.path,
    });
  }

  private clearGoogleStateCookie(response: Response): void {
    response.clearCookie(GOOGLE_STATE_COOKIE_NAME, {
      httpOnly: true,
      sameSite: this.googleStateCookieOptions.sameSite,
      secure: this.googleStateCookieOptions.secure,
      path: this.googleStateCookieOptions.path,
    });
  }

  private clearGoogleCallbackCookie(response: Response): void {
    response.clearCookie(GOOGLE_CALLBACK_COOKIE_NAME, {
      httpOnly: true,
      sameSite: this.googleStateCookieOptions.sameSite,
      secure: this.googleStateCookieOptions.secure,
      path: this.googleStateCookieOptions.path,
    });
  }

  private getSessionContext(
    request: Request,
    deviceId?: string,
  ): {
    ip: string;
    userAgent: string | null;
    deviceId?: string | null;
  } {
    return {
      ip: this.getRequestIp(request),
      userAgent: this.getRequestUserAgent(request),
      deviceId: deviceId?.trim() || null,
    };
  }

  private getRequestIp(request: Request): string {
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  private getRequestUserAgent(request: Request): string | null {
    const userAgent = request.get('user-agent');
    if (typeof userAgent !== 'string') {
      return null;
    }

    const trimmedUserAgent = userAgent.trim();
    if (trimmedUserAgent.length === 0) {
      return null;
    }

    return trimmedUserAgent.slice(0, 512);
  }

  private isTwoFactorChallenge(
    result: LoginResult,
  ): result is TwoFactorChallengeResponse {
    return (result as TwoFactorChallengeResponse).requiresTwoFactor === true;
  }

  private resolveRequestedOauthCallbackUrl(
    callback: string | undefined,
    request: Request,
  ): string | undefined {
    const direct = this.normalizeOauthCallbackUrl(callback);
    if (direct) {
      return direct;
    }

    const requestOrigin = this.getRequestOrigin(request);
    if (!requestOrigin) {
      return undefined;
    }

    const derived = this.normalizeOauthCallbackUrl(
      new URL('/auth/callback/', requestOrigin).toString(),
    );
    return derived ?? undefined;
  }

  private normalizeOauthCallbackUrl(value: string | undefined): string | null {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }

      if (!this.allowedWebOrigins.has(parsed.origin)) {
        return null;
      }

      if (!parsed.pathname.startsWith('/auth/callback')) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }

  private getRequestOrigin(request: Request): string | null {
    const originHeader = request.get('origin');
    if (typeof originHeader === 'string' && originHeader.trim().length > 0) {
      try {
        return new URL(originHeader.trim()).origin;
      } catch {
        // ignore invalid origin header
      }
    }

    const refererHeader = request.get('referer');
    if (typeof refererHeader === 'string' && refererHeader.trim().length > 0) {
      try {
        return new URL(refererHeader.trim()).origin;
      } catch {
        // ignore invalid referer header
      }
    }

    return null;
  }

  private buildAllowedWebOrigins(
    corsOriginsValue: string,
    webAppUrl: string,
    webAppOauthCallbackUrl: string,
  ): Set<string> {
    const origins = new Set<string>();

    const addOrigin = (value: string | undefined): void => {
      const raw = String(value || '').trim();
      if (!raw || raw === '*') {
        return;
      }

      try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          origins.add(parsed.origin);
        }
      } catch {
        // ignore invalid URL values
      }
    };

    addOrigin(webAppUrl);
    addOrigin(webAppOauthCallbackUrl);

    const corsOrigins = String(corsOriginsValue || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    for (const origin of corsOrigins) {
      addOrigin(origin);
    }

    return origins;
  }

  private normalizePublicAuthBasePath(value: string): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return '/api/v1/auth';
    }

    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeadingSlash.replace(/\/+$/, '');
  }
}
