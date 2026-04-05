import * as Joi from "joi";

const devDefaultProxySecret = "dev-internal-proxy-secret-0123456789ab";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  APP_HOST: Joi.string().default("0.0.0.0"),
  APP_PORT: Joi.number().port().default(3001),
  APP_PREFIX: Joi.string().default("api/v1"),
  CORS_ORIGIN: Joi.string().allow("").default("http://localhost:5173"),
  CORS_ALLOW_VERCEL_PREVIEW: Joi.boolean()
    .truthy("true")
    .truthy("1")
    .falsy("false")
    .falsy("0")
    .default(true),
  AUTH_SERVICE_BASE_URL: Joi.string()
    .uri()
    .default("http://localhost:3000/api/auth"),
  TASK_SERVICE_BASE_URL: Joi.string()
    .uri()
    .default("http://localhost:3002/api"),
  AUTH_ACCESS_COOKIE_NAME: Joi.string().default("ctm_at"),
  AUTH_REFRESH_COOKIE_NAME: Joi.string().default("ctm_rt"),
  AUTH_ACCESS_COOKIE_DOMAIN: Joi.string()
    .allow("")
    .pattern(/^\./)
    .default(""),
  AUTH_ACCESS_COOKIE_SAMESITE: Joi.string()
    .valid("strict", "lax", "none")
    .when("NODE_ENV", {
      is: "production",
      then: Joi.string().valid("strict", "lax", "none").default("none"),
      otherwise: Joi.string().default("lax"),
    }),
  INTERNAL_PROXY_SECRET: Joi.string()
    .min(32)
    .when("NODE_ENV", {
      is: "production",
      then: Joi.required(),
      otherwise: Joi.string().min(32).default(devDefaultProxySecret),
    }),
  UPSTREAM_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120000)
    .default(15000),
  AUTH_CRITICAL_UPSTREAM_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120000)
    .default(25000),
  UPSTREAM_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  UPSTREAM_RETRY_DELAY_MS: Joi.number()
    .integer()
    .min(50)
    .max(10000)
    .default(400),
});
