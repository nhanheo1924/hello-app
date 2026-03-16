import {
  Body,
  Controller,
  Get,
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
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';
import { VerifyTwoFactorLoginDto } from './dto/verify-two-factor-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { PublicUser } from './interfaces/auth-response.interface';

const GOOGLE_STATE_COOKIE_NAME = 'ctm_google_oauth_state';
const TWO_FACTOR_CHALLENGE_COOKIE_NAME = 'ctm_2fa_challenge';

@Controller('auth')
export class AuthController {
  private readonly googleStateCookieOptions: CookieOptions;
  private readonly twoFactorChallengeCookieOptions: CookieOptions;
  private readonly webAppUrl: string;
  private readonly webAppOauthCallbackUrl: string;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    const secureCookies =
      this.configService.get<string>('NODE_ENV') === 'production';

    this.googleStateCookieOptions = {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      path: '/api/auth/google',
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
      path: '/api/auth/2fa',
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
  googleStart(@Res() response: Response) {
    try {
      const state = randomUUID();
      const url = this.authService.getGoogleAuthorizationUrl(state);
      response.cookie(
        GOOGLE_STATE_COOKIE_NAME,
        state,
        this.googleStateCookieOptions,
      );
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
    this.clearGoogleStateCookie(response);

    if (!code || !state || !stateFromCookie || state !== stateFromCookie) {
      return this.redirectToWeb(
        response,
        'error',
        'Invalid Google login state',
      );
    }

    try {
      const result = await this.authService.loginWithGoogleAuthCode(
        code,
        this.getSessionContext(request),
      );

      if (this.isTwoFactorChallenge(result)) {
        this.setTwoFactorChallengeCookie(response, result.twoFactorToken);
        return this.redirectToWeb(response, '2fa');
      }

      // successful login; send token back via query param for frontend to consume
      const successUrl = this.buildWebOauthCallbackUrl();
      // redirect back to the sign‑in page with the token so frontend can pick it up
      successUrl.searchParams.set('token', result.accessToken);
      return response.redirect(successUrl.toString());
    } catch {
      return this.redirectToWeb(response, 'error', 'Google login failed');
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

  private toAuthResponse(result: AuthSession): {
    accessToken: string;
    expiresIn: number;
    session: { sid: string };
    user: { id: string; email: string; fullName: string | null };
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
    fullName: string | null;
  } {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
    };
  }

  private redirectToWeb(
    response: Response,
    status: 'success' | 'error' | '2fa',
    message?: string,
  ) {
    const url = this.buildWebOauthCallbackUrl();
    url.searchParams.set('google', status);
    if (message) {
      url.searchParams.set('message', message);
    }
    return response.redirect(url.toString());
  }

  private buildWebOauthCallbackUrl(): URL {
    return new URL(this.webAppOauthCallbackUrl);
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
}
