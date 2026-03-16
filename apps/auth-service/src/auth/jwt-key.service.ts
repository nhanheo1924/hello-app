import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, generateKeyPairSync, type JsonWebKey } from 'crypto';

interface JwksKey {
  kid: string;
  publicKey: string;
}

@Injectable()
export class JwtKeyService {
  private readonly logger = new Logger(JwtKeyService.name);
  private readonly issuer: string;
  private readonly audience: string;
  private readonly activeKid: string;
  private readonly activePrivateKey: string;
  private readonly activePublicKey: string;
  private readonly publicKeys: JwksKey[];

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const isProduction = nodeEnv === 'production';

    this.issuer = this.configService.get<string>(
      'JWT_ISSUER',
      'https://api.nhanctm.site',
    );
    this.audience = this.configService.get<string>('JWT_AUDIENCE', 'ctm-web');
    this.activeKid = this.configService.get<string>(
      'JWT_ACTIVE_KID',
      'ctm-dev-kid-1',
    );

    const configuredPrivateKey = (
      this.configService.get<string>('JWT_ACCESS_PRIVATE_KEY', '') ?? ''
    ).trim();
    const configuredPublicKey = (
      this.configService.get<string>('JWT_ACCESS_PUBLIC_KEY', '') ?? ''
    ).trim();

    if (configuredPrivateKey.length > 0 && configuredPublicKey.length > 0) {
      this.activePrivateKey = this.normalizePem(configuredPrivateKey);
      this.activePublicKey = this.normalizePem(configuredPublicKey);
    } else if (!isProduction) {
      const generated = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      this.activePrivateKey = generated.privateKey;
      this.activePublicKey = generated.publicKey;
      this.logger.warn(
        'JWT keys are missing; using an ephemeral development key pair. Tokens will rotate on restart.',
      );
    } else {
      throw new InternalServerErrorException({
        code: 'CONFIG_INVALID',
        message:
          'Missing JWT_ACCESS_PRIVATE_KEY or JWT_ACCESS_PUBLIC_KEY in production',
      });
    }

    const rawAdditionalKeys = this.configService.get<string>(
      'JWT_PUBLIC_KEYS_JSON',
      '[]',
    );
    const additionalKeys = this.parseAdditionalPublicKeys(rawAdditionalKeys);
    this.publicKeys = [
      {
        kid: this.activeKid,
        publicKey: this.activePublicKey,
      },
      ...additionalKeys.filter((key) => key.kid !== this.activeKid),
    ];
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAudience(): string {
    return this.audience;
  }

  getActiveKid(): string {
    return this.activeKid;
  }

  getActivePrivateKey(): string {
    return this.activePrivateKey;
  }

  getActivePublicKey(): string {
    return this.activePublicKey;
  }

  getJwks(): {
    keys: Array<JsonWebKey & { kid: string; use: 'sig'; alg: 'RS256' }>;
  } {
    return {
      keys: this.publicKeys.map((key) => this.publicKeyToJwk(key)),
    };
  }

  private publicKeyToJwk(
    key: JwksKey,
  ): JsonWebKey & { kid: string; use: 'sig'; alg: 'RS256' } {
    const keyObject = createPublicKey(key.publicKey);
    const jwk = keyObject.export({ format: 'jwk' });
    return {
      ...jwk,
      kid: key.kid,
      use: 'sig',
      alg: 'RS256',
    };
  }

  private parseAdditionalPublicKeys(input: string): JwksKey[] {
    if (!input || input.trim().length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(input) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('JWT_PUBLIC_KEYS_JSON must be an array');
      }

      return parsed.map((item, index) => {
        if (!item || typeof item !== 'object') {
          throw new Error(`Public key entry #${index + 1} must be an object`);
        }

        const key = item as { kid?: unknown; publicKey?: unknown };
        if (typeof key.kid !== 'string' || key.kid.trim().length === 0) {
          throw new Error(`Public key entry #${index + 1} has invalid kid`);
        }
        if (
          typeof key.publicKey !== 'string' ||
          key.publicKey.trim().length === 0
        ) {
          throw new Error(
            `Public key entry #${index + 1} has invalid publicKey`,
          );
        }

        return {
          kid: key.kid.trim(),
          publicKey: this.normalizePem(key.publicKey),
        };
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'JWT_PUBLIC_KEYS_JSON parse error';
      throw new InternalServerErrorException({
        code: 'CONFIG_INVALID',
        message: `Invalid JWT public keys config: ${message}`,
      });
    }
  }

  private normalizePem(value: string): string {
    return value.replace(/\\n/g, '\n').trim();
  }
}
