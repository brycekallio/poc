import { currentHost, findPromptBox, readPrompt } from "./hosts.js";

// POC is *invoked*, not ambient.
//
// A coach that interrupts while you type is unbearable within a day; one you
// summon when you are stuck gets used for months. Cmd+Shift+P opens it, Esc
// closes it, and it never speaks unless asked.
const HOTKEY = (e) => e.metaKey && e.shiftKey && e.code === "KeyP";

let panel = null;

function closePanel() {
  panel?.remove();
  panel = null;
}

function openPanel(prompt) {
  closePanel();
  panel = document.createElement("div");
  panel.className = "poc-panel";
  panel.innerHTML = `
    <div class="poc-head">
      <strong>Prompt Optimization Coach</strong>
      <button class="poc-close" aria-label="Close">esc</button>
    </div>
    <div class="poc-body">
      ${
        prompt.trim()
          ? `<p class="poc-muted">Read ${prompt.trim().length} characters. Coaching is not wired up yet — see CLAUDE.md for the API-key decision that gates it.</p>`
          : `<p class="poc-muted">Nothing in the prompt box yet. Write a first pass, then summon POC.</p>`
      }
    </div>`;
  panel.querySelector(".poc-close").addEventListener("click", closePanel);
  document.body.appendChild(panel);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panel) return closePanel();
  if (!HOTKEY(e)) return;

  const host = currentHost();
  if (!host) return;
  const box = findPromptBox(host);
  if (!box) return; // Selector drifted. Stay silent rather than break the page.

  e.preventDefault();
  openPanel(readPrompt(box));
});
