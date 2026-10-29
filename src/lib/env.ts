import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  STEAM_API_KEY: optional,
  /** Steam Web API base URL; tests point this at e2e/steam-mock.mjs. */
  STEAM_API_URL: z.string().url().default("https://api.steampowered.com"),
  /** Steam store base URL; tests point this at e2e/steam-mock.mjs. */
  STEAM_STORE_URL: z.string().url().default("https://store.steampowered.com"),
  /** Country used for Steam prices. */
  STEAM_STORE_COUNTRY: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("us"),
  DISCORD_CLIENT_ID: optional,
  DISCORD_CLIENT_SECRET: optional,
  DISCORD_BOT_TOKEN: optional,
  /** Application public key for interactions; fetched from Discord when unset. */
  DISCORD_PUBLIC_KEY: optional,
  /** Discord REST API; tests point this at e2e/steam-mock.mjs. */
  DISCORD_API_URL: z.string().url().default("https://discord.com/api/v10"),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  MAIL_FROM: optional,
  IGDB_CLIENT_ID: optional,
  IGDB_CLIENT_SECRET: optional,
  /** IGDB / Twitch endpoints; tests point these at e2e/steam-mock.mjs. */
  IGDB_API_URL: z.string().url().default("https://api.igdb.com/v4"),
  IGDB_TOKEN_URL: z.string().url().default("https://id.twitch.tv/oauth2/token"),
  STEAM_BOT_USERNAME: optional,
  STEAM_BOT_PASSWORD: optional,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
