// Each host site's prompt box, found by a selector we expect to break.
//
// This is the real maintenance cost of the extension: these sites ship UI
// changes constantly and none of them owe us a stable hook. Keep the
// selectors in one place, list several per host, and fail quietly when none
// match rather than throwing into the page.
export const HOSTS = [
  {
    id: "claude",
    label: "Claude",
    match: /(^|\.)claude\.ai$/,
    // ProseMirror first: the bare contenteditable selector also matches other
    // editable regions on the page, and querySelector returns the first one.
    selectors: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]', "textarea"],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    match: /(^|\.)chatgpt\.com$/,
    // Logged in: #prompt-textarea (ProseMirror). Logged out, as of 2026-10-28:
    // a plain textarea[name="prompt"].
    selectors: ["#prompt-textarea", 'textarea[name="prompt"]', 'div[contenteditable="true"]', "textarea"],
  },
  {
    id: "gemini",
    label: "Gemini",
    match: /(^|\.)gemini\.google\.com$/,
    selectors: ['div[contenteditable="true"]', "textarea"],
  },
];

// Any other site runs this script only because you switched P.O.C on there
// (the toolbar popup), so there is no selector to know in advance: the prompt
// box is whichever multi-line text box you are typing in.
export function currentHost() {
  return HOSTS.find((h) => h.match.test(location.hostname)) ?? { id: "site", label: location.hostname, generic: true };
}

// First visible match wins. These sites keep hidden duplicate composers
// (mobile layouts, pre-rendered states), and the first match in DOM order is
// not necessarily the one the user is typing in.
export function findPromptBox(host) {
  if (host.generic) return editableAt(document.activeElement);
  for (const sel of host.selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.getClientRects().length) return el;
    }
  }
  return null;
}

// The focused <textarea>, or the root of the focused contenteditable. Not
// single-line inputs: a search bar or a login field is not a prompt.
function editableAt(el) {
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (!el?.isContentEditable) return null;
  while (el.parentElement?.isContentEditable) el = el.parentElement;
  return el;
}

export function readPrompt(el) {
  return ("value" in el ? el.value : el.innerText) ?? "";
}
