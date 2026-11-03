// Scope (Bryce, 2026-11-02): AI chat sites only. Not Gmail, Docs or a search bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.location = { hostname: "example.com" };
const { CHAT_URLS, HOSTS, followsFocus } = await import("../src/hosts.js");

// A Chrome match pattern's host, turned into a sample hostname.
const sample = (pattern) => new URL(pattern.replace("*.", "www.").replace(/\*$/, "")).hostname;

test("every match pattern is https, names a host, and is no catch-all", () => {
  for (const url of CHAT_URLS) {
    assert.match(url, /^https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]+\/.*\*$/, url);
    assert.ok(!/^https:\/\/\*\//.test(url), `${url} would match every site`);
  }
});

test("each site's regexp recognises the host its own patterns name", () => {
  for (const host of HOSTS) for (const url of host.urls) assert.ok(host.match.test(sample(url)), `${host.id}: ${url}`);
});

test("mail, docs and search are out of scope", () => {
  for (const name of ["mail.google.com", "docs.google.com", "www.google.com", "drive.google.com", "github.com", "slack.com", "outlook.office.com", "x.com"])
    assert.equal(HOSTS.find((h) => h.match.test(name)), undefined, name);
});

test("the sites we know best use selectors; the rest follow the focused box", () => {
  const by = Object.fromEntries(HOSTS.map((h) => [h.id, h]));
  for (const id of ["claude", "chatgpt", "gemini"]) assert.ok(!followsFocus(by[id]), id);
  assert.ok(followsFocus(by.perplexity));
});

test("the built manifest runs the content script on exactly the chat sites", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync("node", ["build.mjs"], { stdio: "ignore" });
  const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
  assert.deepEqual(manifest.content_scripts[0].matches, CHAT_URLS);
  assert.ok(manifest.web_accessible_resources[0].matches.every((m) => /^https:\/\/[^/]+\/\*$/.test(m)), "fonts: whole origins only");
});
