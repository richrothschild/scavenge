import { Pool } from "pg";

export interface RuntimeStateStore<TState> {
  load(): Promise<TState | null>;
  save(state: TState): Promise<void>;
}

export class MemoryStateStore<TState> implements RuntimeStateStore<TState> {
  private state: TState | null = null;

  async load() {
    return this.state;
  }

  async save(state: TState) {
    this.state = state;
  }
}

export class PostgresStateStore<TState> implements RuntimeStateStore<TState> {
  private readonly key = "game_runtime_v1";

  constructor(private readonly pool: Pool) {}

  async load() {
    const result = await this.pool.query<{ payload: TState }>(
      "SELECT payload FROM runtime_state WHERE key = $1 LIMIT 1",
      [this.key]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0].payload;
  }

  async save(state: TState) {
    await this.pool.query(
      `INSERT INTO runtime_state (key, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [this.key, JSON.stringify(state)]
    );
  }
}
