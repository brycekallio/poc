// The toolbar popup. P.O.C runs on every site; this says what it coaches on the
// site in this tab and turns it off (or back on) there.
//
// The off list is hostnames in storage.local. content.js follows it live, so
// switching needs no reload.

const $ = (id) => document.getElementById(id);
const CHAT = { "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "gemini.google.com": "Gemini" };

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
  const [[tab], { apiKey, offSites = [] }] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get(["apiKey", "offSites"]),
  ]);
  const url = tab?.url ? new URL(tab.url) : null;
  const noKey = apiKey ? "" : "Add your Anthropic API key in Settings before P.O.C can coach.";

  if (!url || !/^https?:$/.test(url.protocol)) {
    show({ site: "This page", state: "P.O.C can't run on Chrome's own pages." });
    return;
  }
  const host = url.hostname;
  const chat = Object.entries(CHAT).find(([h]) => host === h || host.endsWith(`.${h}`))?.[1];
  const onState = chat ? `On. Coaching your prompts to ${chat}.` : "On. Coaching prompts and messages here.";

  const render = (isOff) =>
    isOff
      ? show({ site: host, state: "Off on this site.", enable: true })
      : show({ site: host, state: onState, on: true, disable: true, note: noKey });
  render(offSites.includes(host));

  const setOff = async (isOff) => {
    const { offSites: list = [] } = await chrome.storage.local.get("offSites");
    const next = isOff ? [...new Set([...list, host])] : list.filter((h) => h !== host);
    await chrome.storage.local.set({ offSites: next });
    render(isOff);
  };
  $("enable").addEventListener("click", () => setOff(false));
  $("disable").addEventListener("click", () => setOff(true));
}
