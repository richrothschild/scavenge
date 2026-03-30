import crypto from "crypto";
import { env } from "../config/env";
import { getPostgresPool } from "../persistence/postgres";
import { loadSeedConfig } from "../services/gameEngine";

const run = async () => {
  if (env.PERSISTENCE_MODE !== "postgres") {
    throw new Error("Set PERSISTENCE_MODE=postgres to run database seed.");
  }

  const seed = loadSeedConfig();
  const pool = getPostgresPool(env.DATABASE_URL);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM submissions");
    await client.query("DELETE FROM team_clue_states");
    await client.query("DELETE FROM clues");
    await client.query("DELETE FROM participants");
    await client.query("DELETE FROM teams");
    await client.query("DELETE FROM games");

    const gameId = crypto.randomUUID();
    await client.query(
      `INSERT INTO games (id, name, start_time, end_time, timezone, status, admin_password_hash)
       VALUES ($1, $2, NOW(), NULL, $3, $4, $5)`,
      [gameId, seed.game.name, seed.game.timezone, seed.game.status, "seed-placeholder"]
    );

    const clueIdsByOrder = new Map<number, string>();
    for (const clue of seed.clues) {
      const clueId = crypto.randomUUID();
      clueIdsByOrder.set(clue.order_index, clueId);
      await client.query(
        `INSERT INTO clues (
          id, order_index, title, instructions, required_flag, transport_mode,
          requires_scan, submission_type, ai_rubric, base_points, qr_public_id, lock_after_advance
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          clueId,
          clue.order_index,
          clue.title,
          clue.instructions,
          clue.required_flag,
          clue.transport_mode,
          clue.requires_scan,
          clue.submission_type,
          clue.ai_rubric,
          clue.base_points,
          clue.qr_public_id,
          true
        ]
      );
    }

    for (const team of seed.teams) {
      const teamId = crypto.randomUUID();
      await client.query(
        `INSERT INTO teams (
          id, game_id, name, join_code, captain_name, captain_pin_hash,
          score_total, current_clue_index, completed_count,
          skipped_count, eligibility_status
        ) VALUES ($1,$2,$3,$4,$5,$6,0,0,0,0,'INELIGIBLE')`,
        [teamId, gameId, team.name, team.join_code, team.captain_name, team.captain_pin]
      );

      for (const clue of seed.clues) {
        const clueId = clueIdsByOrder.get(clue.order_index);
        if (!clueId) continue;
        await client.query(
          `INSERT INTO team_clue_states (id, team_id, clue_id, status, scan_validated, submissions_count, points_awarded)
           VALUES ($1,$2,$3,$4,false,0,0)`,
          [crypto.randomUUID(), teamId, clueId, clue.order_index === 1 ? "ACTIVE" : "LOCKED"]
        );
      }
    }

    await client.query("COMMIT");
    console.log("[seed] completed successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error("[seed] failed", error);
  process.exit(1);
});
