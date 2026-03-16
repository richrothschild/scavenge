import { createServer } from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { getPostgresPool } from "./persistence/postgres";
import { RuntimeStateStore } from "./persistence/stateStore";
import { MemoryStateStore, PostgresStateStore } from "./persistence/stateStore";
import { createSocketServer } from "./realtime/socket";
import { createAIJudgeProvider } from "./services/aiJudge";
import { GameEngine, loadSeedConfig, RuntimeSnapshot } from "./services/gameEngine";

const bootstrap = async () => {
  const corsOrigins = env.SOCKET_CORS_ORIGIN.split(",").map((value) => value.trim());
  const seed = loadSeedConfig();
  const store: RuntimeStateStore<RuntimeSnapshot> =
    env.PERSISTENCE_MODE === "postgres"
      ? new PostgresStateStore(getPostgresPool(env.DATABASE_URL))
      : new MemoryStateStore();
  const gameEngine = await GameEngine.create(seed, store);
  const aiJudge = createAIJudgeProvider(env.AI_PROVIDER);
  const app = createApp(corsOrigins, gameEngine, aiJudge, {
    joinWindowMs: env.RATE_LIMIT_JOIN_WINDOW_MS,
    joinMax: env.RATE_LIMIT_JOIN_MAX,
    adminLoginWindowMs: env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS,
    adminLoginMax: env.RATE_LIMIT_ADMIN_LOGIN_MAX,
    scanValidateWindowMs: env.RATE_LIMIT_SCAN_VALIDATE_WINDOW_MS,
    scanValidateMax: env.RATE_LIMIT_SCAN_VALIDATE_MAX,
    submitWindowMs: env.RATE_LIMIT_SUBMIT_WINDOW_MS,
    submitMax: env.RATE_LIMIT_SUBMIT_MAX,
    sabotageTriggerWindowMs: env.RATE_LIMIT_SABOTAGE_TRIGGER_WINDOW_MS,
    sabotageTriggerMax: env.RATE_LIMIT_SABOTAGE_TRIGGER_MAX
  });
  const server = createServer(app);

  const io = createSocketServer(server, corsOrigins, gameEngine);
  app.set("io", io);

  server.listen(env.PORT, () => {
    console.log(`[scavenge-backend] listening on port ${env.PORT} (${env.PERSISTENCE_MODE})`);
  });
};

bootstrap().catch((error) => {
  console.error("[scavenge-backend] failed to start", error);
  process.exit(1);
});
