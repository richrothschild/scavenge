import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { getPostgresPool } from "./persistence/postgres";
import { RuntimeStateStore } from "./persistence/stateStore";
import { MemoryStateStore, PostgresStateStore } from "./persistence/stateStore";
import { createSocketServer } from "./realtime/socket";
import { createAIJudgeProvider } from "./services/aiJudge";
import { GameEngine, RuntimeSnapshot, loadSeedConfigVariant } from "./services/gameEngine";

const bootstrap = async () => {
  const corsOrigins = env.SOCKET_CORS_ORIGIN.split(",").map((value) => value.trim());
  const loadedSeed = loadSeedConfigVariant(env.SEED_VARIANT);
  const seed = loadedSeed.seed;
  const store: RuntimeStateStore<RuntimeSnapshot> =
    env.PERSISTENCE_MODE === "postgres"
      ? new PostgresStateStore(getPostgresPool(env.DATABASE_URL))
      : new MemoryStateStore();
  const gameEngine = await GameEngine.create(seed, store, env.SEED_VARIANT);
  const aiJudge = createAIJudgeProvider(env.AI_PROVIDER, env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const app = createApp(corsOrigins, gameEngine, aiJudge, {
    joinWindowMs: env.RATE_LIMIT_JOIN_WINDOW_MS,
    joinMax: env.RATE_LIMIT_JOIN_MAX,
    adminLoginWindowMs: env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS,
    adminLoginMax: env.RATE_LIMIT_ADMIN_LOGIN_MAX,
    scanValidateWindowMs: env.RATE_LIMIT_SCAN_VALIDATE_WINDOW_MS,
    scanValidateMax: env.RATE_LIMIT_SCAN_VALIDATE_MAX,
    submitWindowMs: env.RATE_LIMIT_SUBMIT_WINDOW_MS,
    submitMax: env.RATE_LIMIT_SUBMIT_MAX
  });
  const server = createServer(app);

  const io = createSocketServer(server, corsOrigins, gameEngine);
  app.set("io", io);

  server.listen(env.PORT, () => {
    console.log(
      `[scavenge-backend] listening on port ${env.PORT} (${env.PERSISTENCE_MODE}) seed=${env.SEED_VARIANT} source=${loadedSeed.sourceFile}`
    );
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

bootstrap().catch((error) => {
  console.error("[scavenge-backend] failed to start", error);
  process.exit(1);
});
