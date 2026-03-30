import * as Joi from "joi";

const devDefaultDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5433/ctm-auth-service?schema=task";
const devDefaultProxySecret = "dev-internal-proxy-secret-0123456789ab";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  APP_HOST: Joi.string().default("0.0.0.0"),
  APP_PORT: Joi.number().port().default(3102),
  APP_PREFIX: Joi.string().default("api"),
  CORS_ORIGIN: Joi.string().allow("").default("http://localhost:5173"),
  DATABASE_URL: Joi.string().when("NODE_ENV", {
    is: "production",
    then: Joi.required(),
    otherwise: Joi.string().default(devDefaultDatabaseUrl),
  }),
  JWT_ISSUER: Joi.string().uri().default("http://localhost:3000"),
  JWT_AUDIENCE: Joi.string().default("ctm-web"),
  AUTH_SERVICE_BASE_URL: Joi.string()
    .uri()
    .default("http://localhost:3000/api/auth"),
  AUTH_SERVICE_INTERNAL_BASE_URL: Joi.string()
    .uri()
    .default("http://localhost:3000/api/internal"),
  AUTH_JWKS_URL: Joi.string()
    .uri()
    .default("http://localhost:3000/.well-known/jwks.json"),
  INTERNAL_PROXY_SECRET: Joi.string()
    .min(32)
    .when("NODE_ENV", {
      is: "production",
      then: Joi.required(),
      otherwise: Joi.string().min(32).default(devDefaultProxySecret),
    }),
});
