import assert from "node:assert/strict";
import { test } from "node:test";
import { partialString } from "../src/partial-json.js";

test("reads a string field as it grows", () => {
  assert.equal(partialString('{"pro', "prompt"), "");
  assert.equal(partialString('{"prompt":"Write a one', "prompt"), "Write a one");
  assert.equal(partialString('{"prompt": "Write a one-page summary.", "techniques": [', "prompt"), "Write a one-page summary.");
});

test("decodes escapes, and waits when one is cut in half", () => {
  assert.equal(partialString('{"prompt":"line one\\nline \\"two\\"', "prompt"), 'line one\nline "two"');
  assert.equal(partialString('{"prompt":"a\\', "prompt"), "a");
  assert.equal(partialString('{"prompt":"caf\\u00e9 \\u00', "prompt"), "café ");
});

test("ignores the same text in another field", () => {
  assert.equal(partialString('{"reader":"ai","techniques":[{"id":"x","evidence":"prompt"}],"prompt":"hi"}', "prompt"), "hi");
});
