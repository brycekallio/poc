// Where the text caret is on screen, so the dot can sit beside it.
//
// Never mutates the host's editor: inserting a marker span into a ProseMirror
// document would be seen as an edit. A contenteditable reports its caret through
// the selection; a <textarea> cannot, so its text is copied into a hidden mirror
// that lives in our own shadow root, styled like the textarea, and the caret's
// position is read off a span in the mirror.

/**
 * @returns {(DOMRect & { midLine?: boolean }) | null} the caret's rect in
 * viewport coordinates. `midLine` is true when text follows the caret on the
 * same line, so the orb should lift above the line instead of covering it.
 */
export function caretRect(el, mirrorParent) {
  if (el instanceof HTMLTextAreaElement) return textareaCaret(el, mirrorParent);
  return editableCaret(el);
}

function editableCaret(el) {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0).cloneRange();
  if (!el.contains(range.endContainer)) return null;
  range.collapse(false);
  let rect = range.getClientRects()[0];
  if (rect && (rect.height || rect.top)) return withMidLine(rect, range);
  // A caret at an element boundary (after the last child, say) has no rect.
  // Move it to the end of the nearest preceding text, which does.
  const { endContainer: c, endOffset: o } = range;
  if (c.nodeType === 1) {
    let text = lastText(c.childNodes[o - 1]);
    if (text) {
      range.setStart(text, text.length);
      range.collapse(true);
      rect = range.getClientRects()[0];
      if (rect && (rect.height || rect.top)) return rect;
    }
  }
  // An empty line has no client rect. Fall back to the line's element.
  const node = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  if (!node) return null;
  const box = node.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(node).lineHeight) || 20;
  return new DOMRect(box.left + (parseFloat(getComputedStyle(node).paddingLeft) || 0), box.top, 0, line);
}

const COPIED = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
  "textTransform", "wordSpacing", "textIndent", "tabSize", "whiteSpace", "wordWrap", "overflowWrap", "wordBreak",
];

let mirror = null;

function textareaCaret(ta, parent) {
  if (!parent) return null;
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    parent.append(mirror);
  }
  const cs = getComputedStyle(ta);
  for (const p of COPIED) mirror.style[p] = cs[p];
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none", overflow: "hidden",
    whiteSpace: "pre-wrap", top: "0", left: "0", height: "auto", borderColor: "transparent",
  });
  const end = ta.selectionEnd ?? ta.value.length;
  mirror.textContent = ta.value.slice(0, end);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);

  const box = ta.getBoundingClientRect();
  const m = marker.getBoundingClientRect();
  const origin = mirror.getBoundingClientRect();
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
  const next = ta.value[end];
  return Object.assign(new DOMRect(box.left + (m.left - origin.left) - ta.scrollLeft, box.top + (m.top - origin.top) - ta.scrollTop, 0, line), {
    midLine: next !== undefined && next !== "\n",
  });
}

function lastText(node) {
  while (node && node.nodeType === 1) node = node.lastChild;
  return node?.nodeType === 3 ? node : null;
}

// Is there a character after the caret on the same visual line?
function withMidLine(rect, range) {
  const { endContainer: c, endOffset: o } = range;
  let midLine = false;
  if (c.nodeType === 3 && o < c.length && c.data[o] !== "\n") {
    const next = document.createRange();
    next.setStart(c, o);
    next.setEnd(c, o + 1);
    const r = next.getClientRects()[0];
    midLine = !!r && Math.abs(r.top - rect.top) < rect.height / 2;
  }
  return Object.assign(rect, { midLine });
}

/** "dark" if the element sits on a dark background, else "light". */
export function groundOf(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
    if (!m) continue;
    const [r, g, b, a = 1] = m.map(Number);
    if (a < 0.5) continue;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
