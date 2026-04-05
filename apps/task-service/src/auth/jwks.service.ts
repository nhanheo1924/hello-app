import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

@Injectable()
export class JwksService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly resolver: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly configService: ConfigService) {
    this.issuer = this.normalizeIssuer(
      this.configService.get<string>("JWT_ISSUER", "http://localhost:3000"),
    );
    this.audience = this.configService.get<string>("JWT_AUDIENCE", "ctm-web");

    const jwksUrl = this.configService.get<string>(
      "AUTH_JWKS_URL",
      "http://localhost:3000/.well-known/jwks.json",
    );
    this.resolver = createRemoteJWKSet(new URL(jwksUrl), {
      cacheMaxAge: 15 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5000,
    });
  }

  async verifyAccessToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.resolver, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["RS256"],
      clockTolerance: 5,
    });

    return payload;
  }

  private normalizeIssuer(value: string): string {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "");
  }
}
