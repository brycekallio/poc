// Put the rewritten prompt into the host's prompt box, through the editor's own
// input pipeline so its framework sees a real edit.
//
// claude.ai, chatgpt.com and gemini use framework-controlled editors
// (ProseMirror/TipTap, Quill, Lexical). Setting innerHTML or textContent does
// not work: the editor's model never sees it and reverts on the next keystroke.
// So, in order, until the box holds the text:
//   textarea       the native value setter (so React's value tracker notices),
//                  then an input event;
//   contenteditable
//     1. select-all, then execCommand("insertText"): fires beforeinput/input
//        exactly like typing. Works on most editors;
//     2. select-all, then a synthetic paste event carrying text/plain: for
//        editors that take over insertText/beforeinput and only trust paste;
//     3. select-all, then a synthetic beforeinput: for editors (Lexical, Slate)
//        that apply the edit themselves and cancel the browser's;
//     4. last resort, the DOM itself, for a plain editor with no framework.
// After each try we wait for the editor to catch up (they apply edits a tick
// later) and read the box back. If nothing landed the caller copies the text to
// the clipboard and says so, rather than silently losing a rewrite.

const SETTLE_MS = 260; // how long to give an editor to show an edit before the next try
const POLL_MS = 40;

/** @returns {Promise<{ ok: boolean, via?: string }>} whether the box now holds `text`, and which try did it */
export async function writeBack(el, text) {
  // A hidden duplicate composer (mobile layout, pre-rendered state) takes the
  // text and shows it to nobody. Better to say so than to claim success.
  if (!el?.isConnected || !el.getClientRects().length) return { ok: false };
  try {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return setValue(el, text);
    for (const [via, attempt] of TRIES) {
      selectAll(el);
      attempt(el, text);
      if (await landedSoon(el, text)) return { ok: true, via };
      el.focus();
    }
  } catch {
    // Fall through: the caller has the clipboard.
  }
  return { ok: false };
}

async function setValue(el, text) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return (await landedSoon(el, text)) ? { ok: true, via: "value" } : { ok: false };
}

const TRIES = [
  // Deprecated and still universally implemented; the pragmatic way to go
  // through the browser's editing pipeline. See BUILD.md, Write-back.
  ["insertText", (el, text) => document.execCommand("insertText", false, text)],
  ["paste", (el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }],
  ["beforeinput", (el, text) => {
    el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
  }],
  ["dom", (el, text) => {
    const lines = text.split("\n");
    el.replaceChildren(...lines.flatMap((line, i) => (i ? [document.createElement("br"), document.createTextNode(line)] : [document.createTextNode(line)])));
    el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: text, bubbles: true }));
  }],
];

function selectAll(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Editors apply an edit a tick after the event, so look more than once.
async function landedSoon(el, text) {
  const until = Date.now() + SETTLE_MS;
  for (;;) {
    if (landed(el, text)) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function landed(el, text) {
  const now = "value" in el ? el.value : el.innerText;
  return squash(now ?? "") === squash(text);
}

// Compare what a reader would see, not the bytes. Editors turn "- " and "1. "
// into real lists (the marker leaves innerText), "# " into headings, and one
// newline into one or two paragraphs; none of that means the text did not land.
export function squash(t) {
  return t
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)]|#{1,6})[ \t]+/gm, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}
