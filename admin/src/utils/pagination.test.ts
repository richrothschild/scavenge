import assert from "node:assert/strict";
import test from "node:test";
import { derivePaginationState, parseLimitInput, parseOffsetInput } from "./pagination";

test("parseLimitInput falls back for invalid and non-positive values", () => {
  assert.equal(parseLimitInput("", 50), 50);
  assert.equal(parseLimitInput("abc", 50), 50);
  assert.equal(parseLimitInput("0", 50), 50);
  assert.equal(parseLimitInput("-2", 50), 50);
});

test("parseLimitInput truncates and clamps", () => {
  assert.equal(parseLimitInput("12.9", 10), 12);
  assert.equal(parseLimitInput("999", 10, 100), 100);
});

test("parseOffsetInput falls back for invalid and negative values", () => {
  assert.equal(parseOffsetInput("", 0), 0);
  assert.equal(parseOffsetInput("xyz", 3), 3);
  assert.equal(parseOffsetInput("-1", 0), 0);
});

test("parseOffsetInput truncates and clamps", () => {
  assert.equal(parseOffsetInput("5.7", 0), 5);
  assert.equal(parseOffsetInput("20000", 0, 10000), 10000);
});

test("derivePaginationState returns empty-state metadata", () => {
  const result = derivePaginationState(0, 25, 0);
  assert.equal(result.currentPage, 0);
  assert.equal(result.totalPages, 0);
  assert.equal(result.canPrev, false);
  assert.equal(result.canNext, false);
});

test("derivePaginationState computes page and bounds", () => {
  const first = derivePaginationState(0, 10, 21);
  assert.equal(first.currentPage, 1);
  assert.equal(first.totalPages, 3);
  assert.equal(first.canPrev, false);
  assert.equal(first.canNext, true);

  const middle = derivePaginationState(10, 10, 21);
  assert.equal(middle.currentPage, 2);
  assert.equal(middle.totalPages, 3);
  assert.equal(middle.canPrev, true);
  assert.equal(middle.canNext, true);

  const last = derivePaginationState(20, 10, 21);
  assert.equal(last.currentPage, 3);
  assert.equal(last.totalPages, 3);
  assert.equal(last.canPrev, true);
  assert.equal(last.canNext, false);
});
