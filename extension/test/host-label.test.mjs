// The Mac app (Swift) cannot import hosts.js, so this test keeps the phrase in
// desktop/Sources/POCCore/HostLabel.swift the same as the extension's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_CHAT, chatSiteLabel } from "../src/hosts.js";

test("HostLabel.swift uses the extension's AI-chat phrase", () => {
  const swift = readFileSync(new URL("../../desktop/Sources/POCCore/HostLabel.swift", import.meta.url), "utf8");
  assert.ok(swift.includes(`, ${AI_CHAT} app`), `HostLabel.swift must contain ", ${AI_CHAT} app"`);
});

test("the site label keeps its wording", () => {
  assert.equal(chatSiteLabel("Claude"), "Claude, an AI chat site");
});
