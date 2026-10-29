// Put the rewritten prompt into the host's prompt box, through the editor's own
// input pipeline so its framework sees a real edit.
//
// claude.ai and chatgpt.com use framework-controlled editors (ProseMirror and
// similar). Setting innerHTML or textContent does not work: the editor's model
// never sees it and reverts on the next keystroke. So:
//   - a contenteditable gets focus, select-all inside it, then insertText,
//     which fires beforeinput/input exactly like typing;
//   - a <textarea> gets its value through the native setter, so React's value
//     tracker notices, then an input event.
// Then we read the box back. If the text did not land, the caller copies it to
// the clipboard and says so, rather than silently losing a rewrite.

/** @returns {boolean} whether the box now holds `text` */
export function writeBack(el, text) {
  try {
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      el.focus();
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // Deprecated and still universally implemented; the pragmatic way to go
      // through the browser's editing pipeline. See BUILD.md, Write-back.
      document.execCommand("insertText", false, text);
    }
  } catch {
    return false;
  }
  return landed(el, text);
}

function landed(el, text) {
  const norm = (t) => t.replace(/\s+/g, " ").trim();
  const now = "value" in el ? el.value : el.innerText;
  return norm(now ?? "") === norm(text);
}
