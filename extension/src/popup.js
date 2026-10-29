// The toolbar popup. Says whether P.O.C runs on the site in this tab and, on
// any site that is not built in, switches it on or off.
//
// Switching on asks Chrome for that one site (chrome.permissions.request has
// to run inside the click, so it lives here, not in the worker). The worker
// sees the grant, registers the content script for the site and starts it in
// this tab.

const $ = (id) => document.getElementById(id);
const BUILT_IN = { "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "gemini.google.com": "Gemini" };

$("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

function show({ site, state, on = false, enable = false, disable = false, note = "" }) {
  $("site").textContent = site;
  $("state").textContent = state;
  $("state").className = on ? "state on" : "state";
  $("enable").hidden = !enable;
  $("disable").hidden = !disable;
  $("note").hidden = !note;
  $("note").textContent = note;
}

// Bundled as a classic script (IIFE), so no top-level await.
main();

async function main() {
  const [[tab], { apiKey }] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get("apiKey"),
  ]);
  const url = tab?.url ? new URL(tab.url) : null;
  const noKey = apiKey ? "" : "Add your Anthropic API key in Settings before P.O.C can coach.";

  if (!url || !/^https?:$/.test(url.protocol)) {
    show({ site: "This page", state: "P.O.C can't run on Chrome's own pages." });
  } else {
    const host = url.hostname;
    const origin = `${url.protocol}//${host}/*`;
    const builtIn = Object.entries(BUILT_IN).find(([h]) => host === h || host.endsWith(`.${h}`));
    if (builtIn) {
      show({ site: host, state: `On. Built in for ${builtIn[1]}.`, on: true, note: noKey });
    } else if (await chrome.permissions.contains({ origins: [origin] })) {
      show({ site: host, state: "On for this site.", on: true, disable: true, note: noKey });
    } else {
      show({
        site: host, state: "Off here.", enable: true,
        note: "Chrome will ask to let P.O.C read and change this site. It only reads the text box you are typing in, and sends nothing until you click Coach this draft.",
      });
    }

    $("enable").addEventListener("click", async () => {
      if (!(await chrome.permissions.request({ origins: [origin] }))) return; // You said no.
      await chrome.runtime.sendMessage({ type: "enableSite", tabId: tab.id }).catch(() => null);
      show({ site: host, state: "On. Click in a text box and start typing.", on: true, disable: true, note: noKey });
    });
    $("disable").addEventListener("click", async () => {
      await chrome.permissions.remove({ origins: [origin] });
      show({ site: host, state: "Off here. Reload the page to remove the dot.", enable: true });
    });
  }
}
