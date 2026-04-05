import * as Joi from 'joi';

const devDefaultDatabaseUrl =
  'postgresql://postgres:postgres@localhost:5433/ctm-auth-service?schema=public';
const devDefaultProxySecret = 'dev-internal-proxy-secret-0123456789ab';
const devDefaultRedisUrl = 'redis://localhost:6379';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  APP_HOST: Joi.string().default('0.0.0.0'),
  APP_PORT: Joi.number().port().default(3000),
  APP_PREFIX: Joi.string().default('api'),
  CORS_ORIGIN: Joi.string().allow('').default('http://localhost:5173'),
  DATABASE_URL: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default(devDefaultDatabaseUrl),
  }),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().default(devDefaultRedisUrl),
    }),
  // frontend assumes 60-minute tokens; default accordingly
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('60m'),
  REFRESH_TOKEN_EXPIRES_IN: Joi.string().default('3d'),
  AUTH_REFRESH_COOKIE_NAME: Joi.string().default('ctm_rt'),
  JWT_ISSUER: Joi.string().uri().default('http://localhost:3000'),
  JWT_AUDIENCE: Joi.string().default('ctm-web'),
  JWT_ACTIVE_KID: Joi.string()
    .min(3)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().min(3).default('ctm-dev-kid-1'),
    }),
  JWT_ACCESS_PRIVATE_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(128).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  JWT_ACCESS_PUBLIC_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(64).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  JWT_PUBLIC_KEYS_JSON: Joi.string().default('[]'),
  TWO_FACTOR_CHALLENGE_EXPIRES_IN: Joi.string().default('5m'),
  TOTP_ISSUER: Joi.string().default('CTM Auth'),
  TOTP_ENCRYPTION_SECRET: Joi.string().allow('').default(''),
  INTERNAL_PROXY_SECRET: Joi.string()
    .min(32)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().min(32).default(devDefaultProxySecret),
    }),
  TASK_SERVICE_INTERNAL_BASE_URL: Joi.string()
    .uri()
    .default('http://localhost:3002/api/internal'),
  AUTH_PUBLIC_BASE_PATH: Joi.string().default('/api/v1/auth'),
  WEB_APP_URL: Joi.string().uri().default('http://localhost:5173'),
  WEB_APP_OAUTH_CALLBACK_URL: Joi.string()
    .uri()
    .default('http://localhost:5173/auth/callback/'),
  OAUTH_EXCHANGE_CODE_EXPIRES_IN: Joi.string().default('60s'),
  GOOGLE_OAUTH_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_OAUTH_REDIRECT_URI: Joi.string().allow('').default(''),
  RESEND_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  RESEND_FROM: Joi.string().default('auth@nhanctm.site'),
  EMAIL_OTP_TTL_SECONDS: Joi.number().integer().min(60).default(300),
  EMAIL_OTP_RATE_LIMIT_SECONDS: Joi.number().integer().min(1).default(60),
  EMAIL_OTP_VERIFICATION_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .default(600),
});
