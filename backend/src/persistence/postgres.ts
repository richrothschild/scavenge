import { Pool } from "pg";

let sharedPool: Pool | null = null;

export const getPostgresPool = (databaseUrl: string) => {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: databaseUrl });
  }
  return sharedPool;
};
