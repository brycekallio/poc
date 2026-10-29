import { CoachError, DEFAULT_MODEL, checkKey, describeError, diagnose, rewrite } from "./coach.js";

// The only place the API key is read. Content scripts share a process and a DOM
// with the host page, so the key never crosses into one: content.js sends the
// draft here and gets questions back.
//
// storage.local, never storage.sync. Sync would push the key through the
// user's Google account to every Chrome they sign in to.

async function settings() {
  const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
  return { apiKey, model: model || DEFAULT_MODEL };
}

// The hotkey is a chrome.commands entry rather than a keydown listener in the
// page. Chrome sees it before the host's editor can swallow it, and the user can
// rebind it at chrome://extensions/shortcuts.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "open-coach" || !tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
  } catch {
    // No content script in this tab (not a supported host). Stay silent.
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const { apiKey } = await settings();
  if (!apiKey) chrome.runtime.openOptionsPage();
});

const handlers = {
  async diagnose({ draft, host }) {
    const { apiKey, model } = await settings();
    if (!apiKey) throw new CoachError("no-key");
    const { diagnosis, questions } = await diagnose({ apiKey, model, draft, host });
    // Logged here, in the worker's console, and nowhere the page can see it.
    // This is what to read when the questions come back generic.
    console.debug("[POC] diagnosis", diagnosis, "questions", questions);
    return { questions };
  },

  async rewrite({ draft, answers, host }) {
    const { apiKey, model } = await settings();
    if (!apiKey) throw new CoachError("no-key");
    const { prompt, techniques } = await rewrite({ apiKey, model, draft, answers, host });
    return { prompt, techniques };
  },

  async checkKey({ apiKey, model }) {
    await checkKey({ apiKey, model });
    return { ok: true };
  },

  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  // checkKey carries a key, so only accept it from our own extension pages.
  // A content script's sender.url is the host page, not chrome-extension://.
  if (msg.type === "checkKey" && !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;

  handler(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: describeError(err) }));
  return true; // Keep the channel open for the async response.
});
