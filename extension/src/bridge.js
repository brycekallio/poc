// content.js's line to the worker: one reply (send) or a stream over a port (streamRewrite).
// Split out so test/bridge.test.mjs can drive it with a fake `chrome`; content.js itself needs a DOM.
import { orphanedFailure, unknownFailure } from "./session.js";

// The worker answers { ok, ...result } or { ok: false, error }. Failures are
// thrown as { code, message } for the session to show.
export async function send(msg) {
  let res;
  try {
    res = await chrome.runtime.sendMessage(msg);
  } catch {
    // The extension was reloaded under this tab; this content script is orphaned.
    throw orphanedFailure();
  }
  if (!res?.ok) throw res?.error ?? unknownFailure();
  return res;
}

// The rewrite arrives in pieces over a port: { partial } while it is written,
// then { ok: true, prompt, … } or { ok: false, error }.
export function streamRewrite(msg, onPartial) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: "rewrite" });
    } catch {
      return reject(orphanedFailure());
    }
    let finished = false;
    port.onMessage.addListener((m) => {
      if ("partial" in m) return onPartial?.(m.partial);
      finished = true;
      port.disconnect();
      if (m.ok) resolve(m);
      else reject(m.error ?? unknownFailure());
    });
    port.onDisconnect.addListener(() => {
      if (!finished) reject({ code: "orphaned", message: "The connection to P.O.C dropped. Try again, or reload this page." });
    });
    port.postMessage(msg);
  });
}
