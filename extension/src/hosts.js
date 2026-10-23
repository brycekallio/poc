// Each host site's prompt box, found by a selector we expect to break.
//
// This is the real maintenance cost of the extension: these sites ship UI
// changes constantly and none of them owe us a stable hook. Keep the
// selectors in one place, list several per host, and fail quietly when none
// match rather than throwing into the page.
export const HOSTS = [
  {
    id: "claude",
    match: /(^|\.)claude\.ai$/,
    selectors: ['div[contenteditable="true"]', "textarea"],
  },
  {
    id: "chatgpt",
    match: /(^|\.)chatgpt\.com$/,
    selectors: ["#prompt-textarea", 'div[contenteditable="true"]', "textarea"],
  },
  {
    id: "gemini",
    match: /(^|\.)gemini\.google\.com$/,
    selectors: ['div[contenteditable="true"]', "textarea"],
  },
];

export function currentHost() {
  return HOSTS.find((h) => h.match.test(location.hostname)) ?? null;
}

export function findPromptBox(host) {
  for (const sel of host.selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

export function readPrompt(el) {
  return ("value" in el ? el.value : el.innerText) ?? "";
}
