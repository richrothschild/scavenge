import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { GameEngine } from "../services/gameEngine";

export const createSocketServer = (httpServer: HttpServer, corsOrigins: string[], gameEngine: GameEngine) => {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const session = gameEngine.getSession(token);
    if (session) {
      socket.join(session.teamId);
      socket.emit("team:joined", { teamId: session.teamId, role: session.role });
    }

    socket.emit("game:status_changed", gameEngine.getGameStatus());
  });

  return io;
};
