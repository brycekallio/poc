import { checkConnection, describeError, diagnose, listModels, ready, rewrite } from "./coach.js";
import { loadConfig, migrate } from "./settings.js";

// The only place a coaching request reads an API key. Content scripts share a
// process and a DOM with the host page, so a key never crosses into one:
// content.js sends the draft here and gets questions back.

const settings = async () => ready(await loadConfig());

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
  // 0.2 registered a script per switched-on site; the manifest covers them now.
  chrome.scripting.unregisterContentScripts({ ids: ["your-sites"] }).catch(() => {});
  await migrate();
  await Promise.all([allowLocalServers(), showSwitch()]);
  injectIntoOpenTabs();
  if (reason === "install") chrome.tabs.create({ url: "setup.html" });
});
chrome.runtime.onStartup.addListener(showSwitch);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) showSwitch();
});

// "OFF" on the toolbar icon, so the switch's state shows without opening it.
async function showSwitch() {
  const { enabled = true } = await chrome.storage.local.get("enabled");
  await chrome.action.setBadgeBackgroundColor({ color: "#5f6670" });
  await chrome.action.setBadgeText({ text: enabled ? "" : "OFF" });
}

// Ollama refuses any request carrying a chrome-extension:// Origin (403) unless
// the user sets OLLAMA_ORIGINS and restarts it. Dropping the header, only on
// requests this extension makes to this computer, means nobody has to. Scoped
// by initiator: web pages must not get the same pass to a local server.
async function allowLocalServers() {
  const id = 1;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
      condition: {
        regexFilter: "^https?://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?/",
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest", "other"],
      },
    }],
  });
}

// Chrome only adds content scripts to pages loaded after the extension, so
// tabs that were already open would show no dot until reloaded. Start P.O.C in
// them now. Pages Chrome forbids (the Web Store, chrome://) just fail.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://*/*", "http://*/*"] });
  await Promise.all(
    tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {})),
  );
}

const handlers = {
  async diagnose({ draft, host }) {
    const { reader, diagnosis, questions } = await diagnose({ config: await settings(), draft, host });
    // Logged here, in the worker's console, and nowhere the page can see it.
    // This is what to read when the questions come back generic.
    console.debug("[POC] reader", reader, "diagnosis", diagnosis, "questions", questions);
    return { reader, questions };
  },

  async rewrite({ draft, answers, host, reader }) {
    const { prompt, techniques, unverified } = await rewrite({ config: await settings(), draft, answers, host, reader });
    return { prompt, techniques, unverified };
  },

  async listModels({ config }) {
    return { models: await listModels(config) };
  },

  async checkConnection({ config }) {
    await checkConnection(config);
    return {};
  },

  // Nobody has chosen a model yet: the guide, not the settings page.
  async openOptions() {
    const { chosen } = await loadConfig();
    if (chosen) await chrome.runtime.openOptionsPage();
    else await chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
    return {};
  },
};

// These carry a key, so only accept them from our own extension pages. A
// content script's sender.url is the host page, not chrome-extension://.
const PAGES_ONLY = ["listModels", "checkConnection"];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  if (PAGES_ONLY.includes(msg.type) && !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;

  handler(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: describeError(err) }));
  return true; // Keep the channel open for the async response.
});
