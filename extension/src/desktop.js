// The Mac app's door into the shared coaching code.
//
// POC.app runs this file, bundled as desktop/Resources/web/engine.js, in a hidden web view. It
// exposes the same two model calls the extension's worker makes (coach.js: the questions, then
// the rewrite) and nothing else, so the prompts, schemas, providers and rewrite checks cannot
// drift between the two products.
//
// Rules (test/desktop.test.mjs enforces the first):
//   - imports nothing from the Chrome side (content.js, worker.js, the extension APIs): this runs in a web view, not Chrome.
//   - the API key arrives in `config` for one call and is never stored, logged or echoed back.
//   - every reply is { ok: true, ... } or { ok: false, error: { code, message } }, never a throw,
//     so the Swift side has one shape to read.
import { describeError, diagnose, ready, rewrite } from "./coach.js";

export const DEFAULT_TIMEOUT_MS = 90_000; // a cold local model can spend 30 s just loading

// Hosts whose servers answer a browser's real request without CORS headers (probed in desktop/CORS.md),
// so the page cannot read their reply. Their calls go through Swift's URLSession instead. This list
// must match NativeFetch.hosts in WebCoachEngine.swift; Swift refuses every other host.
export const NATIVE_HOSTS = ["api.openai.com"];

const bridge = () => globalThis.webkit?.messageHandlers?.net;
const isNative = (url) => {
  try {
    const u = new URL(String(url));
    return !!bridge() && u.protocol === "https:" && NATIVE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

/** fetch() through Swift: the whole reply arrives at once, so a streamed rewrite shows up in one piece. */
let nativeSeq = 0;
async function nativeFetch(url, init, signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const id = `n${++nativeSeq}`;
  const aborted = new Promise((_, reject) =>
    signal?.addEventListener("abort", () => {
      bridge().postMessage({ cancel: id }); // stop the request in Swift too, not just the waiting here
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true }));
  const reply = await Promise.race([
    bridge().postMessage({ id, url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null }),
    aborted,
  ]);
  if (!reply || reply.error) throw new TypeError("network"); // what fetch itself throws when it cannot connect
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
}

let active = null; // the call in flight: { controller, timedOut, cancelled }

// llm.js calls the global fetch. While a call runs, fetch carries that call's abort signal, so a
// timeout or a closed card really stops the request instead of just no longer waiting for it.
function withSignal(signal) {
  const current = globalThis.fetch;
  const base = current.__pocBase ?? current; // never stack wrappers: a superseded call's signal must not leak
  const wrapped = (url, init = {}) => (isNative(url) ? nativeFetch(url, init, signal) : base(url, { ...init, signal }));
  wrapped.__pocBase = base;
  globalThis.fetch = wrapped;
  return () => { if (globalThis.fetch === wrapped) globalThis.fetch = base; };
}

async function run(timeoutMs, work) {
  if (active) active.controller.abort(); // one call at a time; a newer one supersedes
  const call = (active = { controller: new AbortController(), timedOut: false, cancelled: false });
  const unwrap = withSignal(call.controller.signal);
  const timer = setTimeout(() => {
    call.timedOut = true;
    call.controller.abort();
  }, timeoutMs);
  try {
    return { ok: true, ...(await work()) };
  } catch (err) {
    return { ok: false, error: explain(err, call, timeoutMs) };
  } finally {
    clearTimeout(timer);
    unwrap();
    if (active === call) active = null;
  }
}

function explain(err, call, timeoutMs) {
  if (call.timedOut) {
    return { code: "timeout", message: `The model took longer than ${Math.round(timeoutMs / 1000)} seconds. Try again, or pick a faster model.` };
  }
  if (call.cancelled) return { code: "cancelled", message: "Cancelled." };
  // describeError maps CoachError and the Anthropic SDK's errors; a bare fetch abort is neither.
  if (err?.name === "AbortError") return { code: "cancelled", message: "Cancelled." };
  return describeError(err);
}

/** Call 1. `args`: { config, draft, host, timeoutMs? } → { reader, questions } */
export function diagnoseDraft({ config, draft, host, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return run(timeoutMs, async () => {
    // The diagnosis stays internal (CLAUDE.md "do not break"); everything else leaves.
    const { diagnosis, ...result } = await diagnose({ config: await ready(config), draft, host });
    return result;
  });
}

/** Call 2. `args`: { config, draft, answers, reader, host, timeoutMs? }; `onPartial` gets the rewrite so far. */
export function rewriteDraft({ config, draft, answers, reader, host, timeoutMs = DEFAULT_TIMEOUT_MS }, onPartial) {
  return run(timeoutMs, async () => {
    return rewrite({ config: await ready(config), draft, answers, host, reader, onPartial });
  });
}

/** Stop whatever is running (the card was closed). */
export function cancel() {
  if (!active) return;
  active.cancelled = true;
  active.controller.abort();
}

// The Swift side reaches these through WKWebView.callAsyncJavaScript.
globalThis.poc = {
  diagnose: diagnoseDraft,
  // Partial text goes to Swift as it streams; `callId` lets Swift route it to the right card.
  rewrite: (args, callId) =>
    rewriteDraft(args, (text) => globalThis.webkit?.messageHandlers?.poc?.postMessage({ type: "partial", callId, text })),
  cancel,
};
