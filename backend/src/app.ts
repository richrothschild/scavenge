import cors from "cors";
import express from "express";
import helmet from "helmet";
import { GameEngine } from "./services/gameEngine";
import { AIJudgeProvider } from "./services/aiJudge";
import { gameRouter } from "./routes/game";
import { healthRouter } from "./routes/health";
import { createTop100Router } from "./routes/top100";
import { createQuizRouter } from "./routes/quiz";

export type AuthRateLimitConfig = {
  joinWindowMs: number;
  joinMax: number;
  adminLoginWindowMs: number;
  adminLoginMax: number;
  scanValidateWindowMs: number;
  scanValidateMax: number;
  submitWindowMs: number;
  submitMax: number;
};

type RateLimitRule = {
  key: string;
  method: "POST";
  path: string;
  windowMs: number;
  max: number;
  message: string;
  keyStrategy: "ip" | "auth-token-or-ip";
};

type RateLimitEntry = {
  windowStartMs: number;
  hits: number;
};

const getClientAddress = (request: express.Request): string => {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  return request.ip || "unknown";
};

const getAuthToken = (request: express.Request): string | null => {
  const tokenHeader = request.headers["x-auth-token"];
  if (typeof tokenHeader === "string" && tokenHeader.trim().length > 0) {
    return tokenHeader.trim();
  }

  return null;
};

const createAuthRateLimiter = (config: AuthRateLimitConfig): express.RequestHandler => {
  const buckets = new Map<string, RateLimitEntry>();
  const rules: RateLimitRule[] = [
    {
      key: "join",
      method: "POST",
      path: "/auth/join",
      windowMs: config.joinWindowMs,
      max: config.joinMax,
      message: "Too many join attempts. Please try again shortly.",
      keyStrategy: "ip"
    },
    {
      key: "admin-login",
      method: "POST",
      path: "/auth/admin/login",
      windowMs: config.adminLoginWindowMs,
      max: config.adminLoginMax,
      message: "Too many admin login attempts. Please wait before retrying.",
      keyStrategy: "ip"
    },
    {
      key: "scan-validate",
      method: "POST",
      path: "/team/me/scan-validate",
      windowMs: config.scanValidateWindowMs,
      max: config.scanValidateMax,
      message: "Too many scan validations. Please wait before retrying.",
      keyStrategy: "auth-token-or-ip"
    },
    {
      key: "submit",
      method: "POST",
      path: "/team/me/submit",
      windowMs: config.submitWindowMs,
      max: config.submitMax,
      message: "Too many submissions. Please wait before retrying.",
      keyStrategy: "auth-token-or-ip"
    }
  ];

  const maxWindowMs = Math.max(...rules.map((rule) => rule.windowMs));

  return (request, response, next) => {
    const rule = rules.find((candidate) => candidate.method === request.method && candidate.path === request.path);
    if (!rule) return next();

    const now = Date.now();

    for (const [bucketKey, entry] of buckets.entries()) {
      if (now - entry.windowStartMs > maxWindowMs) {
        buckets.delete(bucketKey);
      }
    }

    const clientAddress = getClientAddress(request);
    const authToken = getAuthToken(request);
    const identity = rule.keyStrategy === "auth-token-or-ip" && authToken
      ? `token:${authToken}`
      : `ip:${clientAddress}`;
    const bucketKey = `${rule.key}:${identity}`;
    const existing = buckets.get(bucketKey);
    const active = !existing || now - existing.windowStartMs >= rule.windowMs
      ? { windowStartMs: now, hits: 0 }
      : existing;

    if (active.hits >= rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - active.windowStartMs)) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      return response.status(429).json({ error: rule.message });
    }

    active.hits += 1;
    buckets.set(bucketKey, active);
    return next();
  };
};

const defaultAuthRateLimitConfig: AuthRateLimitConfig = {
  joinWindowMs: 5 * 60 * 1000,
  joinMax: 30,
  adminLoginWindowMs: 10 * 60 * 1000,
  adminLoginMax: 10,
  scanValidateWindowMs: 60 * 1000,
  scanValidateMax: 20,
  submitWindowMs: 5 * 60 * 1000,
  submitMax: 10
};

export const createApp = (
  corsOrigins: string[],
  gameEngine: GameEngine,
  aiJudge: AIJudgeProvider,
  authRateLimitConfig: AuthRateLimitConfig = defaultAuthRateLimitConfig,
  openaiApiKey?: string,
  openaiModel: string = "gpt-4o"
) => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use("/api", createAuthRateLimiter(authRateLimitConfig));
  app.use(express.json({ limit: "15mb" }));

  app.use("/api", healthRouter);
  app.use("/api", gameRouter(gameEngine, aiJudge));
  app.use("/api", createTop100Router(openaiApiKey, openaiModel));
  app.use("/api", createQuizRouter(openaiApiKey, openaiModel));

  // Global error handler — catches JSON parse errors and any next(err) calls
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { status?: number; statusCode?: number }).statusCode
      ?? 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    if (status >= 500) {
      console.error("[error]", err);
    }
    res.status(status).json({ error: message });
  });

  return app;
};
