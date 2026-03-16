import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { getPostgresPool } from "../persistence/postgres";

const MIGRATION_DIR = path.resolve(__dirname, "../../migrations");

const run = async () => {
  if (env.PERSISTENCE_MODE !== "postgres") {
    throw new Error("Set PERSISTENCE_MODE=postgres to run migrations.");
  }

  const pool = getPostgresPool(env.DATABASE_URL);
  const client = await pool.connect();

  try {
    const files = fs
      .readdirSync(MIGRATION_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    console.log(`[migrate] found ${files.length} migration file(s): ${files.join(", ")}`);

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
      console.log(`[migrate] running ${file} …`);
      await client.query(sql);
      console.log(`[migrate] ${file} done`);
    }

    console.log("[migrate] all migrations completed");
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error("[migrate] failed", error);
  process.exit(1);
});
