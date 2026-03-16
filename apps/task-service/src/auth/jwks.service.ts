import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

@Injectable()
export class JwksService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks;

  constructor(private readonly configService: ConfigService) {
    this.issuer = this.configService.get<string>(
      "JWT_ISSUER",
      "https://api.nhanctm.site",
    );
    this.audience = this.configService.get<string>("JWT_AUDIENCE", "ctm-web");
    const jwksUrl = this.configService.get<string>(
      "AUTH_JWKS_URL",
      "http://localhost:3000/.well-known/jwks.json",
    );
    this.jwks = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 15 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5000,
    });
  }

  async verifyAccessToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["RS256"],
    });

    return payload;
  }
}
