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

export function currentHost() {
  return HOSTS.find((h) => h.match.test(location.hostname)) ?? null;
}

// First visible match wins. These sites keep hidden duplicate composers
// (mobile layouts, pre-rendered states), and the first match in DOM order is
// not necessarily the one the user is typing in.
export function findPromptBox(host) {
  for (const sel of host.selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.getClientRects().length) return el;
    }
  }
  return null;
}

export function readPrompt(el) {
  return ("value" in el ? el.value : el.innerText) ?? "";
}
