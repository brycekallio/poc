import { DEFAULT_MODEL, MODELS, PROVIDERS, TOKENS_PER_USE, costPer100, pickModel } from "./coach-models.js";
import { loadConfig, removeKey, saveConfig } from "./settings.js";

// One view, one save: Save proves the connection through the worker, the same
// path the coach uses, and stores it only if that works.

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;
const fmt = (n) => n.toLocaleString("en-US");
const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

let provider = null; // the row selected, which may not be saved yet
const isAnthropic = () => provider === "anthropic";
const chosenModel = () =>
  isAnthropic() ? (document.querySelector('input[name="model"]:checked')?.value ?? DEFAULT_MODEL) : $("pick").value;
const typed = () => ({ provider, apiKey: $("key").value.trim(), baseUrl: $("url").value.trim(), model: chosenModel() });

const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = kind;
};

// ── The rows ──────────────────────────────────────────────────────────
for (const [id, p] of Object.entries(PROVIDERS)) {
  $("providers").append(row("provider", id, p.name, p.note, p.local ? "Free" : ""));
}
for (const m of MODELS) {
  const el = row("model", m.id, m.name, m.note, "");
  el.querySelector(".tag").innerHTML = `<span class="cost num"><span class="amount"></span><small>per 100 uses</small></span>`;
  el.querySelector(".amount").textContent = money(costPer100(m));
  $("models").append(el);
}
$("estimate").textContent = `Estimated at list prices for about ${fmt(TOKENS_PER_USE.input)} tokens in and ${fmt(TOKENS_PER_USE.output)} out per use.`;

function row(group, value, name, note, tag) {
  const el = document.createElement("label");
  el.className = "model";
  el.innerHTML = `<input type="radio"><span><span class="mname"></span><span class="mnote"></span></span><span class="tag"></span>`;
  Object.assign(el.querySelector("input"), { name: group, value });
  el.querySelector(".mname").textContent = name;
  el.querySelector(".mnote").textContent = note;
  el.querySelector(".tag").textContent = tag;
  return el;
}

// ── Selecting a provider ──────────────────────────────────────────────
async function select(id) {
  provider = id;
  const p = PROVIDERS[id];
  const config = await loadConfig(id);
  document.querySelector(`input[name="provider"][value="${id}"]`).checked = true;
  $("url-row").hidden = id !== "custom";
  $("url").value = config.baseUrl;
  $("key-row").hidden = !!p.local;
  $("remove-section").hidden = !p.keyHint;
  $("key").value = config.apiKey;
  $("key").placeholder = p.keyHint ?? "";
  const help = $("key-help");
  help.textContent = id === "custom" ? "Kept in this browser only, never synced." : `Kept in this browser only, never synced. Sent to ${p.name} and nowhere else. `;
  if (p.keyUrl) help.append(Object.assign(document.createElement("a"), { href: p.keyUrl, target: "_blank", rel: "noreferrer", textContent: "Create a key" }));

  $("models").hidden = !isAnthropic();
  $("estimate").hidden = !isAnthropic();
  $("pick-row").hidden = isAnthropic();
  if (isAnthropic()) {
    const m = MODELS.some((x) => x.id === config.model) ? config.model : DEFAULT_MODEL;
    document.querySelector(`input[name="model"][value="${m}"]`).checked = true;
  } else {
    fillModels(config.model);
  }
}

// Providers other than Anthropic are asked what they offer.
async function fillModels(current = "") {
  const pick = $("pick");
  if (!PROVIDERS[provider].keyless && !$("key").value.trim()) {
    pick.replaceChildren(new Option("Paste a key to see the models", ""));
    return;
  }
  if (provider === "custom" && !$("url").value.trim()) {
    pick.replaceChildren(new Option("Enter the server address first", ""));
    return;
  }
  const asked = provider;
  pick.replaceChildren(new Option("Asking for the model list…", ""));
  const res = await ask({ type: "listModels", config: typed() });
  if (asked !== provider) return;
  if (!res?.ok) {
    pick.replaceChildren(new Option("Could not list models", ""));
    status(res?.error?.message ?? "Could not list models.", "err");
    return;
  }
  status("");
  if (!res.models.length) {
    pick.replaceChildren(new Option("No models yet", ""));
    return;
  }
  pick.replaceChildren(...res.models.map((m) => new Option(m, m)));
  pick.value = res.models.includes(current) ? current : pickModel(provider, res.models);
}

$("providers").addEventListener("change", (e) => {
  status("");
  select(e.target.value);
});
$("key").addEventListener("change", () => isAnthropic() || fillModels($("pick").value));
$("url").addEventListener("change", () => fillModels($("pick").value));

// ── The ledger beside the preview: what is saved, not what is selected ──
function ledgerSaved(config) {
  const p = PROVIDERS[config.provider];
  const ready = config.chosen && (p.keyless || config.apiKey);
  $("lede").textContent = ready ? `P.O.C runs on ${p.name}.` : "Not connected yet. Choose where the AI runs.";
  $("remove").disabled = !config.apiKey;
  $("preview").dataset.ready = String(!!ready);
  $("ready-state").textContent = ready ? "On. Hover the dot beside your caret." : "Waiting for a connection.";
  $("ready-state").className = ready ? "state ok" : "state";
  $("ready-key").textContent = !ready ? "Not connected" : config.apiKey ? `${p.name}, key ending ${config.apiKey.slice(-4)}` : p.local ? "This computer" : p.name;
  $("ready-key").className = ready ? "" : "missing";
  const m = MODELS.find((x) => x.id === config.model);
  $("ready-model").textContent = ready ? (m?.name ?? (config.model || "First available")) : "None yet";
  $("ready-cost").textContent = !ready ? "—" : p.local ? "Free" : m ? money(costPer100(m)) : "See your provider";
}

// ── Start ─────────────────────────────────────────────────────────────
loadConfig().then((config) => {
  ledgerSaved(config);
  select(config.provider);
});

chrome.commands.getAll().then((cmds) => {
  const keys = cmds.find((c) => c.name === "open-coach")?.shortcut;
  const el = $("shortcut");
  $("ready-shortcut").textContent = keys || "Not set";
  if (!keys) {
    el.textContent = "Not set";
    return;
  }
  el.replaceChildren(...[...keys].map((k) => Object.assign(document.createElement("kbd"), { className: "key", textContent: k })));
});

$("reveal").addEventListener("click", () => {
  const shown = $("key").type === "text";
  $("key").type = shown ? "password" : "text";
  $("reveal").textContent = shown ? "Show" : "Hide";
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const config = typed();
  const p = PROVIDERS[provider];
  if (!p.keyless && !config.apiKey) {
    status("Paste a key first.", "err");
    $("key").focus();
    return;
  }
  if (!config.model) {
    status("Choose a model first.", "err");
    return;
  }
  $("save").disabled = true;
  status(`Checking with ${p.name}…`);
  const res = await ask({ type: "checkConnection", config });
  $("save").disabled = false;
  if (!res?.ok) {
    status(`Not saved. ${res?.error?.message ?? "The check failed."}`, "err");
    return;
  }
  await saveConfig(config);
  status(`Saved at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It works.`, "ok");
  ledgerSaved(await loadConfig());
});

$("remove").addEventListener("click", async () => {
  if (!confirm(`Remove your ${PROVIDERS[provider].name} key from this browser?`)) return;
  await removeKey(provider);
  $("key").value = "";
  status("Key removed.");
  ledgerSaved(await loadConfig());
});

$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
