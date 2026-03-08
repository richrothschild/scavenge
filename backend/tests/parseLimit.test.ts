import assert from "node:assert/strict";
import test from "node:test";
import { parseLimit } from "../src/utils/parseLimit";

test("parseLimit uses default when value is not a string", () => {
  assert.equal(parseLimit(undefined, 25, 100), 25);
  assert.equal(parseLimit(10 as unknown, 25, 100), 25);
});

test("parseLimit uses default when value is invalid or non-positive", () => {
  assert.equal(parseLimit("not-a-number", 25, 100), 25);
  assert.equal(parseLimit("0", 25, 100), 25);
  assert.equal(parseLimit("-2", 25, 100), 25);
});

test("parseLimit truncates decimals and clamps to max", () => {
  assert.equal(parseLimit("12.9", 25, 100), 12);
  assert.equal(parseLimit("5000", 25, 100), 100);
});
