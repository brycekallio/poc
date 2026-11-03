import assert from "node:assert/strict";
import { test } from "node:test";

// writeBack drives the DOM, and this repo has no DOM library, so these tests
// stand up just enough of one to play the part of different editors. The same
// code was also run in real Chrome against ProseMirror, a React textarea, a
// Quill editor and gemini.google.com (see BUILD-log.md, 2026-11-02).

class FakeTextarea { constructor() { this.value_ = ""; this.listeners = []; this.isConnected = true; this.rects = 1; }
  getClientRects() { return { length: this.rects }; }
  focus() {} dispatchEvent(e) { this.events.push(e.type); return true; } get events() { return (this._e ??= []); } }
Object.defineProperty(FakeTextarea.prototype, "value", { get() { return this.value_; }, set(v) { this.value_ = v; }, configurable: true });
globalThis.HTMLTextAreaElement = FakeTextarea;
globalThis.HTMLInputElement = class {};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.InputEvent = class extends Event { constructor(type, init) { super(type); Object.assign(this, init); } };
globalThis.ClipboardEvent = class extends Event { constructor(type, init) { super(type); Object.assign(this, init); } };
globalThis.DataTransfer = class { constructor() { this.d = {}; } setData(k, v) { this.d[k] = v; } getData(k) { return this.d[k]; } };

// A contenteditable. `behaviour` decides which input path the "editor" honours.
function editor({ via, delay = 0, hidden = false }) {
  const el = {
    isConnected: true, innerText: "old draft", calls: [],
    getClientRects: () => ({ length: hidden ? 0 : 1 }),
    focus() {}, replaceChildren() { if (via === "dom") this.innerText = "?"; },
    createdChildren: null,
    dispatchEvent(e) {
      this.calls.push(e.type);
      const apply = (text) => setTimeout(() => (this.innerText = text), delay);
      if (e.type === "paste" && via === "paste") apply(e.clipboardData.getData("text/plain"));
      if (e.type === "beforeinput" && via === "beforeinput") { apply(e.data); e.defaultPrevented = true; }
      return true;
    },
  };
  globalThis.document = {
    createRange: () => ({ selectNodeContents() {} }),
    createElement: () => ({}), createTextNode: (t) => ({ t }),
    execCommand: (cmd, _ui, text) => { el.calls.push("execCommand"); if (via === "insertText") setTimeout(() => (el.innerText = text), delay); return via === "insertText"; },
  };
  globalThis.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  return el;
}

const { writeBack, squash } = await import("../src/writeback.js");
const TEXT = "Write a one-page summary.\nCover revenue and churn.";

test("a textarea gets its value and an input event", async () => {
  const ta = new FakeTextarea();
  assert.deepEqual(await writeBack(ta, TEXT), { ok: true, via: "value" });
  assert.equal(ta.value, TEXT);
  assert.ok(ta.events.includes("input"));
});

test("an editor that takes insertText is done after one try", async () => {
  const el = editor({ via: "insertText" });
  assert.deepEqual(await writeBack(el, TEXT), { ok: true, via: "insertText" });
  assert.deepEqual(el.calls, ["execCommand"]);
});

test("an editor that applies the edit a tick later still counts as landed", async () => {
  const el = editor({ via: "insertText", delay: 120 });
  assert.equal((await writeBack(el, TEXT)).ok, true);
});

test("an editor that ignores insertText but trusts paste gets the paste", async () => {
  const el = editor({ via: "paste" });
  assert.deepEqual(await writeBack(el, TEXT), { ok: true, via: "paste" });
  assert.deepEqual(el.calls.slice(0, 2), ["execCommand", "paste"]);
});

test("an editor that cancels beforeinput and applies the edit itself gets beforeinput", async () => {
  const el = editor({ via: "beforeinput" });
  assert.deepEqual(await writeBack(el, TEXT), { ok: true, via: "beforeinput" });
});

test("a hidden duplicate composer is not reported as written", async () => {
  const el = editor({ via: "insertText", hidden: true });
  assert.deepEqual(await writeBack(el, TEXT), { ok: false });
  assert.deepEqual(el.calls, []);
});

test("an editor that refuses everything reports failure so the caller can use the clipboard", async () => {
  const el = editor({ via: "none" });
  assert.equal((await writeBack(el, TEXT)).ok, false);
});

test("squash ignores list markers, headings, whitespace and case", () => {
  const sent = "Cover:\n- revenue\n1. churn\n# Done";
  const shown = "Cover:\n\nrevenue\n\nchurn\n\nDone"; // an editor that made real lists and a heading
  assert.equal(squash(shown), squash(sent));
  assert.notEqual(squash("something else"), squash(sent));
});
