import { DEFAULT_PROVIDER, PROVIDERS } from "./coach-models.js";

// What storage.local holds about the model:
//   provider   a PROVIDERS key
//   models     { [provider]: model id }
//   keys       { [provider]: API key }
//   baseUrl    the "Other" server's address
// One key per provider, so switching back and forth loses nothing.
//
// storage.local, never storage.sync. Sync would push keys through the user's
// Google account to every Chrome they sign in to.

const FIELDS = ["provider", "models", "keys", "baseUrl", "apiKey", "model"];

/** The config for the chosen provider. `chosen` says whether anyone has chosen. */
export async function loadConfig(provider) {
  const { provider: saved, models = {}, keys = {}, baseUrl = "" } = await chrome.storage.local.get(FIELDS);
  const p = provider ?? saved ?? DEFAULT_PROVIDER;
  return { provider: p, model: models[p] ?? "", apiKey: keys[p] ?? "", baseUrl: p === "custom" ? baseUrl : "", chosen: !!saved };
}

/** Store a working config and make it the current one. */
export async function saveConfig({ provider, model, apiKey, baseUrl }) {
  const { models = {}, keys = {} } = await chrome.storage.local.get(["models", "keys"]);
  await chrome.storage.local.set({
    provider,
    models: { ...models, [provider]: model },
    keys: { ...keys, [provider]: PROVIDERS[provider]?.keyHint ? apiKey : undefined },
    ...(provider === "custom" ? { baseUrl } : {}),
  });
}

export async function removeKey(provider) {
  const { keys = {} } = await chrome.storage.local.get("keys");
  delete keys[provider];
  await chrome.storage.local.set({ keys });
}

/** 0.3 kept one Anthropic key and model at the top level. */
export async function migrate() {
  const { apiKey, model, keys = {}, models = {}, provider } = await chrome.storage.local.get(FIELDS);
  if (!apiKey) return;
  await chrome.storage.local.set({
    provider: provider ?? "anthropic",
    keys: { ...keys, anthropic: apiKey },
    models: { ...models, anthropic: model },
  });
  await chrome.storage.local.remove(["apiKey", "model"]);
}
