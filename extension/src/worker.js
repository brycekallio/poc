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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  syncSites();
  if (reason !== "install") return;
  const { apiKey } = await settings();
  if (!apiKey) chrome.runtime.openOptionsPage();
});

// ── Sites you switched on ─────────────────────────────────────────────
// Claude, ChatGPT and Gemini are in the manifest. Any other site is opt-in:
// the toolbar popup asks Chrome for that one site's permission, and the grant
// itself is the record. This keeps the content script registered for exactly
// the granted sites, so the list cannot drift from what Chrome allows.
const BUILT_IN = chrome.runtime.getManifest().host_permissions;
const SITES_ID = "your-sites";

async function syncSites() {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => !BUILT_IN.includes(o));
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SITES_ID] });
  if (!matches.length) {
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SITES_ID] });
    return;
  }
  const script = { id: SITES_ID, matches, js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true };
  await (registered.length ? chrome.scripting.updateContentScripts([script]) : chrome.scripting.registerContentScripts([script]));
}
chrome.permissions.onAdded.addListener(syncSites);
chrome.permissions.onRemoved.addListener(syncSites);
chrome.runtime.onStartup.addListener(syncSites);

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
    const { prompt, techniques, unverified } = await rewrite({ apiKey, model, draft, answers, host });
    return { prompt, techniques, unverified };
  },

  async checkKey({ apiKey, model }) {
    await checkKey({ apiKey, model });
    return { ok: true };
  },

  // From the popup, after Chrome granted the site: start P.O.C in the open
  // tab now, rather than on its next load.
  async enableSite({ tabId }) {
    await syncSites();
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
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
  // enableSite injects scripts, so the same rule holds for it.
  if ((msg.type === "checkKey" || msg.type === "enableSite") && !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;

  handler(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: describeError(err) }));
  return true; // Keep the channel open for the async response.
});
