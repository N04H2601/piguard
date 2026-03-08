import { z } from 'zod';

const envSchema = z.object({
  ADMIN_USER: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('changeme'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
  JWT_SECRET: z.string().default(''),
  JWT_EXPIRY: z.string().default('24h'),
  PORT: z.coerce.number().default(3333),
  NODE_ENV: z.enum(['development', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DB_PATH: z.string().default('./data/piguard.db'),
  GEOIP_PATH: z.string().default('./data/geoip/GeoLite2-Country.mmdb'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_TO: z.string().optional(),
  SMTP_TLS: z.enum(['true', 'false']).optional(),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.4'),
  DEFAULT_HEALTH_CHECKS: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Configuration errors:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  config = result.data;
  return config;
}

export function getConfig(): Config {
  if (!config) throw new Error('Config not loaded. Call loadConfig() first.');
  return config;
}

export function isCookieSecure(req?: { protocol?: string }): boolean {
  const setting = getConfig().COOKIE_SECURE;
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  // auto: detect from request protocol (respects trust proxy / X-Forwarded-Proto)
  return req?.protocol === 'https';
}

export function getTrustProxyConfig(): boolean | number | string {
  const value = getConfig().TRUST_PROXY.trim();
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
