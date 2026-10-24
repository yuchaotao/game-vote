import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  SESSION_SECRET: "x".repeat(32),
};

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.SMTP_PORT).toBe(587);
  });

  it("treats empty optional values as undefined", () => {
    expect(parseEnv({ ...base, STEAM_API_KEY: "" }).STEAM_API_KEY).toBeUndefined();
  });

  it("rejects a short session secret", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a missing database url", () => {
    expect(() => parseEnv({ SESSION_SECRET: base.SESSION_SECRET })).toThrow(/DATABASE_URL/);
  });
});
