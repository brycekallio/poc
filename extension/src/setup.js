import { PROVIDERS, pickModel } from "./coach-models.js";
import { loadConfig, saveConfig } from "./settings.js";

// The first-run guide. P.O.C starts free: if Ollama is on this computer it is
// used; if it is missing, this page sends you to download it and waits for it
// to appear; and a key works from the start for anyone who has one.

const $ = (id) => document.getElementById(id);
const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
const OLLAMA = PROVIDERS.ollama.baseUrl.replace(/\/v1$/, "");
// A good all-rounder that runs on a laptop. Tried on real drafts, 2026-10-30.
const STARTER = { model: "qwen2.5", size: "4.7 GB" };

let watching = 0;
let provider = "anthropic";

function showLocal({ say, more = "", get = false, pull = false, models = null }) {
  $("local-say").textContent = say;
  $("local-more").textContent = more;
  $("get-ollama").hidden = !get;
  $("pull").hidden = !pull;
  $("pull").textContent = `Download ${STARTER.model} (${STARTER.size})`;
  $("local-model").hidden = !models;
  $("use-local").hidden = !models;
  if (models) {
    $("local-model").replaceChildren(...models.map((m) => new Option(m, m)));
    $("local-model").value = pickModel("ollama", models);
  }
}

// Looks once, and keeps looking while you install Ollama in another window.
async function look() {
  const res = await ask({ type: "listModels", config: { provider: "ollama" } });
  if (res?.ok && res.models.length) {
    clearInterval(watching);
    showLocal({ say: "Ollama is running. You're set for free.", models: res.models });
  } else if (res?.ok) {
    clearInterval(watching);
    showLocal({ say: "Ollama is running, but it has no model yet.", more: "A model is the AI itself. This one takes a few minutes to download.", pull: true });
  } else if (!watching) {
    showLocal({
      say: "Ollama isn't on this computer yet.",
      more: "It's a free app that runs AI models privately on your machine. Install it, open it, and this page carries on by itself.",
      get: true,
    });
    watching = setInterval(look, 3000);
  }
}

async function pull() {
  $("pull").disabled = true;
  $("meter").hidden = false;
  try {
    const res = await fetch(`${OLLAMA}/api/pull`, { method: "POST", body: JSON.stringify({ model: STARTER.model }) });
    if (!res.ok) throw new Error();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const lines = (rest + value).split("\n");
      rest = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const { total, completed, error } = JSON.parse(line);
        if (error) throw new Error(error);
        if (total) {
          $("meter-bar").style.width = `${Math.round(((completed ?? 0) / total) * 100)}%`;
          $("local-say").textContent = `Downloading ${STARTER.model}: ${((completed ?? 0) / 1e9).toFixed(1)} of ${(total / 1e9).toFixed(1)} GB`;
        }
      }
    }
    $("meter").hidden = true;
    look();
  } catch {
    $("meter").hidden = true;
    $("pull").disabled = false;
    $("local-say").textContent = "The download stopped. Check your connection and try again.";
  }
}

// ── Keys ──────────────────────────────────────────────────────────────
const KEYED = ["anthropic", "openai", "gemini"];
for (const id of KEYED) {
  const chip = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: PROVIDERS[id].name });
  chip.dataset.id = id;
  chip.addEventListener("click", () => choose(id));
  $("chips").append(chip);
}
function choose(id) {
  provider = id;
  const p = PROVIDERS[id];
  for (const c of $("chips").children) c.setAttribute("aria-pressed", String(c.dataset.id === id));
  $("key").placeholder = p.keyHint;
  $("key-help").textContent = `${p.note} Kept in this browser only. `;
  $("key-help").append(Object.assign(document.createElement("a"), { href: p.keyUrl, target: "_blank", rel: "noreferrer", textContent: "Create a key" }));
}

$("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = $("key").value.trim();
  if (!apiKey) return $("key").focus();
  $("connect").disabled = true;
  $("key-help").textContent = `Checking with ${PROVIDERS[provider].name}…`;
  const config = { provider, apiKey };
  const listed = await ask({ type: "listModels", config });
  const model = listed?.ok && pickModel(provider, listed.models);
  const checked = model ? await ask({ type: "checkConnection", config: { ...config, model } }) : listed;
  $("connect").disabled = false;
  if (!checked?.ok) {
    $("key-help").textContent = checked?.error?.message ?? "That didn't work. Check the key and try again.";
    return;
  }
  await connected({ ...config, model });
});

// ── Connected ─────────────────────────────────────────────────────────
async function connected(config) {
  await saveConfig(config);
  clearInterval(watching);
  if (PROVIDERS[config.provider].local) showLocal({ say: `Connected to ${config.model}. It's free and stays on this computer.` });
  $("try-step").dataset.dim = "false";
  $("try-say").textContent = `Connected to ${PROVIDERS[config.provider].name}. Click in the box and hover the dot beside your cursor, then click Coach this draft.`;
  $("try").disabled = false;
  $("try").focus();
  $("try").setSelectionRange($("try").value.length, $("try").value.length);
  $("done").hidden = false;
}

$("use-local").addEventListener("click", () => connected({ provider: "ollama", model: $("local-model").value }));
$("pull").addEventListener("click", pull);
$("done").addEventListener("click", () => window.close());

choose("anthropic");
look();
loadConfig().then((c) => c.chosen && (PROVIDERS[c.provider].keyless || c.apiKey) && connected(c));
