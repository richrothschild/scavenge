import { env } from "../config/env";
import { getPostgresPool } from "../persistence/postgres";

const run = async () => {
  if (env.PERSISTENCE_MODE !== "postgres") {
    throw new Error("Set PERSISTENCE_MODE=postgres to reset runtime state.");
  }

  const pool = getPostgresPool(env.DATABASE_URL);
  const client = await pool.connect();

  try {
    const result = await client.query(
      "DELETE FROM runtime_state WHERE key = $1",
      ["game_runtime_v1"]
    );
    console.log(`[reset-state] deleted ${result.rowCount} runtime_state row(s) — next backend restart will re-seed from seed-config.json`);
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error("[reset-state] failed", error);
  process.exit(1);
});
