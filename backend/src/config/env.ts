import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  SOCKET_CORS_ORIGIN: z.string().default("http://localhost:8081,http://localhost:5173"),
  PERSISTENCE_MODE: z.enum(["memory", "postgres"]).default("memory"),
  DATABASE_URL: isProduction
    ? z.string().min(1)
    : z.string().min(1).default("postgres://postgres:postgres@localhost:5432/scavenge"),
  JWT_SECRET: isProduction ? z.string().min(1) : z.string().min(1).default("dev-jwt-secret"),
  ADMIN_PASSWORD: isProduction ? z.string().min(1) : z.string().min(1).default("changeme"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  AI_PROVIDER: z.enum(["openai", "anthropic", "mock"]).default("mock")
});

export const env = EnvSchema.parse(process.env);
