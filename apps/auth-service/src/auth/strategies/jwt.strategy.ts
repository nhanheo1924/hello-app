import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { JwtKeyService } from '../jwt-key.service';

interface AccessTokenPayload {
  sub: string;
  email: string;
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly jwtKeyService: JwtKeyService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtKeyService.getActivePublicKey(),
      algorithms: ['RS256'],
      issuer: jwtKeyService.getIssuer(),
      audience: jwtKeyService.getAudience(),
    });
  }

  validate(payload: AccessTokenPayload): JwtUser {
    if (!payload.sub || !payload.email || !payload.sid) {
      throw new UnauthorizedException('Invalid access token');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      sid: payload.sid,
    };
  }
}
