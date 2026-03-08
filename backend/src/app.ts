import cors from "cors";
import express from "express";
import { GameEngine } from "./services/gameEngine";
import { AIJudgeProvider } from "./services/aiJudge";
import { gameRouter } from "./routes/game";
import { healthRouter } from "./routes/health";

export const createApp = (corsOrigins: string[], gameEngine: GameEngine, aiJudge: AIJudgeProvider) => {
  const app = express();
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "15mb" }));

  app.use("/api", healthRouter);
  app.use("/api", gameRouter(gameEngine, aiJudge));

  return app;
};
