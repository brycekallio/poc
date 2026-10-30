import { caretRect, groundOf } from "./caret.js";
import { loadFonts } from "./fonts.js";
import { currentHost, findPromptBox, readPrompt } from "./hosts.js";
import { createCoach } from "./panel.js";
import { createSession } from "./session.js";
import { writeBack } from "./writeback.js";

// P.O.C sits beside your caret as a small dot while you write (a prompt, or
// since 2026-10-29 anything in any multi-line text box), and
// opens when you hover it. It never speaks on its own: hovering shows what it
// would do, and nothing reaches the model until you click "Coach this draft" or
// press Cmd+Shift+P. (This replaces the earlier summon-only panel, 2026-10-28.
// The principle held: a coach that interrupts while you type is unbearable.
// A dot that waits to be hovered does not interrupt.)
//
// This file never sees the API key. It reads the prompt box, sends the draft to
// the worker, and tells panel.js what to show.

const host = currentHost();
// What call 1 is told about where the box is. On the three chat sites it is
// certainly a prompt; anywhere else the draft decides.
const where = location.protocol === "chrome-extension:"
  ? "a practice box"
  : host.generic ? location.hostname : `${host.label}, an AI chat site`;
// The worker also injects this script into tabs that were open when P.O.C was
// installed or updated, so it can arrive in a tab that already has it.
if (!globalThis.__pocStarted) {
  globalThis.__pocStarted = true;
  start();
}

function start() {
  // A dot left by the previous version of the extension, whose script is now
  // cut off from the worker.
  for (const old of document.querySelectorAll("poc-coach")) old.remove();

  // The light switch in the toolbar popup. Followed live, no reload.
  let off = false;
  const followSwitch = ({ enabled = true }) => {
    off = !enabled;
    if (off) coach.close();
    schedule();
  };

  let box = null;
  // The prompt box, found again whenever the host re-rendered it away. On a
  // site with no known selector it follows focus: the text box you are in, or
  // the last one you were in.
  const currentBox = () => {
    if (host.generic) {
      const focused = findPromptBox(host);
      if (focused) box = focused;
      return box?.isConnected ? box : null;
    }
    return box?.isConnected ? box : (box = findPromptBox(host));
  };
  const currentDraft = () => (currentBox() ? readPrompt(box) : "");

  const session = createSession({
    diagnose: (draft) => send({ type: "diagnose", draft, host: where }),
    rewrite: (draft, answers, reader) => send({ type: "rewrite", draft, answers, reader, host: where }),
    onChange: () => coach.isOpen() && show(),
  });
  // Every intent updates the session, then redraws from it.
  const then = (fn) => (...args) => {
    fn(...args);
    show();
  };

  const coach = createCoach({
    onHover: () => openCoach({ pin: false }),
    onAsk: () => ask(),
    onChoose: then((answer) => session.choose(answer)),
    onBack: then(() => session.back()),
    onChangeAnswers: then(() => session.changeAnswers()),
    onRewrite: then(() => {
      coach.pin();
      session.rewrite();
    }),
    onRetry: then(() => {
      coach.pin();
      session.retry();
    }),
    onLeaveResult: then(() => session.leaveResult()),
    onUse: (prompt) => use(prompt),
    onClose: () => schedule(),
    onOpenOptions: () => chrome.runtime.sendMessage({ type: "openOptions" }),
  });
  // On <html>, not <body>, so a framework re-rendering body does not remove it.
  document.documentElement.appendChild(coach.host);

  const show = () => coach.render(session.view(currentDraft()));

  chrome.storage.local.get("enabled").then(followSwitch);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) followSwitch({ enabled: changes.enabled.newValue });
  });

  // ── Following the caret ───────────────────────────────────────────────
  let frame = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  function update() {
    frame = 0;
    const box = off ? null : currentBox();
    const active = box && (box === document.activeElement || box.contains(document.activeElement));
    if (!active || !readPrompt(box).trim()) return coach.setCaret(null);
    // Fetched the first time a dot shows, not on every page P.O.C runs on.
    loadFonts((path) => chrome.runtime.getURL(path));
    coach.setTheme(groundOf(box));
    coach.setCaret(caretRect(box, coach.layer) ?? fallbackRect(box), box.getBoundingClientRect());
  }
  for (const type of ["selectionchange", "input", "focusin", "focusout", "keyup"]) document.addEventListener(type, schedule, true);
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule);

  // Typing again closes a popup that was only being looked at.
  document.addEventListener("input", (e) => {
    if (coach.isOpen() && !coach.isPinned() && !coach.contains(e)) coach.close();
  }, true);
  // Clicking elsewhere closes it; the session is kept for the next hover.
  document.addEventListener("pointerdown", (e) => {
    if (coach.isOpen() && !coach.contains(e)) coach.close();
  }, true);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && coach.isOpen()) coach.close();
  }, true);

  // The shortcut is a chrome.commands entry handled in worker.js. Pressing it is
  // an explicit ask, so it coaches straight away.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "toggle") return;
    if (coach.isOpen()) return coach.close();
    const box = off ? null : currentBox();
    if (!box) return;
    coach.setCaret(caretRect(box, coach.layer) ?? fallbackRect(box), box.getBoundingClientRect());
    openCoach({ pin: true, askNow: true });
  });

  function openCoach({ pin, askNow = false }) {
    if (off || !currentBox()) return; // Selector drifted. Stay silent rather than break the page.
    // The shortcut asks right away, unless this draft is already being coached.
    if (askNow && session.view(currentDraft()).kind === "idle") return ask();
    show();
    coach.open({ pin });
  }

  function ask() {
    const draft = currentDraft();
    coach.pin();
    coach.open({ pin: true });
    if (draft.trim()) session.ask(draft);
    show();
  }

  async function use(prompt) {
    const box = currentBox();
    if (box && writeBack(box, prompt)) {
      session.used();
      coach.close();
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      coach.report("Couldn't write into the box here, so it's on your clipboard. Paste with ⌘V.");
    } catch {
      coach.report("Couldn't write into the box or copy. Select the text above and copy it.");
    }
  }
}

// The worker answers { ok, ...result } or { ok: false, error }. Failures are
// thrown as { code, message } for the session to show.
async function send(msg) {
  let res;
  try {
    res = await chrome.runtime.sendMessage(msg);
  } catch {
    // The extension was reloaded under this tab; this content script is orphaned.
    throw { code: "orphaned", message: "P.O.C was updated. Reload this page to use it." };
  }
  if (!res?.ok) throw res?.error ?? { code: "unknown", message: "Something went wrong." };
  return res;
}

// When the caret cannot be measured, sit at the box's right edge, top line.
function fallbackRect(box) {
  const r = box.getBoundingClientRect();
  return new DOMRect(r.right - 16, r.top + 8, 0, 20);
}
