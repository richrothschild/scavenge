import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  SOCKET_CORS_ORIGIN: z.string().default("http://localhost:8081,http://localhost:5173"),
  PERSISTENCE_MODE: z.enum(["memory", "postgres"]).default("memory"),
  SEED_VARIANT: z.enum(["production", "test"]).default("production"),
  DATABASE_URL: isProduction
    ? z.string().min(1)
    : z.string().min(1).default("postgres://postgres:postgres@localhost:5432/scavenge"),
  JWT_SECRET: isProduction ? z.string().min(1) : z.string().min(1).default("dev-jwt-secret"),
  ADMIN_PASSWORD: isProduction ? z.string().min(1) : z.string().min(1).default("changeme"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  AI_PROVIDER: z.enum(["openai", "anthropic", "mock"]).default("mock"),
  RATE_LIMIT_JOIN_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  RATE_LIMIT_JOIN_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(600000),
  RATE_LIMIT_ADMIN_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_SCAN_VALIDATE_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_SCAN_VALIDATE_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_SUBMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  RATE_LIMIT_SUBMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_SABOTAGE_TRIGGER_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  RATE_LIMIT_SABOTAGE_TRIGGER_MAX: z.coerce.number().int().positive().default(6)
});

export const env = EnvSchema.parse(process.env);
