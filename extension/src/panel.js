import panelCss from "./panel.css";

// P.O.C's interface: a small dot that sits beside the text caret, and a popup
// that opens when you hover it. Knows nothing about Chrome, the host page or the
// API: session.js decides what to show, and this draws it.
//
// Hovering only opens the popup. Nothing is sent to the model until you click
// "Coach this draft" (or press the shortcut), so brushing past the dot is free.

const POPUP_WIDTH = 320;
// Errors the settings page can fix; the rest get "Try again". Codes from coach.js describeError().
const FIXABLE = ["no-key", "bad-key", "bad-model", "forbidden"];
const OPEN_DELAY = 140; // ms of hover before opening, so passing over the dot does nothing
const CLOSE_DELAY = 260; // ms of grace after the pointer leaves, so moving to the popup does not close it

/**
 * Each action is a user intent; the caller updates the session and calls
 * render(session.view(draft)) again.
 * @param {{
 *   onHover: () => void,          // the dot was hovered: render, then call open()
 *   onAsk: () => void,            // "Coach this draft"
 *   onChoose: (answer: string|null) => void,  // an option, your own answer, or Skip (null)
 *   onBack: () => void,           // the previous question
 *   onChangeAnswers: () => void,  // from the summary back to question 1
 *   onRewrite: () => void,
 *   onRetry: () => void,          // "Try again" after an error
 *   onLeaveResult: () => void,    // from the rewrite back to the summary
 *   onUse: (prompt: string) => void,  // put the rewrite into the prompt box
 *   onClose?: () => void,
 *   onOpenOptions: () => void,
 *   shadowMode?: "open"|"closed",
 * }} actions
 */
export function createCoach({
  onHover, onAsk, onChoose, onBack, onChangeAnswers, onRewrite, onRetry, onLeaveResult, onUse, onClose, onOpenOptions,
  shadowMode = "closed",
}) {
  // A closed shadow root keeps the host page's CSS out and ours in. Only the
  // dev previews open it, so they can drive the popup.
  const host = document.createElement("poc-coach");
  const shadow = host.attachShadow({ mode: shadowMode });
  const style = document.createElement("style");
  style.textContent = panelCss;

  const dot = h("button", {
    class: "dot", type: "button", hidden: true,
    "aria-label": "P.O.C: coach this prompt", "aria-haspopup": "dialog", "aria-expanded": "false",
    ...keepFocus,
  }, h("span", { class: "orb" }, wordmark()));

  const step = h("span", { class: "step num" });
  const body = h("div", { class: "body" });
  const popup = h(
    "div",
    { class: "popup", role: "dialog", "aria-label": "P.O.C", hidden: true },
    h(
      "div",
      { class: "bar" },
      h("span", { class: "name", title: "P.O.C, Prompt Optimization Coach" }, wordmark()),
      step,
      h("button", { class: "icon", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: () => close(), ...keepFocus }, closeGlyph()),
    ),
    body,
  );
  shadow.append(style, dot, popup);

  // Keys typed into the popup's own field should not reach the host page's
  // shortcuts. Capture-phase listeners on the page still see them first; this
  // only stops the bubble. Esc is left alone so the page-level close works.
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input"]) {
    popup.addEventListener(type, (e) => {
      if (e.key !== "Escape") e.stopPropagation();
    });
  }

  let anchor = null; // the dot's last position, in viewport coordinates
  let avoid = null; // the prompt box: the popup opens above or below it, never over it
  let open = false;
  let pinned = false; // once coaching starts, the popup stays until closed
  let openTimer = 0;
  let closeTimer = 0;

  const cancelClose = () => clearTimeout(closeTimer);
  const scheduleClose = () => {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => close(), CLOSE_DELAY);
  };
  dot.addEventListener("mouseenter", () => {
    cancelClose();
    if (open) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(onHover, OPEN_DELAY);
  });
  dot.addEventListener("mouseleave", () => {
    clearTimeout(openTimer);
    scheduleClose();
  });
  dot.addEventListener("click", () => (open ? null : onHover()));
  popup.addEventListener("mouseenter", cancelClose);
  popup.addEventListener("mouseleave", scheduleClose);

  function place() {
    if (!anchor) return;
    const margin = 12;
    const left = Math.min(Math.max(margin, anchor.x - 24), innerWidth - POPUP_WIDTH - margin);
    // Clear of the whole prompt box, so it never covers what you wrote: above
    // the box when there is room (claude.ai's composer sits at the bottom),
    // below it otherwise. A box taller than half the window is treated as a
    // page-sized editor, and the popup clears just the caret's line.
    const span = avoid && avoid.height < innerHeight / 2 ? avoid : { top: anchor.y - 10, bottom: anchor.y + 10 };
    const above = span.top > 280;
    popup.style.left = `${left}px`;
    popup.style.top = above ? "" : `${span.bottom + 10}px`;
    popup.style.bottom = above ? `${innerHeight - span.top + 10}px` : "";
    popup.dataset.side = above ? "above" : "below";
    // Never taller than the room on its side; the body scrolls instead.
    popup.style.maxHeight = `${(above ? span.top : innerHeight - span.bottom) - 10 - margin}px`;
    popup.style.transformOrigin = `${anchor.x - left}px ${above ? "100%" : "0"}`;
  }

  function close() {
    if (!open) return;
    open = false;
    pinned = false;
    popup.hidden = true;
    dot.setAttribute("aria-expanded", "false");
    onClose?.();
  }

  const show = (...children) => {
    body.replaceChildren(...children.filter((c) => c != null));
    if (open) place();
  };

  // ── Views, one per session.view() kind ─────────────────────────────────
  let report = null; // writes under the result; set only while it is showing

  const views = {
    empty() {
      show(h("p", { class: "note" }, "Write a first pass, then hover the dot again."));
    },

    /** Before anything is sent: what will be coached, and the one button that sends it. */
    idle({ words }) {
      show(
        h(
          "div",
          { class: "idle" },
          h("p", { class: "lead" }, "Sharpen this prompt with a few quick questions."),
          h(
            "div",
            { class: "row" },
            h("span", { class: "meta num" }, `${words} ${words === 1 ? "word" : "words"}`),
            h("button", { class: "btn primary", type: "button", onclick: onAsk, ...keepFocus }, "Coach this draft"),
          ),
        ),
      );
    },

    // The question's final shape in flat bars, so nothing jumps when it lands.
    loading() {
      show(
        h(
          "div",
          { class: "q", "aria-hidden": "true" },
          h("span", { class: "sk sk-quote" }),
          h("span", { class: "sk sk-question" }),
          h("span", { class: "sk sk-question short" }),
          h("div", { class: "opts" }, ...[0, 1, 2].map(() => h("span", { class: "sk sk-opt" }))),
        ),
        h("p", { class: "status", role: "status" }, "Reading your draft…"),
      );
    },

    rewriting() {
      show(
        h("div", { class: "q", "aria-hidden": "true" }, ...[92, 100, 84, 96, 60].map((w) => h("span", { class: "sk sk-line", style: `width:${w}%` }))),
        h("p", { class: "status", role: "status" }, "Rewriting with your answers…"),
      );
    },

    /** One question at a time. Choosing moves on after a beat, so the choice is seen to land. */
    question({ question: q, index, total, answer }) {
      step.textContent = total > 1 ? `${index + 1} of ${total}` : "";
      show(questionView(q, answer, {
        choose: (value) => setTimeout(() => onChoose(value), 220),
        back: index > 0 ? onBack : null,
      }));
    },

    /** The answers, and the Rewrite button. With no questions, the draft was already clear. */
    summary({ questions, answers }) {
      const rows = questions.map((q) =>
        h(
          "li",
          {},
          h("span", { class: "sq" }, q.question),
          answers[q.id] == null
            ? h("span", { class: "sa skipped" }, "Skipped")
            : h("span", { class: "sa" }, answers[q.id]),
        ),
      );
      show(
        questions.length
          ? h("p", { class: "lead" }, "Got it. Here is what the rewrite will use.")
          : h("p", { class: "lead" }, "Nothing to ask. This draft already says what it needs to, so the rewrite only tightens it."),
        questions.length ? h("ul", { class: "answers" }, ...rows) : null,
        h(
          "div",
          { class: "foot" },
          questions.length
            ? h("button", { class: "link", type: "button", onclick: onChangeAnswers, ...keepFocus }, "Change answers")
            : h("span"),
          h("button", { class: "btn primary", type: "button", onclick: onRewrite, ...keepFocus }, "Rewrite"),
        ),
      );
    },

    /** The rewritten prompt, the techniques it applies, and the way to use it. */
    result({ result: { prompt, techniques, unverified = [] } }) {
      const note = h("p", { class: "status", role: "status" });
      report = (text) => (note.textContent = text);
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(prompt);
          note.textContent = "Copied. Paste it with ⌘V.";
        } catch {
          note.textContent = "Could not copy. Select the text above and copy it.";
        }
      };
      show(
        h("div", { class: "rewrite", tabindex: "0", "aria-label": "Rewritten prompt" }, prompt),
        techniques.length ? h("ul", { class: "techniques", "aria-label": "Techniques applied" }, ...techniques.map((t) => h("li", {}, t))) : null,
        // The checks failed twice. Say so rather than pass it off as clean.
        unverified.length
          ? h("div", { class: "caution", role: "note" }, h("p", {}, "Read this one before using it. It still misses:"), h("ul", {}, ...unverified.map((u) => h("li", {}, u))))
          : null,
        h(
          "div",
          { class: "foot" },
          h("button", { class: "link", type: "button", onclick: onLeaveResult, ...keepFocus }, "Back"),
          h(
            "div",
            { class: "actions" },
            h("button", { class: "btn ghost", type: "button", onclick: copy, ...keepFocus }, "Copy"),
            h("button", { class: "btn primary", type: "button", onclick: () => onUse(prompt), ...keepFocus }, "Use this"),
          ),
        ),
        note,
      );
    },

    error({ error: { code, message } }) {
      const fixable = FIXABLE.includes(code);
      show(
        h(
          "div",
          { class: "error", role: "alert" },
          errorGlyph(),
          h(
            "div",
            {},
            h("p", {}, message),
            fixable
              ? h("button", { class: "link strong", type: "button", onclick: onOpenOptions }, "Open settings")
              : h("button", { class: "link strong", type: "button", onclick: onRetry, ...keepFocus }, "Try again"),
          ),
        ),
      );
    },
  };

  return {
    host,
    /** Where caret.js may put its hidden textarea mirror: inside our shadow root, not the page. */
    layer: shadow,
    /** Light or dark, from the ground the prompt box sits on (not the OS). */
    setTheme(theme) {
      host.dataset.theme = theme;
    },
    /** The dot sits just right of the caret, centred on its line. null hides it.
     *  `boxRect` is the prompt box, which the popup keeps clear of. */
    setCaret(rect, boxRect = null) {
      if (open) return; // frozen while the popup is open, so it does not chase typing
      if (!rect) {
        dot.hidden = true;
        return;
      }
      // Beside the caret at the end of a line; lifted just above the line when
      // text follows, so it never sits on the next word.
      anchor = rect.midLine
        ? { x: rect.left - 11, y: rect.top - 9 }
        : { x: rect.left + 10, y: rect.top + rect.height / 2 };
      avoid = boxRect;
      const to = `translate(${anchor.x}px, ${anchor.y}px)`;
      if (dot.hidden) {
        // Appearing: jump straight to the caret (no glide in from the corner),
        // then let the entrance animation fade it in.
        dot.classList.add("still");
        dot.style.transform = to;
        dot.hidden = false;
        void dot.offsetWidth;
        dot.classList.remove("still");
      } else {
        // Already showing: the CSS transition glides it after the caret.
        dot.style.transform = to;
      }
    },
    isOpen: () => open,
    isPinned: () => pinned,
    /** Whether a pointer event landed on the dot or the popup. */
    contains: (e) => e.composedPath().includes(host),

    open({ pin = false } = {}) {
      clearTimeout(openTimer);
      cancelClose();
      pinned ||= pin;
      if (open) return;
      open = true;
      popup.hidden = false;
      dot.setAttribute("aria-expanded", "true");
      place();
    },
    pin() {
      pinned = true;
      cancelClose();
    },
    close,

    /** Draw what the session says to show. `view` comes from session.view(draft). */
    render(view) {
      step.textContent = "";
      report = null;
      const draw = views[view.kind];
      if (!draw) throw new Error(`Unknown view: ${view.kind}`);
      draw(view);
    },
    /** After "Use this": say what happened, under the result. */
    report(text) {
      report?.(text);
    },
  };
}

function questionView(q, current, { choose, back }) {
  const optionButtons = q.options.map((opt) =>
    h("button", {
      class: "opt", type: "button", "aria-pressed": String(current === opt), ...keepFocus,
      onclick: (e) => {
        for (const b of optionButtons) b.setAttribute("aria-pressed", "false");
        e.currentTarget.setAttribute("aria-pressed", "true");
        choose(opt);
      },
    }, h("span", {}, opt), checkGlyph()),
  );
  const own = h("input", {
    class: "own", type: "text", placeholder: "Your answer, then Enter",
    "aria-label": `Your own answer: ${q.question}`, hidden: true,
  });
  if (current && !q.options.includes(current)) {
    own.value = current;
    own.hidden = false;
  }
  own.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && own.value.trim()) {
      e.preventDefault();
      choose(own.value.trim());
    }
  });

  return h(
    "div",
    { class: "q", role: "group", "aria-label": q.question },
    // The user's own words, above the question about them. coach.js drops any
    // quote that is not really in the draft.
    q.quote ? h("p", { class: "quote" }, `“${q.quote}”`) : null,
    h("p", { class: "question" }, q.question),
    h("div", { class: "opts" }, ...optionButtons),
    own,
    h(
      "div",
      { class: "alt" },
      h("button", { class: "link", type: "button", onclick: () => {
        own.hidden = false;
        own.focus(); // The user asked to type, so focus moving here is expected.
      } }, "Write my own"),
      h("button", { class: "link", type: "button", ...keepFocus, onclick: () => choose(null) }, "Skip"),
      back ? h("button", { class: "link back", type: "button", ...keepFocus, onclick: back }, "Back") : null,
    ),
  );
}

// Clicking popup buttons must not pull focus out of the host's prompt box: the
// user is mid-prompt, and some editors react badly to losing focus.
const keepFocus = { onmousedown: (e) => e.preventDefault() };

// The wordmark: "poc" with the o as a solid blue disc, the same dot as the
// orb. The disc is drawn in CSS, not typed as a glyph, so it stays round and
// crisp at 11px. Screen readers get "P.O.C".
function wordmark() {
  return h("span", { class: "wm", role: "img", "aria-label": "P.O.C" }, "p", h("span", { class: "wm-o", "aria-hidden": "true" }), "c");
}
const closeGlyph = () => svg('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
const checkGlyph = () => svg('<svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const errorGlyph = () => svg('<svg class="error-glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.75v3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11" r=".9" fill="currentColor"/></svg>');

// SVG markup here is static and ours, never model text.
function svg(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstChild;
}

// Tiny element builder. Text goes in through text nodes only, never innerHTML,
// because question text comes from a model and the popup lives in someone's page.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "hidden" || k === "disabled") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
