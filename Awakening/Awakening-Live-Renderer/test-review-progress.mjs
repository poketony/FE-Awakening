import assert from "node:assert/strict";
import {
  emptyProgress, registerFile, setReviewStatus, getReviewStatus,
  fileProgress, mergeProgress, serializeProgress,
} from "./review-progress-core.js";

const progress = emptyProgress();
registerFile(progress, {
  path: "Awakening/Messages (K)/クロム_スミア.txt",
  mode: "main",
  expected: ["MID_支援_クロム_スミア_Ｃ", "MID_支援_クロム_スミア_Ｂ"],
});
setReviewStatus(progress, {
  path: "Awakening/Messages (K)/クロム_スミア.txt",
  entryKey: "MID_支援_クロム_スミア_Ｃ",
  status: "approved",
  at: "2026-09-06T00:00:00.000Z",
});
assert.equal(getReviewStatus(progress, "awakening/messages (k)/クロム_スミア.txt", "MID_支援_クロム_スミア_Ｃ"), "approved");
assert.equal(fileProgress(progress, "Awakening/Messages (K)/クロム_スミア.txt").state, "progress");

const remote = emptyProgress();
setReviewStatus(remote, {
  path: "Awakening/Messages (K)/クロム_スミア.txt",
  entryKey: "MID_支援_クロム_スミア_Ｃ",
  status: "needs_fix",
  at: "2026-09-06T01:00:00.000Z",
});
const merged = mergeProgress(progress, remote);
assert.equal(getReviewStatus(merged, "Awakening/Messages (K)/クロム_スミア.txt", "MID_支援_クロム_スミア_Ｃ"), "needs_fix");
assert.ok(serializeProgress(merged).includes('"version": 2'));
console.log("review progress tests passed");
