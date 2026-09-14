import assert from "node:assert/strict";
import test from "node:test";
import { mergeOrder, moveItem } from "../chrome/zen-sidecar-order.mjs";

test("hidden tools and unavailable extensions retain their positions", () => {
  const saved = ["history", "notes@example.org", "bookmarks", "aichat"];
  const available = ["aichat", "history", "bookmarks"];
  assert.deepEqual(mergeOrder(saved, available), saved);
  assert.deepEqual(
    mergeOrder(saved, [...available, "notes@example.org", "new@example.org"]),
    [...saved, "new@example.org"],
  );
});

test("moving across a hidden tool preserves every other item's relative order", () => {
  const saved = ["history", "hidden@example.org", "bookmarks", "aichat"];
  const moved = moveItem(saved, "aichat", "history", false);
  assert.deepEqual(moved, [
    "aichat",
    "history",
    "hidden@example.org",
    "bookmarks",
  ]);
  assert.deepEqual(moveItem(moved, "history", "bookmarks", true), [
    "aichat",
    "hidden@example.org",
    "bookmarks",
    "history",
  ]);
  assert.deepEqual(saved, [
    "history",
    "hidden@example.org",
    "bookmarks",
    "aichat",
  ]);
});

test("a stale or self drop cannot remove or insert a tool", () => {
  const saved = ["history", "bookmarks"];
  assert.deepEqual(
    moveItem(saved, "uninstalled@example.org", "history", false),
    saved,
  );
  assert.deepEqual(
    moveItem(saved, "history", "uninstalled@example.org", true),
    saved,
  );
  assert.deepEqual(moveItem(saved, "history", "history", true), saved);
});
