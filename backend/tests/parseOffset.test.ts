import assert from "node:assert/strict";
import test from "node:test";
import { parseOffset } from "../src/utils/parseOffset";

test("parseOffset uses default when value is not a string", () => {
  assert.equal(parseOffset(undefined, 3, 20), 3);
  assert.equal(parseOffset(1 as unknown, 3, 20), 3);
});

test("parseOffset uses default for invalid and negative values", () => {
  assert.equal(parseOffset("nope", 3, 20), 3);
  assert.equal(parseOffset("-1", 3, 20), 3);
});

test("parseOffset truncates decimals and clamps max", () => {
  assert.equal(parseOffset("4.9", 3, 20), 4);
  assert.equal(parseOffset("999", 3, 20), 20);
});
