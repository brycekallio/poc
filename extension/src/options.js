import { DEFAULT_MODEL, MODELS, TOKENS_PER_USE, costPer100 } from "./coach-models.js";

// One view, one save model: the Save button checks the key against the chosen
// model through the worker, the same path the coach uses, and stores both only
// if the check passes.

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toFixed(2)}`;
const nameOf = (id) => MODELS.find((m) => m.id === id)?.name ?? id;

const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").className = kind;
};
const lede = (apiKey, model) => {
  $("lede").textContent = apiKey
    ? `Key saved. The coach runs on ${nameOf(model)}.`
    : "No key yet. The coach cannot run until you add one.";
  $("lede").className = apiKey ? "lede ok" : "lede";
  $("remove").disabled = !apiKey;
};

// Model rows, each with its estimated cost so the choice shows what it costs.
for (const m of MODELS) {
  const row = document.createElement("label");
  row.className = "model";
  row.innerHTML = `<input type="radio" name="model"><span><span class="mname"></span><span class="mnote"></span></span><span class="cost num"><span class="amount"></span><small>per 100 uses</small></span>`;
  row.querySelector("input").value = m.id;
  row.querySelector(".mname").textContent = m.name;
  row.querySelector(".mnote").textContent = m.note;
  row.querySelector(".amount").textContent = money(costPer100(m));
  $("models").append(row);
}
const fmt = (n) => n.toLocaleString("en-US");
$("estimate").textContent =
  `Estimated at list prices for about ${fmt(TOKENS_PER_USE.input)} tokens in and ${fmt(TOKENS_PER_USE.output)} out per use. A long draft costs more.`;

const selectedModel = () => document.querySelector('input[name="model"]:checked')?.value ?? DEFAULT_MODEL;

chrome.storage.local.get(["apiKey", "model"]).then(({ apiKey, model }) => {
  if (apiKey) $("key").value = apiKey;
  // A saved model that has since left the list falls back to the default.
  const m = MODELS.some((x) => x.id === model) ? model : DEFAULT_MODEL;
  document.querySelector(`input[name="model"][value="${m}"]`).checked = true;
  lede(apiKey, m);
});

chrome.commands.getAll().then((cmds) => {
  const keys = cmds.find((c) => c.name === "open-coach")?.shortcut;
  const el = $("shortcut");
  if (!keys) {
    el.textContent = "Not set";
    return;
  }
  el.replaceChildren(...[...keys].map((k) => Object.assign(document.createElement("kbd"), { textContent: k })));
});

$("reveal").addEventListener("click", () => {
  const shown = $("key").type === "text";
  $("key").type = shown ? "password" : "text";
  $("reveal").textContent = shown ? "Show" : "Hide";
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = $("key").value.trim();
  const model = selectedModel();
  if (!apiKey) {
    status("Paste a key first.", "err");
    $("key").focus();
    return;
  }
  $("save").disabled = true;
  status(`Checking the key with ${nameOf(model)}…`);
  const res = await chrome.runtime.sendMessage({ type: "checkKey", apiKey, model }).catch(() => null);
  $("save").disabled = false;
  if (!res?.ok) {
    status(`Not saved. ${res?.error?.message ?? "The check failed."}`, "err");
    return;
  }
  await chrome.storage.local.set({ apiKey, model });
  status(`Saved at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. The key works with ${nameOf(model)}.`, "ok");
  lede(apiKey, model);
});

$("remove").addEventListener("click", async () => {
  if (!confirm("Remove your Anthropic API key from this browser? The coach stops working until you add one again.")) return;
  await chrome.storage.local.remove("apiKey");
  $("key").value = "";
  status("Key removed.");
  lede(null, selectedModel());
});

$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
