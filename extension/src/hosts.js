// Each host site's prompt box, found by a selector we expect to break.
//
// This is the real maintenance cost of the extension: these sites ship UI
// changes constantly and none of them owe us a stable hook. Keep the
// selectors in one place, list several per host, and fail quietly when none
// match rather than throwing into the page.
//
// Scope (Bryce, 2026-11-02): P.O.C runs on AI chat sites only, not on Gmail,
// Docs or search bars. This list is the whole scope. build.mjs turns `urls`
// into the manifest's content-script matches, so adding a site is one entry here.
//
// A site with `selectors` is looked up by them. A site without follows the text
// box you are typing in, which is the right default for a chat site whose markup
// we have not studied.
export const HOSTS = [
  {
    id: "claude",
    label: "Claude",
    match: /(^|\.)claude\.ai$/,
    urls: ["https://claude.ai/*"],
    // ProseMirror first: the bare contenteditable selector also matches other
    // editable regions on the page, and querySelector returns the first one.
    selectors: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]', "textarea"],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    match: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
    urls: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    // Logged in: #prompt-textarea (ProseMirror). Logged out, as of 2026-10-28:
    // a plain textarea[name="prompt"].
    selectors: ["#prompt-textarea", 'textarea[name="prompt"]', 'div[contenteditable="true"]', "textarea"],
  },
  {
    id: "gemini",
    label: "Gemini",
    match: /(^|\.)gemini\.google\.com$/,
    urls: ["https://gemini.google.com/*"],
    selectors: ['div[contenteditable="true"]', "textarea"],
  },
  { id: "aistudio", label: "Google AI Studio", match: /(^|\.)aistudio\.google\.com$/, urls: ["https://aistudio.google.com/*"] },
  { id: "copilot", label: "Microsoft Copilot", match: /(^|\.)copilot\.microsoft\.com$/, urls: ["https://copilot.microsoft.com/*"] },
  { id: "perplexity", label: "Perplexity", match: /(^|\.)perplexity\.ai$/, urls: ["https://*.perplexity.ai/*"] },
  { id: "grok", label: "Grok", match: /(^|\.)grok\.com$/, urls: ["https://grok.com/*", "https://*.grok.com/*"] },
  { id: "deepseek", label: "DeepSeek", match: /(^|\.)chat\.deepseek\.com$/, urls: ["https://chat.deepseek.com/*"] },
  { id: "mistral", label: "Le Chat", match: /(^|\.)chat\.mistral\.ai$/, urls: ["https://chat.mistral.ai/*"] },
  { id: "poe", label: "Poe", match: /(^|\.)poe\.com$/, urls: ["https://poe.com/*"] },
  { id: "metaai", label: "Meta AI", match: /(^|\.)meta\.ai$/, urls: ["https://*.meta.ai/*"] },
  { id: "kimi", label: "Kimi", match: /(^|\.)kimi\.com$/, urls: ["https://*.kimi.com/*"] },
  { id: "qwen", label: "Qwen", match: /(^|\.)chat\.qwen\.ai$/, urls: ["https://chat.qwen.ai/*"] },
  { id: "t3chat", label: "T3 Chat", match: /(^|\.)t3\.chat$/, urls: ["https://t3.chat/*"] },
  { id: "huggingchat", label: "HuggingChat", match: /(^|\.)huggingface\.co$/, urls: ["https://huggingface.co/chat/*"] },
  { id: "openrouter", label: "OpenRouter Chat", match: /(^|\.)openrouter\.ai$/, urls: ["https://openrouter.ai/chat*"] },
];

/** Every page address the content script may run on, for the manifest and for tabs that were open at install. */
// How the model is told a box is on a chat site. coach.js's echo check looks for
// AI_CHAT; the Mac app's HostLabel.swift spells the same phrase ("... app"), and
// test/host-label.test.mjs fails if the two drift.
export const AI_CHAT = "an AI chat";
export const chatSiteLabel = (label) => `${label}, ${AI_CHAT} site`;

export const CHAT_URLS = HOSTS.flatMap((h) => h.urls);

// Only the extension's own setup page (a practice box) gets here without being
// a chat site: it takes whichever box you are typing in.
export function currentHost() {
  return HOSTS.find((h) => h.match.test(location.hostname)) ?? { id: "site", label: location.hostname, generic: true };
}

// A host with no selectors follows the focused text box.
export const followsFocus = (host) => host.generic || !host.selectors;

// First visible match wins. These sites keep hidden duplicate composers
// (mobile layouts, pre-rendered states), and the first match in DOM order is
// not necessarily the one the user is typing in.
export function findPromptBox(host) {
  if (followsFocus(host)) return editableAt(document.activeElement);
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
