// The toolbar popup: one light switch for P.O.C everywhere, and which model it
// is using. content.js follows `enabled` live, so flipping needs no reload.
import { PROVIDERS } from "./coach-models.js";
import { loadConfig } from "./settings.js";

const $ = (id) => document.getElementById(id);

$("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$("finish").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  window.close();
});

const render = (enabled) => {
  $("switch").setAttribute("aria-checked", String(enabled));
  $("state").textContent = enabled ? "On" : "Off";
  $("hint").textContent = enabled ? "The dot shows in every text box." : "Hidden everywhere until you flip it back.";
};

main();

async function main() {
  const [{ enabled = true }, config] = await Promise.all([chrome.storage.local.get("enabled"), loadConfig()]);
  render(enabled);
  document.body.dataset.ready = "true"; // No animation on the first paint.
  const p = PROVIDERS[config.provider];
  $("using").textContent = config.chosen ? `Using ${p.name}${config.model ? `, ${config.model}` : ""}` : "";
  $("finish").hidden = config.chosen;

  $("switch").addEventListener("click", () => {
    const next = $("switch").getAttribute("aria-checked") !== "true";
    render(next);
    chrome.storage.local.set({ enabled: next });
  });
}
