import assert from "node:assert/strict";
import test from "node:test";
import { loadSeedConfig, normalizeSeedConfig, SeedConfig } from "../src/services/gameEngine";

const baseV2Dataset = {
  schema_version: "2.0.0",
  dataset_type: "scavenger_hunt",
  metadata: {
    name: "Adapter Validation Hunt",
    timezone: "America/Los_Angeles"
  },
  scoring: {
    default_points: 1,
    special_points: {
      "adapter-002": 2
    }
  },
  zones: [
    { zone_id: "zone-a", transport_mode: "walk" },
    { zone_id: "zone-b", transport_mode: "waymo" }
  ],
  clues: [
    { id: "adapter-001", route_order: 1, zone_id: "zone-a", title: "Walk clue", theme: "Theme A", difficulty: "easy" },
    { id: "adapter-002", route_order: 2, zone_id: "zone-b", title: "Ride clue", theme: "Theme B", difficulty: "medium" }
  ]
};

test("normalizeSeedConfig converts schema v2 datasets into runtime format", () => {
  const fallbackSeed = loadSeedConfig();
  const normalized = normalizeSeedConfig(baseV2Dataset, fallbackSeed);

  assert.equal(normalized.game.name, "Adapter Validation Hunt");
  assert.equal(normalized.teams.length, fallbackSeed.teams.length);
  assert.equal(normalized.clues.length, 2);

  assert.equal(normalized.clues[0].order_index, 1);
  assert.equal(normalized.clues[0].transport_mode, "WALK");
  assert.equal(normalized.clues[0].requires_scan, false);
  assert.equal(normalized.clues[0].submission_type, "PHOTO");

  assert.equal(normalized.clues[1].order_index, 2);
  assert.equal(normalized.clues[1].transport_mode, "WAYMO");
  assert.equal(normalized.clues[1].required_flag, true);
  assert.equal(normalized.clues[1].base_points, 200);
});

test("normalizeSeedConfig rejects schema v2 datasets without fallback team credentials", () => {
  const fallbackWithoutTeams = {
    game: { name: "No Teams", status: "PENDING", timezone: "America/Los_Angeles" },
    teams: [],
    clues: []
  } as SeedConfig;

  assert.throws(
    () => normalizeSeedConfig(baseV2Dataset, fallbackWithoutTeams),
    /fallback team credentials/i
  );
});

test("normalizeSeedConfig rejects unknown seed shapes", () => {
  assert.throws(
    () => normalizeSeedConfig({ foo: "bar" }),
    /unsupported seed config format/i
  );
});
