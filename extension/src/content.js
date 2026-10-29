import { caretRect, groundOf } from "./caret.js";
import { loadFonts } from "./fonts.js";
import { currentHost, findPromptBox, readPrompt } from "./hosts.js";
import { createCoach } from "./panel.js";
import { writeBack } from "./writeback.js";

// P.O.C sits beside your caret as a small dot while you write a prompt, and
// opens when you hover it. It never speaks on its own: hovering shows what it
// would do, and nothing reaches the model until you click "Coach this draft" or
// press Cmd+Shift+P. (This replaces the earlier summon-only panel, 2026-10-28.
// The principle held: a coach that interrupts while you type is unbearable.
// A dot that waits to be hovered does not interrupt.)
//
// This file never sees the API key. It reads the prompt box, sends the draft to
// the worker, and tells panel.js what to show.

const host = currentHost();
if (host) start();

function start() {
  let box = null;
  // One coaching session per draft. Re-hovering an unchanged draft resumes it
  // instead of paying for the same questions twice.
  let session = null; // { draft, status, questions?, state?, error? }
  let run = 0; // bumps when a newer request supersedes an older one

  loadFonts((path) => chrome.runtime.getURL(path));
  const coach = createCoach({
    onHover: () => openCoach({ pin: false }),
    onAsk: () => ask(),
    onRewrite: () => rewrite(),
    onUse: (prompt) => use(prompt),
    onClose: () => schedule(),
    onOpenOptions: () => chrome.runtime.sendMessage({ type: "openOptions" }),
  });
  // On <html>, not <body>, so a framework re-rendering body does not remove it.
  document.documentElement.appendChild(coach.host);

  // ── Following the caret ───────────────────────────────────────────────
  let frame = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  function update() {
    frame = 0;
    if (!box?.isConnected) box = findPromptBox(host);
    const active = box && (box === document.activeElement || box.contains(document.activeElement));
    if (!active || !readPrompt(box).trim()) return coach.setCaret(null);
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
    if (!box?.isConnected) box = findPromptBox(host);
    if (!box) return;
    coach.setCaret(caretRect(box, coach.layer) ?? fallbackRect(box), box.getBoundingClientRect());
    openCoach({ pin: true, askNow: true });
  });

  // ── The popup's states ────────────────────────────────────────────────
  function openCoach({ pin, askNow = false }) {
    if (!box?.isConnected) box = findPromptBox(host);
    if (!box) return; // Selector drifted. Stay silent rather than break the page.
    const draft = readPrompt(box).trim();
    if (!draft) {
      coach.empty();
    } else if (session?.draft === draft) {
      render();
    } else if (askNow) {
      coach.open({ pin: true });
      return ask();
    } else {
      coach.idle({ words: countWords(draft) });
    }
    coach.open({ pin });
  }

  function render() {
    if (session.rewrite) return showResult();
    if (session.status === "loading") coach.loading();
    else if (session.status === "error") coach.error(session.error);
    else if (!session.questions.length) coach.nothing();
    else coach.questions(session.questions, session.state);
  }

  async function ask() {
    if (!box?.isConnected) box = findPromptBox(host);
    const draft = box ? readPrompt(box).trim() : "";
    if (!draft) return coach.empty();
    const thisRun = ++run;
    session = { draft, status: "loading" };
    coach.pin();
    coach.loading();

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "diagnose", draft, host: host.label });
    } catch {
      // The extension was reloaded under this tab; this content script is orphaned.
      res = { ok: false, error: { code: "orphaned", message: "P.O.C was updated. Reload this page to use it." } };
    }
    if (run !== thisRun) return;
    if (!res?.ok) {
      session = { draft, status: "error", error: res?.error ?? { code: "unknown", message: "Something went wrong." } };
    } else {
      // The answers are what call 2 (the rewrite) will take. Not built yet.
      session = { draft, status: "done", questions: res.questions, state: { index: 0, answers: {} } };
    }
    if (coach.isOpen()) render();
  }

  // ── Call 2: the rewrite ──────────────────────────────────────────────
  async function rewrite() {
    if (!session?.questions) return;
    const thisRun = ++run;
    const { draft, questions, state } = session;
    coach.pin();
    coach.rewriting();
    const answers = questions.map((q) => ({ question: q.question, answer: state.answers[q.id] ?? null }));
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "rewrite", draft, answers, host: host.label });
    } catch {
      res = { ok: false, error: { code: "orphaned", message: "P.O.C was updated. Reload this page to use it." } };
    }
    if (run !== thisRun) return;
    if (!res?.ok) return coach.error(res?.error ?? { code: "unknown", message: "Something went wrong." });
    session.rewrite = { prompt: res.prompt, techniques: res.techniques };
    if (coach.isOpen()) showResult();
  }

  let result = null;
  function showResult() {
    result = coach.result(session.rewrite, {
      onBack: () => {
        session.rewrite = null;
        render();
      },
    });
  }

  async function use(prompt) {
    if (!box?.isConnected) box = findPromptBox(host);
    if (box && writeBack(box, prompt)) {
      // The draft changed, so this session is spent; the next hover starts fresh.
      session = null;
      coach.close();
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      result?.report("Couldn't write into the box here, so it's on your clipboard. Paste with ⌘V.");
    } catch {
      result?.report("Couldn't write into the box or copy. Select the text above and copy it.");
    }
  }
}

// When the caret cannot be measured, sit at the box's right edge, top line.
function fallbackRect(box) {
  const r = box.getBoundingClientRect();
  return new DOMRect(r.right - 16, r.top + 8, 0, 20);
}

function countWords(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
