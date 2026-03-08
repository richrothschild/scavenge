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
  const app = createApp(corsOrigins, gameEngine, aiJudge);
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
